/**
 * scheduler.ts — where the anti-cards-trap actually lives.
 *
 * The value book has ~10× more sports-card keys than anything else. Left alone,
 * a poll loop would spend the whole eBay call budget on cards, the board would
 * fill with cards by sheer volume, and the differentiated verticals would
 * starve — data abundance becoming attention monopoly. The guard is here, in
 * budget allocation, NOT in ranking (ranking stays honest: cards get no penalty).
 *
 *   - the HUNT LIST is paid FIRST: 10% reserved off the top (§4.4), before the
 *     split below — curated priorities are never rationed against key count.
 *   - of the remainder: sports-cards is CAPPED at 40% of the daily call budget.
 *   - every other launch vertical gets a FLOOR of 15%.
 *   - the rest is elastic, spent where trailing yield is highest.
 *
 * Cards remain first-class and fully polled — they just can't eat the budget.
 */
import type { Vertical, EbayQuery, ValueBookRow, VerticalMatcher } from './types';
import { LAUNCH_VERTICALS } from './types';
import type { CompiledHuntQuery } from './hunt';

export const DAILY_CALL_BUDGET = 5000; // confirmed default Browse quota (PROPOSAL §5.4)
const CARDS_CAP = 0.4;
const OTHER_FLOOR = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// The hunt reserve — curated priorities are paid FIRST (PROPOSAL §4.4 / §5.4)
// ─────────────────────────────────────────────────────────────────────────────

/** 10% of the daily budget comes off the top for hunt/priority.yaml BEFORE the
 *  cards-cap/vertical-floor split. The hunt list is small by design (tens of
 *  entries, not thousands), so this is ample — and it means a curated grail is
 *  never rationed against the book's key count. */
export const HUNT_RESERVE = 0.1;

/** Split the daily budget: the hunt's reserve off the top, the rest to the
 *  book-driven split (allocateBudget). Pure function — no clock, no state. */
export function reserveHuntBudget(total = DAILY_CALL_BUDGET): {
  huntBudget: number;
  bookBudget: number;
} {
  const huntBudget = Math.floor(total * HUNT_RESERVE);
  return { huntBudget, bookBudget: total - huntBudget };
}

export interface VerticalPlan {
  vertical: Vertical;
  queries: EbayQuery[];
  /** calls this vertical may spend this run (Tier-1 budget slice) */
  callBudget: number;
}

/** Trailing yield (deals/call) per vertical, persisted in R2 state; absent on
 *  first run. Drives the elastic remainder only — floors/cap are inviolable. */
export type YieldMap = Partial<Record<Vertical, number>>;

/** Split the budget across verticals: cap cards, floor the rest, hand the slack
 *  to the highest trailing yield. Pure function of its inputs (no clock/rand). */
export function allocateBudget(
  verticals: Vertical[],
  yields: YieldMap,
  total = DAILY_CALL_BUDGET,
): Record<Vertical, number> {
  const out = {} as Record<Vertical, number>;
  const others = verticals.filter((v) => v !== 'sports-cards');

  // 1. floors for the non-card verticals
  let allocated = 0;
  for (const v of others) {
    out[v] = Math.floor(total * OTHER_FLOOR);
    allocated += out[v];
  }
  // 2. cards get up to the cap, but never more than what's left
  if (verticals.includes('sports-cards')) {
    out['sports-cards'] = Math.min(Math.floor(total * CARDS_CAP), total - allocated);
    allocated += out['sports-cards'];
  }
  // 3. elastic remainder → highest trailing yield (default: even split)
  const remainder = total - allocated;
  if (remainder > 0) {
    const weights = verticals.map((v) => Math.max(yields[v] ?? 0.0001, 0.0001));
    const sum = weights.reduce((a, b) => a + b, 0);
    verticals.forEach((v, i) => {
      // cards stay capped even when they have the best yield
      if (v === 'sports-cards') return;
      out[v] += Math.floor((remainder * weights[i]) / sum);
    });
  }
  return out;
}

/** Tier-1 queries a single vertical may fire in ONE run. The daily budget is a
 *  ceiling across ALL runs (~8/day at the 3h cadence); a single run must poll a
 *  small BATCH, not the whole book — the real book has thousands of keys, and
 *  firing them all at once blows the job timeout and the daily quota. */
export const PER_RUN_QUERIES = 45;
const ROTATE_PERIOD_MS = 3 * 60 * 60 * 1000; // one cron tick
const RUNS_PER_DAY = Math.floor((24 * 60 * 60 * 1000) / ROTATE_PERIOD_MS); // 8 at the 3h cadence

export interface HuntPlan {
  queries: CompiledHuntQuery[];
  /** Tier-1 calls the hunt lane may spend THIS run */
  callBudget: number;
}

/**
 * Plan the hunt lane: EVERY compiled query, EVERY run — hunt targets never ride
 * the rotating wheel (§4.4). The daily reserve is spread across the day's runs;
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

/** Compile the poll plan: budget split, then a per-run WINDOW of each vertical's
 *  queries that rotates each tick, so over time every key gets polled while any
 *  single run stays fast and quota-safe. `now` drives the rotation offset. */
export function planRun(
  matchers: VerticalMatcher[],
  byVertical: Map<Vertical, ValueBookRow[]>,
  yields: YieldMap,
  now: number,
  callsPerQuery = 1,
  total = DAILY_CALL_BUDGET,
): VerticalPlan[] {
  const present = matchers.map((m) => m.vertical).filter((v) => LAUNCH_VERTICALS.includes(v));
  const budget = allocateBudget(present, yields, total);
  const windowIdx = Math.floor(now / ROTATE_PERIOD_MS);
  return matchers.map((m) => {
    const rows = (byVertical.get(m.vertical) ?? []).slice().sort((a, b) => b.med - a.med);
    const allQueries = m.queriesFor(rows);
    const callBudget = budget[m.vertical] ?? 0;
    const cap = Math.max(0, Math.min(PER_RUN_QUERIES, Math.floor(callBudget / callsPerQuery), allQueries.length));
    let queries: EbayQuery[];
    if (allQueries.length <= cap) {
      queries = allQueries;
    } else {
      // rotate a cap-sized window through the full key list, tick by tick
      const start = (windowIdx * cap) % allQueries.length;
      queries = [];
      for (let i = 0; i < cap; i++) queries.push(allQueries[(start + i) % allQueries.length]);
    }
    return { vertical: m.vertical, queries, callBudget };
  });
}
