/**
 * scan.ts — one autonomous hunt run:
 *   1 validate the checked-in hunts      (bad config → throw, zero provider calls)
 *   2 load the promoted manifest + alert ledger
 *   3 search each hunt (priority order), normalize, evaluate
 *   4 persist raw pages + every evaluation (kept or rejected) per hunt
 *   5 merge into a new manifest — a hunt this run could not search carries its
 *     last good results, marked, never replaced by an empty list
 *   6 build the versioned dashboard payload
 *   7 promote manifests/latest.json LAST, and only when the run is publishable
 *     (success or partial); a failed run records itself and changes nothing
 *   8 fold unders into the alert ledger (material changes only)
 *   9 attempt the optional sink
 *  10 persist the run summary with coverage, provider health, and delivery results
 */
import { type Hunt } from './hunts';
import { validateHunts } from './validate';
import { evaluate, riskOf } from './evaluate';
import { DETAILS_PER_RUN, PHOTOS_PER_RUN, hashPhoto, loadDetails, reusedPhotos } from './enrich';
import { feedbackFor, loadFeedback } from './feedback';
import { relistIndex } from './ledger';
import { HUNTS } from './hunts';
import { normalizeText } from './text';
import { ProviderAuthError, ProviderRateLimitError, type HuntProvider } from './provider';
import { getJson, putJson, type ObjectStore } from './store';
import { emptyLedger, updateLedger } from './ledger';
import { deliverPending } from './sink';
import { buildDashboard, type DashboardPayload } from './dashboard';
import type { AlertLedger, DataMode, HuntRunResult, Manifest, Observation, RunState, RunSummary } from './types';

export interface ScanOptions {
  provider: HuntProvider;
  store: ObjectStore;
  mode: DataMode;
  now?: () => Date;
  runId?: string;
  onlyHuntId?: string | null;
  hunts?: Hunt[];
  staleAfterMinutes?: number;
  webhookUrl?: string | null;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
  /** item-detail lookups allowed this run (default DETAILS_PER_RUN) */
  detailsBudget?: number;
  /** hash listing photos (default true; tests turn it off) */
  hashPhotos?: boolean;
}

export interface ScanResult { summary: RunSummary; dashboard: DashboardPayload; manifest: Manifest }

export function makeRunId(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function runScan(o: ScanOptions): Promise<ScanResult> {
  const clock = o.now ?? (() => new Date());
  const log = o.log ?? ((m: string) => console.log(m));
  const hunts = validateHunts(o.hunts); // 1 — throws before any provider call
  if (o.onlyHuntId && !hunts.some((h) => h.id === o.onlyHuntId)) throw new Error(`unknown hunt id "${o.onlyHuntId}"`);
  const started = clock();
  const startedAt = started.toISOString();
  const runId = o.runId ?? makeRunId(started);
  const staleAfterMinutes = o.staleAfterMinutes ?? 240;

  // 2
  const prev = await getJson<Manifest>(o.store, 'manifests/latest.json');
  const ledger = (await getJson<AlertLedger>(o.store, 'alerts/ledger.json')) ?? emptyLedger();

  // 3 + 4
  const results: HuntRunResult[] = [];
  const fresh = new Map<string, Observation[]>();
  let returnedTotal = 0, rejectedTotal = 0;
  let stopReason: string | null = null;
  for (const h of hunts) {
    if (o.onlyHuntId && h.id !== o.onlyHuntId) {
      results.push({ huntId: h.id, state: 'not-searched', pages: 0, returned: 0, error: null, searchedAt: null });
      continue;
    }
    if (stopReason) {
      results.push({ huntId: h.id, state: 'failed', pages: 0, returned: 0, error: `skipped: ${stopReason}`, searchedAt: null });
      continue;
    }
    const at = clock();
    try {
      const r = await o.provider.search(h, at);
      const seen = new Set<string>();
      const obs: Observation[] = [];
      for (const l of r.listings) {
        if (seen.has(l.itemId)) continue;
        seen.add(l.itemId);
        obs.push({ listing: l, evaluation: evaluate(h, l) });
      }
      returnedTotal += r.returned;
      fresh.set(h.id, obs);
      await putJson(o.store, `runs/${runId}/raw/ebay/${h.id}.json`, { huntId: h.id, query: h.query, fetchedAt: at.toISOString(), pages: r.raw });
      results.push({ huntId: h.id, state: r.partialError ? 'partial' : 'complete', pages: r.pages, returned: r.returned, error: r.partialError, searchedAt: at.toISOString() });
      log(`[hunt] ${h.id}: ${r.returned} returned${r.partialError ? ` · PARTIAL (${r.partialError})` : ''}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      results.push({ huntId: h.id, state: 'failed', pages: 0, returned: 0, error: msg, searchedAt: at.toISOString() });
      log(`[hunt] ${h.id}: FAILED — ${msg}`);
      if (e instanceof ProviderAuthError) stopReason = 'provider authentication failed';
      if (e instanceof ProviderRateLimitError) stopReason = 'eBay rate limit (429) — no further calls this run';
    }
  }

  // 4b — evidence beyond the title, then the final evaluation of every candidate
  const byId = new Map(hunts.map((h) => [h.id, h]));
  const feedback = await loadFeedback(o.store);
  const firstPass = [...fresh.values()].flat();
  const det = await loadDetails(firstPass, o.provider, o.store, clock(), o.detailsBudget ?? DETAILS_PER_RUN);
  const hashes = new Map<string, string>();
  if (o.hashPhotos !== false) {
    const photoCands = firstPass.filter((x) => x.evaluation.classification !== 'reject' && x.listing.imageUrl && byId.get(x.evaluation.huntId)?.vertical !== 'grails');
    for (const x of photoCands.slice(0, PHOTOS_PER_RUN)) {
      if (hashes.has(x.listing.itemId)) continue;
      const hsh = await hashPhoto(x.listing.imageUrl!, o.fetchImpl);
      if (hsh) hashes.set(x.listing.itemId, hsh);
    }
  }
  const reused = reusedPhotos(hashes);
  const relists = relistIndex(ledger, firstPass);
  const claimed = new Map<string, string>(); // itemId → the highest-priority hunt that kept it
  for (const h of hunts) {
    const obs = fresh.get(h.id);
    if (!obs) continue;
    for (let i = 0; i < obs.length; i++) {
      const l = obs[i].listing;
      const extra: string[] = [];
      const others = reused.get(l.itemId);
      if (others?.length) extra.push(`photo-reused:${others.length}`);
      const rel = relists.get(l.itemId);
      if (rel) extra.push('relisted');
      const d = det.details.get(l.itemId);
      obs[i] = {
        listing: l,
        evaluation: evaluate(h, l, { details: d ? { aspects: d.aspects, description: d.description } : null, flags: extra, feedback: feedbackFor(feedback, h.id, l.itemId, l.seller?.username) }),
        details: d ? { aspects: d.aspects, descriptionSnippet: d.descriptionSnippet, fetchedAt: d.fetchedAt } : undefined,
        photoReusedWith: others,
        relistedFrom: rel,
      };
    }
    for (const x of obs) {
      if (x.evaluation.classification === 'reject') continue;
      const owner = claimed.get(x.listing.itemId);
      if (owner) {
        x.evaluation = { ...x.evaluation, classification: 'reject', reasons: [`claimed-by-earlier-hunt:${owner}`, ...x.evaluation.reasons], underBy: null, underPct: null, capWording: 'rejected' };
      } else claimed.set(x.listing.itemId, h.id);
    }
    collapseDuplicates(obs);
    rejectedTotal += obs.filter((x) => x.evaluation.classification === 'reject').length;
    await putJson(o.store, `runs/${runId}/evaluations/${h.id}.json`, obs.map((x) => ({ title: x.listing.title, ...x.evaluation })));
    log(`[hunt] ${h.id}: ${obs.filter((x) => x.evaluation.classification !== 'reject').length} kept · ${obs.filter((x) => x.evaluation.classification === 'under').length} under`);
  }
  log(`[hunt] evidence: ${det.fetched} item lookups (${det.cached} cached) · ${hashes.size} photos hashed · ${[...reused.keys()].length} reused photos · ${feedback.dismissed.size} dismissed · ${feedback.blockedSellers.size + feedback.learnedSellers.size} blocked sellers`);

  // 5
  const finished = clock();
  const finishedAt = finished.toISOString();
  const huntsTotal = hunts.length;
  const huntsComplete = results.filter((r) => r.state === 'complete').length;
  const anySearched = results.some((r) => r.state === 'complete' || r.state === 'partial');
  const state: RunState = huntsComplete === huntsTotal ? 'success' : anySearched ? 'partial' : 'failed';
  const manifest: Manifest = {
    schemaVersion: 1,
    runId,
    mode: o.mode,
    promotedAt: finishedAt,
    lastFullSuccessAt: state === 'success' ? finishedAt : prev?.lastFullSuccessAt ?? null,
    hunts: {},
  };
  for (const r of results) {
    const before = prev?.hunts[r.huntId];
    const obs = (fresh.get(r.huntId) ?? []).filter((x) => x.evaluation.classification !== 'reject');
    if (r.state === 'complete') {
      manifest.hunts[r.huntId] = { lastSearchState: 'complete', lastSearchedAt: r.searchedAt, lastSuccessfulAt: r.searchedAt, lastSuccessfulRunId: runId, error: null, observations: obs };
    } else if (r.state === 'partial') {
      const ids = new Set(obs.map((x) => x.listing.itemId));
      const kept = (before?.observations ?? []).filter((x) => !ids.has(x.listing.itemId));
      manifest.hunts[r.huntId] = { lastSearchState: 'partial', lastSearchedAt: r.searchedAt, lastSuccessfulAt: before?.lastSuccessfulAt ?? null, lastSuccessfulRunId: before?.lastSuccessfulRunId ?? null, error: r.error, observations: [...obs, ...kept] };
    } else {
      manifest.hunts[r.huntId] = {
        lastSearchState: r.state === 'not-searched' && before ? before.lastSearchState : r.state,
        lastSearchedAt: r.state === 'not-searched' ? before?.lastSearchedAt ?? null : r.searchedAt,
        lastSuccessfulAt: before?.lastSuccessfulAt ?? null,
        lastSuccessfulRunId: before?.lastSuccessfulRunId ?? null,
        error: r.state === 'not-searched' ? before?.error ?? null : r.error,
        observations: before?.observations ?? [],
      };
    }
  }

  // 8 — only hunts this run actually searched feed the ledger
  const searchedObs = [...fresh.entries()].flatMap(([, obs]) => obs);
  const complete = new Set(results.filter((r) => r.state === 'complete').map((r) => r.huntId));
  const upd = updateLedger(ledger, searchedObs, complete, runId, finishedAt);
  const createdThisRun = new Map(upd.created.map((a) => [`${a.huntId}|${a.listingId}`, { alertKey: a.alertKey, trigger: a.trigger }]));

  // 9
  const sink = await deliverPending(ledger, o.webhookUrl ?? null, finishedAt, o.fetchImpl);

  // 6
  const promoted = state !== 'failed';
  const promotedReason = promoted
    ? state === 'success' ? 'all hunts searched' : `partial coverage (${huntsComplete}/${huntsTotal}) — unsearched hunts carry their last good results`
    : 'no hunt could be searched — previous manifest kept';
  const dashboard = buildDashboard({
    hunts,
    manifest,
    ledger,
    createdThisRun,
    generatedAt: finishedAt,
    run: {
      id: runId, state, mode: o.mode, startedAt, finishedAt,
      succeededAt: manifest.lastFullSuccessAt,
      huntsTotal, huntsComplete,
      providerHealth: o.provider.health(),
      promoted, staleAfterMinutes,
    },
  });

  // persist: evidence first, the promotion pointer last
  for (const [, obs] of fresh) {
    for (const x of obs) {
      if (x.evaluation.classification === 'reject') continue;
      await putJson(o.store, `listings/ebay/${x.listing.itemId}.json`, x.listing);
    }
  }
  await putJson(o.store, 'alerts/ledger.json', ledger);
  if (promoted) {
    await putJson(o.store, `manifests/${runId}.json`, manifest);
    await putJson(o.store, 'public/dashboard.json', dashboard);
    await putJson(o.store, 'manifests/latest.json', manifest); // 7 — the atomic swap
  }

  const retained = searchedObs.filter((x) => x.evaluation.classification !== 'reject');
  const summary: RunSummary = {
    schemaVersion: 1,
    runId,
    mode: o.mode,
    state,
    startedAt,
    finishedAt,
    scope: o.onlyHuntId ? { huntId: o.onlyHuntId } : 'all',
    huntsTotal,
    huntsComplete,
    hunts: results,
    provider: o.provider.health(),
    counts: {
      returned: returnedTotal,
      retained: retained.length,
      rejected: rejectedTotal,
      under: retained.filter((x) => x.evaluation.classification === 'under').length,
      over: retained.filter((x) => x.evaluation.classification === 'over').length,
      watch: retained.filter((x) => x.evaluation.classification === 'watch').length,
    },
    promoted,
    promotedReason,
    alerts: {
      created: upd.created.length,
      pending: Object.values(ledger.alerts).filter((a) => a.state === 'pending').length,
      delivered: sink.delivered,
      deliveryFailed: sink.failed,
    },
  };
  await putJson(o.store, `runs/${runId}/summary.json`, summary); // 10
  return { summary, dashboard, manifest };
}

/** Fold same-seller, same-title repeats (spam listings) into one observation — the lowest all-in stands, the rest are listed as `similar`. Rejects are left as-is (evidence). */
export function collapseDuplicates(obs: Observation[]): void {
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    if (o.evaluation.classification === 'reject') continue;
    const k = `${o.listing.seller?.username ?? ''}|${normalizeText(o.listing.title)}`;
    const g = groups.get(k);
    if (g) g.push(o); else groups.set(k, [o]);
  }
  const drop = new Set<Observation>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.evaluation.allIn ?? Infinity) - (b.evaluation.allIn ?? Infinity) || a.listing.itemId.localeCompare(b.listing.itemId));
    g[0].similar = g.slice(1).map((o) => o.listing.itemId);
    g[0].evaluation.flags.push(`same-seller-repeats:${g.length - 1}`);
    const h = HUNTS.find((x) => x.id === g[0].evaluation.huntId);
    if (h) {
      const r = riskOf(h, g[0].listing, g[0].evaluation.flags, g[0].evaluation.reasons);
      g[0].evaluation.risk = r.risk;
      g[0].evaluation.riskReasons = r.riskReasons;
      if (r.risk === 'high') g[0].evaluation.review = 'review';
    }
    for (const o of g.slice(1)) drop.add(o);
  }
  for (let i = obs.length - 1; i >= 0; i--) if (drop.has(obs[i])) obs.splice(i, 1);
}
