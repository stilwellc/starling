/**
 * scheduler.ts — where the anti-cards-trap actually lives.
 *
 * REBUILT for the sweep engine (Aug 2026 funnel audit). The old per-key plan
 * (PER_RUN_QUERIES=45, rotating window) spent ~40% of quota to visit 2% of the
 * book per run — sports-card keys came around every ~12 days and ~60% of the
 * 5,000/day search quota went unspent. The wide net (sweep.ts) replaces it:
 * category sweeps discover everything newly listed, and identity is free
 * (bulk identify against an in-memory book map). This module's job shrinks to
 * BUDGET: who may spend how many search calls per run.
 *
 *   - the HUNT LIST is paid FIRST: 10% reserved off the top (§4.4), before the
 *     sweep split — curated priorities are never rationed against key count.
 *   - of the remainder: the CARDS-lane slices combined are CAPPED at 40% of
 *     the per-run sweep calls (the anti-cards-trap, moved here from the old
 *     per-vertical split — cards get the biggest single share and no more).
 *   - every other slice splits the rest evenly — a hot slice can't starve the
 *     others, because the caps are per-slice page budgets, not a shared pool.
 *
 * Cards remain first-class and fully swept — they just can't eat the budget.
 * Ranking stays honest (no vertical term); receipts re-checks and enrichment
 * ride the SEPARATE getItems quota bucket and don't ration against any of this.
 */
import type { CompiledHuntQuery } from './hunt';

export const DAILY_CALL_BUDGET = 5000; // confirmed default Browse SEARCH quota (PROPOSAL §5.4)
const ROTATE_PERIOD_MS = 3 * 60 * 60 * 1000; // one cron tick
export const RUNS_PER_DAY = Math.floor((24 * 60 * 60 * 1000) / ROTATE_PERIOD_MS); // 8 at the 3h cadence

// ─────────────────────────────────────────────────────────────────────────────
// The hunt reserve — curated priorities are paid FIRST (PROPOSAL §4.4 / §5.4)
// ─────────────────────────────────────────────────────────────────────────────

/** 10% of the daily budget comes off the top for hunt/priority.yaml BEFORE the
 *  sweep split. The hunt list is small by design (tens of entries, not
 *  thousands), so this is ample — and it means a curated grail is never
 *  rationed against the book's key count. */
export const HUNT_RESERVE = 0.1;

/** Split the daily budget: the hunt's reserve off the top, the rest to the
 *  sweeps (allocateSweepBudget). Pure function — no clock, no state. */
export function reserveHuntBudget(total = DAILY_CALL_BUDGET): {
  huntBudget: number;
  bookBudget: number;
} {
  const huntBudget = Math.floor(total * HUNT_RESERVE);
  return { huntBudget, bookBudget: total - huntBudget };
}

export interface HuntPlan {
  queries: CompiledHuntQuery[];
  /** Tier-1 calls the hunt lane may spend THIS run */
  callBudget: number;
}

/**
 * Plan the hunt lane: EVERY compiled query, EVERY run — hunt targets never ride
 * a rotating wheel (§4.4). The daily reserve is spread across the day's runs;
 * if the list ever outgrows its per-run slice we truncate the TAIL (yaml order
 * = the operator's priority order) and say so loudly — a squeezed hunt list is
 * an operator decision to make, never a silent drop.
 */
export function planHunt(
  compiled: CompiledHuntQuery[],
  callsPerQuery = 1,
  total = DAILY_CALL_BUDGET,
): HuntPlan {
  const { huntBudget } = reserveHuntBudget(total);
  const perRunCalls = Math.floor(huntBudget / RUNS_PER_DAY);
  const cap = Math.max(0, Math.floor(perRunCalls / callsPerQuery));
  if (compiled.length > cap) {
    const cut = compiled.slice(cap);
    console.warn(
      `[scheduler] HUNT LIST OVER BUDGET: ${compiled.length} queries vs ${cap} per-run calls ` +
        `(${huntBudget}/day reserved). Truncating the tail — NOT polled this run: ` +
        cut.map((c) => c.entry.id).filter((v, i, a) => a.indexOf(v) === i).join(', ') +
        `. Trim hunt/priority.yaml or raise the reserve.`,
    );
  }
  return { queries: compiled.slice(0, cap), callBudget: perRunCalls };
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep split — per-slice page budgets (the anti-cards-trap, relocated)
// ─────────────────────────────────────────────────────────────────────────────

/** Cards-lane slices COMBINED may spend at most this share of the per-run
 *  sweep calls. The trap the guard prevents is unchanged from day one: data
 *  abundance becoming attention monopoly. */
export const CARDS_SWEEP_CAP = 0.4;

/** The AUCTION lane (closing calls) gets its own carve-out FIRST — ~20% of the
 *  per-run sweep calls, split evenly across auction slices. Ending-soon
 *  windows are small (the 4h itemEndDate filter IS the pagination bound), so
 *  this is ample — and the BIN net can never starve the closing lane, nor the
 *  reverse. */
export const AUCTION_SWEEP_CAP = 0.2;

/** What allocateSweepBudget needs to know about a slice — kept structural so
 *  scheduler.ts never imports sweep.ts (budget must not depend on the net). */
export interface SweepLaneInfo {
  id: string;
  lane: 'cards' | 'other' | 'auction';
}

/**
 * Per-run, per-slice search-call budgets. Deterministic, pure:
 *   perRun      = floor(bookBudget / RUNS_PER_DAY)        (562 at defaults)
 *   auctionPool = floor(perRun × 0.2) split evenly across auction slices
 *   cardsPool   = floor(remainder × 0.4) split evenly across cards-lane slices
 *   the rest    split evenly across the other slices
 * Every slice gets a HARD page cap — one hot slice can't starve the rest, and
 * the cards lane can't eat the run no matter how deep 261328 flows.
 */
/** The goldmine lane's share of the BIN run (post-auction): targeted per-key
 *  searches for the book's highest-stakes living rows (goldmine.ts, Aug 21
 *  2026 — "the goldmine IS the lectr DB"). Carved BEFORE the category sweeps
 *  so discovery spends a fixed quarter of its budget where the book can
 *  already price. */
export const GOLDMINE_CAP = 0.25;

/** Per-run search calls reserved for the goldmine lane. */
export function goldmineBudget(slices: SweepLaneInfo[], total = DAILY_CALL_BUDGET): number {
  const { bookBudget } = reserveHuntBudget(total);
  const perRun = Math.floor(bookBudget / RUNS_PER_DAY);
  const auctionPool = slices.some((s) => s.lane === 'auction')
    ? Math.floor(perRun * AUCTION_SWEEP_CAP)
    : 0;
  return Math.floor((perRun - auctionPool) * GOLDMINE_CAP);
}

export function allocateSweepBudget(
  slices: SweepLaneInfo[],
  total = DAILY_CALL_BUDGET,
): Record<string, number> {
  const { bookBudget } = reserveHuntBudget(total);
  const perRun = Math.floor(bookBudget / RUNS_PER_DAY);
  const auctions = slices.filter((s) => s.lane === 'auction');
  const cards = slices.filter((s) => s.lane === 'cards');
  const others = slices.filter((s) => s.lane === 'other');
  const out: Record<string, number> = {};
  const auctionPool = auctions.length ? Math.floor(perRun * AUCTION_SWEEP_CAP) : 0;
  for (const s of auctions) out[s.id] = Math.floor(auctionPool / auctions.length);
  // goldmine comes off the BIN run first — the sweeps split what remains
  const binRun = perRun - auctionPool - goldmineBudget(slices, total);
  const cardsPool = cards.length ? Math.floor(binRun * CARDS_SWEEP_CAP) : 0;
  for (const s of cards) out[s.id] = Math.floor(cardsPool / cards.length);
  const otherPool = binRun - cardsPool;
  for (const s of others) out[s.id] = others.length ? Math.floor(otherPool / others.length) : 0;
  return out;
}
