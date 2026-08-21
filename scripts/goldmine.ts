/**
 * goldmine.ts — hunt eBay for the book's own best rows (Aug 21 2026).
 *
 * Collin's steer: "it's less generating the comps and more FINDING THE LOTS
 * that have value — the goldmine IS the lectr DB." The sweep is category
 * serendipity: newest-first firehoses that mostly find listings the book
 * can't price (noBookRow dominates every funnel). This lane INVERTS it:
 * rank every priceable book row by what a mispricing there would be WORTH —
 *
 *   goldmineScore = med × evW(lastSale, n12)
 *
 * (dollars at stake × how alive the market is) — and spend a reserved slice
 * of search quota querying eBay for those exact identities, on a
 * deterministic rotation so the whole pool is re-swept every few days.
 *
 * Discipline carried over from the hunt lane's live-fire lessons:
 *   - identity IS relevance: a hit only counts when the matcher pins the
 *     LISTING back to the SAME key the query hunted (the zip-jacket rule) —
 *     with one measured widening: a same-vertical hit on a DIFFERENT book key
 *     still prices (the query just did the sweep's job for free).
 *   - hits flow through the SAME gate → risk → rank path as sweep hits; the
 *     lane changes where we LOOK, never what QUALIFIES.
 *   - watches have no matcher queriesFor (sweep-fed by design) but are exactly
 *     the high-ticket vertical this lane exists for — their queries are
 *     synthesized from the key (brand + reference + price band).
 */
import type { EbayQuery, ValueBookRow, Vertical } from './types';
import type { VerticalMatcher } from './types';
import { evidenceWeightOf } from './score/rank';

/** A row must clear this med to be worth a dedicated search call — below it,
 *  even a 25%-deep hit can't clear the $50 edge floor. */
export const GOLDMINE_MIN_MED = 200;
/** Only living markets get dedicated calls: latest sale within 12 months. */
const GOLDMINE_MAX_AGE_MS = 12 * 30.44 * 86_400_000;
/** Pool cap — the rotation sweeps this many top rows (~3 days at defaults). */
const GOLDMINE_POOL_CAP = 4000;
/** One cron tick — the rotation step unit (matches the board cadence). */
const TICK_MS = 3 * 60 * 60 * 1000;

export interface GoldmineQuery {
  row: ValueBookRow;
  query: EbayQuery;
}

/** Select + order the pool: living, confident, high-stakes rows first. */
export function goldmineRows(rows: ValueBookRow[], now: number): ValueBookRow[] {
  const nowDate = new Date(now);
  return rows
    .filter((r) => {
      if (r.conf === 'thin') return false; // thin rows ride the sweep only
      if (r.med < GOLDMINE_MIN_MED) return false;
      const t = Date.parse(r.lastSale);
      return Number.isFinite(t) && now - t <= GOLDMINE_MAX_AGE_MS;
    })
    .map((r) => ({ r, score: r.med * evidenceWeightOf(r.lastSale, r.n12, nowDate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, GOLDMINE_POOL_CAP)
    .map((x) => x.r);
}

/** Watches/design ship no matcher queriesFor (sweep-fed) — synthesize from the
 *  key. Watch keys are "brand|reference" (identity.ts numericWatchRef), which
 *  is precisely an eBay search: "rolex 16610" in the watch leaf, band-priced. */
function synthesizedQuery(row: ValueBookRow): EbayQuery | null {
  if (row.v !== 'watches') return null; // design's 139 rows stay sweep-fed for now
  const terms = row.k.split('|').filter(Boolean).join(' ').replace(/-/g, ' ');
  if (!terms) return null;
  return {
    key: row.k,
    q: terms,
    categoryIds: ['31387'], // Wristwatches leaf — same id the sweep slices use
    priceMin: Math.round(row.lo * 0.5),
    priceMax: Math.round(row.hi * 1.15),
  };
}

/** Compile the ordered pool into per-key queries via each vertical's matcher
 *  (falling back to synthesis where the matcher is sweep-fed). Order is kept —
 *  the rotation window walks this list. */
export function compileGoldmine(
  rows: ValueBookRow[],
  matcherFor: Partial<Record<Vertical, VerticalMatcher>>,
  now: number,
): GoldmineQuery[] {
  const pool = goldmineRows(rows, now);
  // one queriesFor call per vertical (matchers compile in bulk), joined by key
  const byVertical = new Map<Vertical, ValueBookRow[]>();
  for (const r of pool) {
    const list = byVertical.get(r.v) ?? [];
    list.push(r);
    byVertical.set(r.v, list);
  }
  const queryByKey = new Map<string, EbayQuery>();
  for (const [v, vRows] of Array.from(byVertical.entries())) {
    const m = matcherFor[v];
    if (m) for (const q of m.queriesFor(vRows)) queryByKey.set(q.key, q);
  }
  const out: GoldmineQuery[] = [];
  for (const r of pool) {
    const query = queryByKey.get(r.k) ?? synthesizedQuery(r);
    if (query) out.push({ row: r, query });
  }
  return out;
}

/** The deterministic rotation window: tick index × perRun steps through the
 *  pool, wrapping — every row gets its turn, the hottest rows lead each lap,
 *  and no state file is needed (the same trick as the receipts re-check
 *  window). */
export function goldmineWindow(
  queries: GoldmineQuery[],
  now: number,
  perRun: number,
): GoldmineQuery[] {
  if (queries.length === 0 || perRun <= 0) return [];
  const take = Math.min(perRun, queries.length);
  const start = (Math.floor(now / TICK_MS) * take) % queries.length;
  const out: GoldmineQuery[] = [];
  for (let i = 0; i < take; i++) out.push(queries[(start + i) % queries.length]);
  return out;
}
