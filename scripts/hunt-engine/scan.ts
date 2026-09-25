/**
 * scan.ts — one autonomous hunt run:
 *   1 validate the checked-in hunts      (bad config → throw, zero provider calls)
 *   2 load the promoted manifest + alert ledger
 *   3 search each hunt (priority order) — its pinned query plus its recall
 *     queries, each distinct search once — newest first. A FULL SWEEP reads
 *     every page (every ~3h: refreshes prices, drops ended listings); between
 *     sweeps a DELTA scan reads only listings created since the last search
 *     (usually one call) and carries everything else forward, so API calls go
 *     to new lots, not the same ones again. Every returned id, rejects too,
 *     lands in the seen-index — that's what "new this run / today" counts.
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
import { DETAILS_PER_RUN, PHOTOS_PER_RUN, hashPhoto, loadDetails, loadPhotoCache, reusedPhotos, savePhotoCache } from './enrich';
import { feedbackFor, loadFeedback } from './feedback';
import { relistIndex } from './ledger';
import { HUNTS, searchesFor } from './hunts';
import { normalizeText } from './text';
import { ProviderAuthError, ProviderRateLimitError, type HuntProvider, type SearchResult } from './provider';
import { getJson, putJson, type ObjectStore } from './store';
import { emptyLedger, updateLedger } from './ledger';
import { deliverPending } from './sink';
import { buildDashboard, type DashboardPayload } from './dashboard';
import type { AlertLedger, DataMode, HuntListing, HuntRunResult, Manifest, Observation, RunState, RunSummary, SeenIndex } from './types';

/** a hunt gets a full sweep when its last one is at least this old (hourly runs → every 3rd run) */
export const FULL_SWEEP_EVERY_MIN = 170;
/** delta scans re-read this much before the last search (eBay indexes new listings with a lag) */
export const DELTA_OVERLAP_MIN = 30;
/** seen-index entries older than this are dropped */
export const SEEN_KEEP_DAYS = 45;
export const SEEN_KEY = 'seen/ebay.json';

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
  /** 'auto' (default): full sweep when due, delta otherwise · 'full': every hunt full */
  sweep?: 'auto' | 'full';
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

  // 3 + 4 — plan: which hunts sweep fully, which only look for new listings
  const seenIdx = (await getJson<SeenIndex>(o.store, SEEN_KEY).catch(() => null)) ?? { schemaVersion: 1, hunts: {} };
  const results: HuntRunResult[] = [];
  const fresh = new Map<string, Observation[]>();
  const discovery = new Map<string, { newThisRun: number; newToday: number; sweep: 'full' | 'delta'; searches: number }>();
  let returnedTotal = 0, rejectedTotal = 0;
  let stopReason: string | null = null;
  const recallOnly = new Set<string>(); // huntId|itemId found only by a recall search
  const plan = new Map<string, { sweep: 'full' | 'delta'; since: string | null }>();
  for (const h of hunts) {
    if (o.onlyHuntId && h.id !== o.onlyHuntId) continue;
    const before = prev?.hunts[h.id];
    const lastFull = before?.lastFullSweepAt ? Date.parse(before.lastFullSweepAt) : NaN;
    const due = o.sweep === 'full' || !Number.isFinite(lastFull) || started.getTime() - lastFull >= FULL_SWEEP_EVERY_MIN * 60_000
      || before?.lastSearchState !== 'complete' || !before?.lastSuccessfulAt;
    plan.set(h.id, due
      ? { sweep: 'full', since: null }
      : { sweep: 'delta', since: new Date(Date.parse(before!.lastSuccessfulAt!) - DELTA_OVERLAP_MIN * 60_000).toISOString() });
  }
  // each distinct search once per run; a search shared by a full-sweep hunt runs full
  const searches = new Map<string, { owner: Hunt; query: string; since: string | null; result?: SearchResult; error?: string }>();
  for (const h of hunts) {
    const p = plan.get(h.id);
    if (!p) continue;
    for (const q of searchesFor(h)) {
      const key = `${q}|${[...h.buyingModes].sort().join(',')}`;
      const cur = searches.get(key);
      if (!cur) searches.set(key, { owner: h, query: q, since: p.since });
      else if (cur.since && (!p.since || Date.parse(p.since) < Date.parse(cur.since))) cur.since = p.since;
    }
  }
  const searchAt = new Map<string, string>();
  for (const [key, srch] of searches) {
    if (stopReason) { srch.error = `skipped: ${stopReason}`; continue; }
    const at = clock();
    searchAt.set(key, at.toISOString());
    try {
      srch.result = await o.provider.search(srch.owner, at, { query: srch.query === srch.owner.query ? undefined : srch.query, since: srch.since });
    } catch (e: any) {
      srch.error = String(e?.message ?? e).slice(0, 300);
      log(`[hunt] search "${srch.query}": FAILED — ${srch.error}`);
      if (e instanceof ProviderAuthError) stopReason = 'provider authentication failed';
      if (e instanceof ProviderRateLimitError) stopReason = 'eBay rate limit (429) — no further calls this run';
    }
  }
  const nowIso = clock().toISOString();
  const dayAgo = started.getTime() - 24 * 3600_000;
  for (const h of hunts) {
    const p = plan.get(h.id);
    if (!p) {
      results.push({ huntId: h.id, state: 'not-searched', pages: 0, returned: 0, error: null, searchedAt: null });
      continue;
    }
    const mine = searchesFor(h).map((q) => ({ q, s: searches.get(`${q}|${[...h.buyingModes].sort().join(',')}`)! }));
    const pinned = mine[0];
    const searchedAt = searchAt.get(`${pinned.q}|${[...h.buyingModes].sort().join(',')}`) ?? null;
    if (!pinned.s.result) {
      results.push({ huntId: h.id, state: 'failed', pages: 0, returned: 0, error: pinned.s.error ?? 'not searched', searchedAt, sweep: p.sweep });
      log(`[hunt] ${h.id}: FAILED — ${pinned.s.error}`);
      continue;
    }
    const listings: HuntListing[] = [];
    const ids = new Set<string>();
    let pages = 0, returned = 0;
    const errors: string[] = [];
    const pinnedIds = new Set((pinned.s.result.listings).map((l) => l.itemId));
    for (const { q, s: srch } of mine) {
      if (!srch.result) { errors.push(`"${q}": ${srch.error}`); continue; }
      if (srch.result.partialError) errors.push(`"${q}": ${srch.result.partialError}`);
      if (srch.owner === h) { pages += srch.result.pages; returned += srch.result.returned; }
      for (const l of srch.result.listings) {
        // a delta hunt riding on a full search still only needs the new part
        if (p.since && l.listedAt && Date.parse(l.listedAt) < Date.parse(p.since)) continue;
        if (ids.has(l.itemId)) continue;
        ids.add(l.itemId);
        listings.push(l);
      }
    }
    for (const l of listings) if (!pinnedIds.has(l.itemId)) recallOnly.add(`${h.id}|${l.itemId}`);
    const obs = listings.map((l) => ({ listing: l, evaluation: evaluate(h, l, { recallOnly: recallOnly.has(`${h.id}|${l.itemId}`) }) }));
    fresh.set(h.id, obs);
    returnedTotal += returned;
    // seen-index: every returned id, rejects included
    const seededAlready = !!seenIdx.hunts[h.id];
    const idx = (seenIdx.hunts[h.id] ??= {});
    let newThisRun = 0;
    for (const l of listings) {
      if (idx[l.itemId]) continue;
      // first run for a hunt seeds the index: date each id by when it was listed, not "now"
      idx[l.itemId] = seededAlready ? nowIso : (l.listedAt ?? '1970-01-01T00:00:00.000Z');
      if (seededAlready) newThisRun++;
    }
    const newToday = Object.values(idx).filter((t) => Date.parse(t) >= dayAgo).length;
    discovery.set(h.id, { newThisRun, newToday, sweep: p.sweep, searches: mine.length });
    await putJson(o.store, `runs/${runId}/raw/ebay/${h.id}.json`, {
      huntId: h.id, query: h.query, sweep: p.sweep, since: p.since, fetchedAt: searchedAt,
      searches: mine.map(({ q, s: srch }) => ({ query: q, ownedBy: srch.owner.id, pages: srch.result?.raw ?? null, error: srch.error ?? null })),
      pages: pinned.s.result.raw,
    });
    const error = errors.length ? errors.join(' · ').slice(0, 300) : null;
    results.push({ huntId: h.id, state: error ? 'partial' : 'complete', pages, returned, error, searchedAt, sweep: p.sweep, searches: mine.length, newThisRun, newToday });
    log(`[hunt] ${h.id}: ${p.sweep} · ${mine.length} searches · ${returned} returned · ${newThisRun} new${error ? ` · PARTIAL (${error})` : ''}`);
  }
  // prune the seen-index
  const keepAfter = started.getTime() - SEEN_KEEP_DAYS * 24 * 3600_000;
  for (const idx of Object.values(seenIdx.hunts)) for (const [id, t] of Object.entries(idx)) if (Date.parse(t) < keepAfter && t !== '1970-01-01T00:00:00.000Z') delete idx[id];

  // 4b — evidence beyond the title, then the final evaluation of every candidate
  const byId = new Map(hunts.map((h) => [h.id, h]));
  const feedback = await loadFeedback(o.store);
  const firstPass = [...fresh.values()].flat();
  const det = await loadDetails(firstPass, o.provider, o.store, clock(), o.detailsBudget ?? DETAILS_PER_RUN);
  const photoCache = await loadPhotoCache(o.store);
  const hashes = new Map<string, string>(Object.entries(photoCache.items).map(([id, v]) => [id, v.hash]));
  const runPhotoIds = new Set<string>();
  let photosHashed = 0;
  if (o.hashPhotos !== false) {
    const photoCands = firstPass.filter((x) => x.evaluation.classification !== 'reject' && x.listing.imageUrl && byId.get(x.evaluation.huntId)?.vertical !== 'grails');
    for (const x of photoCands) {
      const id = x.listing.itemId;
      const cachedPhoto = photoCache.items[id];
      if (cachedPhoto && cachedPhoto.url === x.listing.imageUrl) { runPhotoIds.add(id); continue; }
      if (photosHashed >= PHOTOS_PER_RUN) continue;
      photosHashed++;
      const hsh = await hashPhoto(x.listing.imageUrl!, o.fetchImpl);
      if (hsh) {
        hashes.set(id, hsh);
        photoCache.items[id] = { hash: hsh, url: x.listing.imageUrl!, at: nowIso, seller: x.listing.seller?.username ?? null };
        runPhotoIds.add(id);
      }
    }
  }
  // a match against an older listing from the SAME seller is a relist, not a reused photo
  const sellerOf = new Map(firstPass.map((x) => [x.listing.itemId, x.listing.seller?.username ?? null]));
  const reused = new Map<string, string[]>();
  for (const [id, others] of reusedPhotos(hashes, runPhotoIds)) {
    const mine = sellerOf.get(id);
    const keep = others.filter((oid) => runPhotoIds.has(oid) || !mine || (photoCache.items[oid]?.seller ?? null) !== mine);
    if (keep.length) reused.set(id, keep);
  }
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
        evaluation: evaluate(h, l, { details: d ? { aspects: d.aspects, description: d.description } : null, flags: extra, feedback: feedbackFor(feedback, h.id, l.itemId, l.seller?.username), recallOnly: recallOnly.has(`${h.id}|${l.itemId}`) }),
        details: d ? { aspects: d.aspects, descriptionSnippet: d.descriptionSnippet, fetchedAt: d.fetchedAt } : undefined,
        recallOnly: recallOnly.has(`${h.id}|${l.itemId}`) || undefined,
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
  log(`[hunt] evidence: ${det.fetched} item lookups (${det.secondLook} second looks at borderline rejects, ${det.cached} cached) · ${photosHashed} photos hashed (${runPhotoIds.size - photosHashed} from cache) · ${[...reused.keys()].length} reused photos · ${feedback.dismissed.size} dismissed · ${feedback.blockedSellers.size + feedback.learnedSellers.size} blocked sellers`);

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
    // what an earlier run found and this one didn't re-read: drop ended auctions and anything you dismissed since
    const carry = () => {
      const ids = new Set((fresh.get(r.huntId) ?? []).map((x) => x.listing.itemId));
      const h = byId.get(r.huntId)!;
      return (before?.observations ?? []).filter((x) =>
        !ids.has(x.listing.itemId) &&
        !(x.listing.endsAt && Date.parse(x.listing.endsAt) < finished.getTime()) &&
        !feedbackFor(feedback, r.huntId, x.listing.itemId, x.listing.seller?.username) &&
        // today's rules still apply to what's carried: a listing the current title rules reject drops now, not at the next sweep
        evaluate(h, x.listing, { details: x.details ? { aspects: x.details.aspects, description: '' } : null, recallOnly: x.recallOnly }).classification !== 'reject');
    };
    const fullSweepAt = r.sweep === 'full' ? r.searchedAt : before?.lastFullSweepAt ?? null;
    if (r.state === 'complete' && r.sweep === 'full') {
      manifest.hunts[r.huntId] = { lastSearchState: 'complete', lastSearchedAt: r.searchedAt, lastSuccessfulAt: r.searchedAt, lastSuccessfulRunId: runId, lastFullSweepAt: fullSweepAt, error: null, observations: obs };
    } else if (r.state === 'complete') {
      manifest.hunts[r.huntId] = { lastSearchState: 'complete', lastSearchedAt: r.searchedAt, lastSuccessfulAt: r.searchedAt, lastSuccessfulRunId: runId, lastFullSweepAt: fullSweepAt, error: null, observations: [...obs, ...carry()] };
    } else if (r.state === 'partial') {
      manifest.hunts[r.huntId] = { lastSearchState: 'partial', lastSearchedAt: r.searchedAt, lastSuccessfulAt: before?.lastSuccessfulAt ?? null, lastSuccessfulRunId: before?.lastSuccessfulRunId ?? null, lastFullSweepAt: before?.lastFullSweepAt ?? null, error: r.error, observations: [...obs, ...carry()] };
    } else {
      manifest.hunts[r.huntId] = {
        lastSearchState: r.state === 'not-searched' && before ? before.lastSearchState : r.state,
        lastSearchedAt: r.state === 'not-searched' ? before?.lastSearchedAt ?? null : r.searchedAt,
        lastSuccessfulAt: before?.lastSuccessfulAt ?? null,
        lastSuccessfulRunId: before?.lastSuccessfulRunId ?? null,
        lastFullSweepAt: before?.lastFullSweepAt ?? null,
        error: r.state === 'not-searched' ? before?.error ?? null : r.error,
        observations: before?.observations ?? [],
      };
    }
  }

  // 8 — only hunts this run actually searched feed the ledger
  const searchedObs = [...fresh.entries()].flatMap(([, obs]) => obs);
  // only a full sweep proves an item is gone — a delta scan never expires an alert
  const complete = new Set(results.filter((r) => r.state === 'complete' && r.sweep === 'full').map((r) => r.huntId));
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
    discovery,
    generatedAt: finishedAt,
    run: {
      id: runId, state, mode: o.mode, startedAt, finishedAt,
      succeededAt: manifest.lastFullSuccessAt,
      huntsTotal, huntsComplete,
      providerHealth: o.provider.health(),
      promoted, staleAfterMinutes,
      discovery: {
        searches: searches.size,
        fullSweeps: results.filter((r) => r.sweep === 'full').length,
        deltaScans: results.filter((r) => r.sweep === 'delta').length,
        newThisRun: [...discovery.values()].reduce((a, d) => a + d.newThisRun, 0),
        newToday: [...discovery.values()].reduce((a, d) => a + d.newToday, 0),
        secondLooks: det.secondLook,
      },
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
  await putJson(o.store, SEEN_KEY, seenIdx);
  if (o.hashPhotos !== false) await savePhotoCache(o.store, photoCache);
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
    discovery: {
      searches: searches.size,
      fullSweeps: results.filter((r) => r.sweep === 'full').length,
      deltaScans: results.filter((r) => r.sweep === 'delta').length,
      newThisRun: [...discovery.values()].reduce((a, d) => a + d.newThisRun, 0),
      secondLooks: det.secondLook,
    },
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
