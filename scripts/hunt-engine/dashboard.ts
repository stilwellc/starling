/**
 * dashboard.ts — ONE versioned view model. The Hunt page renders it and the
 * /api/v1/* endpoints serve it, so the page and the API always report the same
 * run. Pure module (no node imports) — Cloudflare Pages Functions import it.
 *
 * Card order: new unders → materially changed unders → other unders → watch →
 * over. Hunt rows carry coverage so a failed or unsearched hunt can never read
 * as "0 matches".
 */
import { HUNT_LIST_META, HUNT_NOTES, MANUAL_RESEARCH_BRIEF, type Hunt } from './hunts';
import type {
  AlertLedger, AlertRecord, AlertState, Classification, DataMode, HuntRunState, Manifest, ProviderHealth, RunState,
} from './types';

export const DASHBOARD_SCHEMA = 1 as const;
const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

export type CardGroup = 'new-under' | 'changed-under' | 'under' | 'watch' | 'over';
export const GROUP_ORDER: CardGroup[] = ['new-under', 'changed-under', 'under', 'watch', 'over'];
export const GROUP_LABEL: Record<CardGroup, string> = {
  'new-under': 'New unders',
  'changed-under': 'Changed unders',
  under: 'Under cap',
  watch: 'Watching',
  over: 'Over cap',
};

export interface DashboardRun {
  id: string;
  state: RunState;
  mode: DataMode;
  startedAt: string;
  finishedAt: string;
  /** last run that searched every hunt successfully (null if none yet) */
  succeededAt: string | null;
  huntsTotal: number;
  huntsComplete: number;
  providerHealth: ProviderHealth;
  promoted: boolean;
  staleAfterMinutes: number;
}

export interface HuntRow {
  id: string;
  label: string;
  vertical: Hunt['vertical'];
  section: string;
  scope: string;
  query: string;
  maxAllIn: number | null;
  priority: number;
  state: HuntRunState;
  lastSearchedAt: string | null;
  lastSuccessfulAt: string | null;
  /** results shown come from an earlier run because this one could not search the hunt */
  carried: boolean;
  error: string | null;
  matchCount: number;
  underCount: number;
  overCount: number;
  watchCount: number;
}

export interface Card {
  key: string;
  group: CardGroup;
  huntId: string;
  huntLabel: string;
  classification: Exclude<Classification, 'reject'>;
  listingId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  buyingMode: 'FIXED_PRICE' | 'AUCTION';
  endsAt: string | null;
  bidCount: number | null;
  price: number;
  shipping: number | null;
  allIn: number | null;
  maxAllIn: number | null;
  underBy: number | null;
  underPct: number | null;
  capWording: string;
  seller: { username: string | null; feedbackPercentage: number | null; feedbackScore: number | null } | null;
  condition: string | null;
  location: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  reasons: string[];
  flags: string[];
  confidence: number;
  review: 'ok' | 'review';
  carried: boolean;
  alertKey: string | null;
  /** same-seller, same-title repeats folded into this card */
  similarCount: number;
  /** fake / misrepresentation risk, with plain-English reasons */
  risk: 'high' | 'medium' | 'low';
  riskReasons: string[];
  details?: { aspects: Record<string, string>; descriptionSnippet: string | null; fetchedAt: string } | null;
  priceHistory?: Array<{ at: string; price: number; allIn: number | null }>;
  priceChange?: { from: number; to: number; since: string } | null;
  relisted?: { firstSeenAt: string; previousItemIds: string[] } | null;
  photoReused?: { count: number; otherListingIds: string[] } | null;
  dismissible: boolean;
}

export interface DashboardPayload {
  schemaVersion: typeof DASHBOARD_SCHEMA;
  generatedAt: string;
  run: DashboardRun;
  meta: {
    list: typeof HUNT_LIST_META;
    notes: typeof HUNT_NOTES;
    research: typeof MANUAL_RESEARCH_BRIEF;
  };
  hunts: HuntRow[];
  cards: Card[];
  alerts: Array<AlertRecord & { state: AlertState; trigger: string; version: number }>;
  counts: { cards: number; under: number; newUnder: number; watch: number; over: number; pendingAlerts: number; highRisk: number };
}

export function buildDashboard(args: {
  hunts: Hunt[];
  manifest: Manifest;
  ledger: AlertLedger;
  run: DashboardRun;
  createdThisRun: Map<string, { alertKey: string; trigger: string }>;
  generatedAt: string;
}): DashboardPayload {
  const { hunts, manifest, ledger, run, createdThisRun, generatedAt } = args;
  const byId = new Map(hunts.map((h) => [h.id, h]));
  const cards: Card[] = [];
  const rows: HuntRow[] = [];

  for (const h of hunts) {
    const m = manifest.hunts[h.id];
    const obs = m?.observations ?? [];
    const carried = !!m && m.lastSearchState !== 'complete' && obs.length > 0;
    let under = 0, over = 0, watch = 0;
    for (const o of obs) {
      const e = o.evaluation;
      if (e.classification === 'reject') continue;
      if (e.classification === 'under') under++;
      else if (e.classification === 'over') over++;
      else watch++;
      const track = ledger.tracks[`${h.id}|${o.listing.itemId}`];
      const made = createdThisRun.get(`${h.id}|${o.listing.itemId}`);
      const group: CardGroup =
        e.classification === 'under'
          ? made ? (made.trigger === 'first-under' ? 'new-under' : 'changed-under') : 'under'
          : e.classification;
      const pendingKey = track ? `ebay:${o.listing.itemId}:${h.id}:v${track.version}` : null;
      const l = o.listing;
      cards.push({
        key: `${h.id}:${l.itemId}`,
        group,
        huntId: h.id,
        huntLabel: h.label,
        classification: e.classification,
        listingId: l.itemId,
        title: l.title,
        url: l.url,
        imageUrl: l.imageUrl,
        buyingMode: l.buyingMode,
        endsAt: l.endsAt,
        bidCount: l.bidCount,
        price: l.price,
        shipping: l.shipping,
        allIn: e.allIn,
        maxAllIn: e.maxAllIn,
        underBy: e.underBy,
        underPct: e.underPct,
        capWording: e.capWording,
        seller: l.seller,
        condition: l.condition,
        location: l.location,
        firstSeenAt: track?.firstSeenAt ?? l.fetchedAt,
        lastSeenAt: track?.lastSeenAt ?? l.fetchedAt,
        reasons: e.reasons,
        flags: e.flags,
        confidence: e.confidence,
        review: e.review,
        carried,
        alertKey: pendingKey && ledger.alerts[pendingKey] ? pendingKey : null,
        similarCount: o.similar?.length ?? 0,
        risk: e.risk ?? 'low',
        riskReasons: e.riskReasons ?? [],
        details: o.details ?? null,
        priceHistory: track?.priceHistory ?? [],
        priceChange: priceChangeOf(track?.priceHistory),
        relisted: o.relistedFrom ?? null,
        photoReused: o.photoReusedWith?.length ? { count: o.photoReusedWith.length, otherListingIds: o.photoReusedWith } : null,
        dismissible: true,
      });
    }
    rows.push({
      id: h.id,
      label: h.label,
      vertical: h.vertical,
      section: h.section,
      scope: h.scope,
      query: h.query,
      maxAllIn: h.maxAllIn,
      priority: h.priority,
      state: m?.lastSearchState ?? 'not-searched',
      lastSearchedAt: m?.lastSearchedAt ?? null,
      lastSuccessfulAt: m?.lastSuccessfulAt ?? null,
      carried,
      error: m?.error ?? null,
      matchCount: under + over + watch,
      underCount: under,
      overCount: over,
      watchCount: watch,
    });
  }

  const rank = (c: Card) => GROUP_ORDER.indexOf(c.group);
  cards.sort((a, b) =>
    rank(a) - rank(b) ||
    RISK_RANK[a.risk] - RISK_RANK[b.risk] ||
    (a.review === 'review' ? 1 : 0) - (b.review === 'review' ? 1 : 0) ||
    (b.underPct ?? -Infinity) - (a.underPct ?? -Infinity) ||
    (byId.get(a.huntId)!.priority - byId.get(b.huntId)!.priority) ||
    a.listingId.localeCompare(b.listingId));

  const alerts = Object.values(ledger.alerts)
    .map((a) => ({ ...a.record, state: a.state, trigger: a.trigger, version: a.version }))
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || a.alertKey.localeCompare(b.alertKey));

  return {
    schemaVersion: DASHBOARD_SCHEMA,
    generatedAt,
    run,
    meta: { list: HUNT_LIST_META, notes: HUNT_NOTES, research: MANUAL_RESEARCH_BRIEF },
    hunts: rows,
    cards,
    alerts,
    counts: {
      cards: cards.length,
      under: cards.filter((c) => c.classification === 'under').length,
      newUnder: cards.filter((c) => c.group === 'new-under').length,
      watch: cards.filter((c) => c.group === 'watch').length,
      over: cards.filter((c) => c.group === 'over').length,
      pendingAlerts: alerts.filter((a) => a.state === 'pending').length,
      highRisk: cards.filter((c) => c.risk === 'high').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API views — shared by the Pages Functions and the tests
// ─────────────────────────────────────────────────────────────────────────────

/** the run's state as of `now`: a run older than staleAfterMinutes reads "stale" */
export function effectiveState(run: DashboardRun, now: number): 'success' | 'partial' | 'failed' | 'stale' {
  const ref = Date.parse(run.finishedAt);
  if (Number.isFinite(ref) && now - ref > run.staleAfterMinutes * 60_000) return 'stale';
  return run.state;
}

export function runView(d: DashboardPayload, now: number) {
  return {
    id: d.run.id,
    state: effectiveState(d.run, now),
    mode: d.run.mode,
    startedAt: d.run.startedAt,
    succeededAt: d.run.succeededAt,
    huntsTotal: d.run.huntsTotal,
    huntsComplete: d.run.huntsComplete,
    providerHealth: d.run.providerHealth,
  };
}

export function statusResponse(d: DashboardPayload, now: number) {
  return {
    schemaVersion: 1 as const,
    generatedAt: d.generatedAt,
    run: { ...runView(d, now), finishedAt: d.run.finishedAt, promoted: d.run.promoted, staleAfterMinutes: d.run.staleAfterMinutes },
    counts: d.counts,
  };
}

export function huntsResponse(d: DashboardPayload, now: number) {
  return { schemaVersion: 1 as const, generatedAt: d.generatedAt, run: runView(d, now), meta: d.meta, hunts: d.hunts };
}

export const ALERT_PAGE_SIZE = 50;

export function alertsResponse(
  d: DashboardPayload,
  now: number,
  opts: { state?: string | null; cursor?: string | null; limit?: number | null },
) {
  const state = opts.state && ['pending', 'delivered', 'expired', 'all'].includes(opts.state) ? opts.state : 'pending';
  const limit = Math.min(Math.max(Number(opts.limit) || ALERT_PAGE_SIZE, 1), 200);
  // most trustworthy first: fake risk, confidence, then how far under, then a stable key
  const all = d.alerts
    .filter((a) => state === 'all' || a.state === state)
    .slice()
    .sort((a, b) => RISK_RANK[a.risk ?? 'low'] - RISK_RANK[b.risk ?? 'low'] || b.confidence - a.confidence || (b.underPct ?? -1) - (a.underPct ?? -1) || a.alertKey.localeCompare(b.alertKey));
  let start = 0;
  if (opts.cursor) {
    const idx = all.findIndex((a) => a.alertKey === decodeCursor(opts.cursor!));
    start = idx >= 0 ? idx + 1 : all.length;
  }
  const page = all.slice(start, start + limit);
  const last = page[page.length - 1];
  return {
    schemaVersion: 1 as const,
    generatedAt: d.generatedAt,
    run: runView(d, now),
    alerts: page.map(({ state: _s, trigger: _t, version: _v, ...rec }) => rec),
    nextCursor: start + limit < all.length && last ? encodeCursor(last.alertKey) : null,
  };
}

function b64(s: string) {
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64');
}
function unb64(s: string) {
  return typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('utf8');
}
export const encodeCursor = (alertKey: string) => b64(alertKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodeCursor(c: string): string {
  try { return unb64(c.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

/** first recorded all-in (or price) → current, when it moved */
export function priceChangeOf(h: Array<{ at: string; price: number; allIn: number | null }> | undefined) {
  if (!h || h.length < 2) return null;
  const v = (p: { price: number; allIn: number | null }) => p.allIn ?? p.price;
  const first = h[0], last = h[h.length - 1];
  return v(first) === v(last) ? null : { from: v(first), to: v(last), since: first.at };
}
