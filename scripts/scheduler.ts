/**
 * scheduler.ts — where the anti-cards-trap actually lives.
 *
 * The value book has ~10× more sports-card keys than anything else. Left alone,
 * a poll loop would spend the whole eBay call budget on cards, the board would
 * fill with cards by sheer volume, and the differentiated verticals would
 * starve — data abundance becoming attention monopoly. The guard is here, in
 * budget allocation, NOT in ranking (ranking stays honest: cards get no penalty).
 *
 *   - sports-cards is CAPPED at 40% of the daily call budget.
 *   - every other launch vertical gets a FLOOR of 15%.
 *   - the remainder is elastic, spent where trailing yield is highest.
 *
 * Cards remain first-class and fully polled — they just can't eat the budget.
 */
import type { Vertical, EbayQuery, ValueBookRow, VerticalMatcher } from './types';
import { LAUNCH_VERTICALS } from './types';

export const DAILY_CALL_BUDGET = 5000; // confirmed default Browse quota (PROPOSAL §5.4)
const CARDS_CAP = 0.4;
const OTHER_FLOOR = 0.15;

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

/** Compile the full poll plan: budget split + each matcher's queries, trimmed to
 *  its slice (hot keys — highest med × trailing depth potential — go first). */
export function planRun(
  matchers: VerticalMatcher[],
  byVertical: Map<Vertical, ValueBookRow[]>,
  yields: YieldMap,
  callsPerQuery = 1,
  total = DAILY_CALL_BUDGET,
): VerticalPlan[] {
  const present = matchers.map((m) => m.vertical).filter((v) => LAUNCH_VERTICALS.includes(v));
  const budget = allocateBudget(present, yields, total);
  return matchers.map((m) => {
    const rows = (byVertical.get(m.vertical) ?? []).slice().sort((a, b) => b.med - a.med);
    const allQueries = m.queriesFor(rows);
    const callBudget = budget[m.vertical] ?? 0;
    const maxQueries = Math.max(0, Math.floor(callBudget / callsPerQuery));
    return { vertical: m.vertical, queries: allQueries.slice(0, maxQueries), callBudget };
  });
}
