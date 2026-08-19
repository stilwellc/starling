/**
 * gate.ts — the honesty gate. A pinned listing becomes a deal only if it clears
 * these, exactly as lectr's own deep-value board does (close-board.ts:127-128):
 *
 *   all-in = item price + cheapest shipping   (lectr's all-in doctrine, buy-side)
 *   depth  = 1 - allIn/med
 *   keep iff  depth ∈ [0.25, 0.90]  AND  no condition flag in the title
 *
 * The 0.90 ceiling is the ONE hard suppression in Starling: deeper than 90%
 * under book reads as fake/scam (the "Missing Back at 96%" lesson). The 0.25
 * floor: shallower isn't a deal after fees and risk. Everything else is shown
 * and ranked — never silently dropped.
 */
import type { EbayListing, ValueBookRow } from './types';
import { hasConditionFlag, conditionFlags } from './lib/condition';

export const MIN_DEPTH = 0.25;
export const MAX_DEPTH = 0.9;

export interface GateResult {
  pass: boolean;
  allIn: number;
  depth: number;
  reason?: 'too-shallow' | 'scam-cap' | 'condition-flag' | 'no-price';
  conditionFlags: string[];
}

/** all-in = item + cheapest shipping. Unknown/calculated shipping → item only,
 *  with a note; we never invent a shipping number. */
export function allInOf(listing: EbayListing): number {
  const ship = listing.shippingCost == null ? 0 : listing.shippingCost;
  return listing.price + ship;
}

export function gate(listing: EbayListing, row: ValueBookRow): GateResult {
  const flags = conditionFlags(listing.title);
  const allIn = allInOf(listing);
  if (!(allIn > 0) || !(row.med > 0)) {
    return { pass: false, allIn, depth: 0, reason: 'no-price', conditionFlags: flags };
  }
  const depth = 1 - allIn / row.med;
  if (hasConditionFlag(listing.title)) {
    return { pass: false, allIn, depth, reason: 'condition-flag', conditionFlags: flags };
  }
  if (depth > MAX_DEPTH) {
    return { pass: false, allIn, depth, reason: 'scam-cap', conditionFlags: flags };
  }
  if (depth < MIN_DEPTH) {
    return { pass: false, allIn, depth, reason: 'too-shallow', conditionFlags: flags };
  }
  return { pass: true, allIn, depth, conditionFlags: flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// The hunt gate (PROPOSAL §4.4) — same honesty rules, two per-entry overrides
// ─────────────────────────────────────────────────────────────────────────────

export interface HuntGateResult {
  pass: boolean;
  allIn: number;
  /** present ONLY when a book row priced the hit; the noBook path carries no
   *  depth — no median, no manufactured number */
  depth?: number;
  reason?: 'too-shallow' | 'scam-cap' | 'condition-flag' | 'no-price' | 'over-ceiling';
  conditionFlags: string[];
}

/**
 * Gate a hunt hit. With a book row this is the board gate with two per-entry
 * knobs: `maxAllIn` (a ceiling — a grail, but not at any price) and `minDepth`
 * (a LOOSER floor than 0.25, because for a hunted grail "fairly priced and
 * rare" is itself a find). The 0.90 scam cap is NEVER overridable — hunt.ts
 * refuses to load a minDepth at or past it, and no ceiling exists here to move.
 * Without a row (the "hunted — no book value" path) only the fact checks run:
 * a real price, under the ceiling, no condition flag — no depth is computed
 * because no honest depth exists.
 */
export function huntGate(
  listing: EbayListing,
  overrides: { maxAllIn?: number; minDepth?: number },
  row?: ValueBookRow,
): HuntGateResult {
  const flags = conditionFlags(listing.title);
  const allIn = allInOf(listing);
  if (!(allIn > 0)) {
    return { pass: false, allIn, reason: 'no-price', conditionFlags: flags };
  }
  if (hasConditionFlag(listing.title)) {
    return { pass: false, allIn, reason: 'condition-flag', conditionFlags: flags };
  }
  if (overrides.maxAllIn != null && allIn > overrides.maxAllIn) {
    return { pass: false, allIn, reason: 'over-ceiling', conditionFlags: flags };
  }
  if (!row) {
    return { pass: true, allIn, conditionFlags: flags }; // facts only — no depth
  }
  if (!(row.med > 0)) {
    return { pass: false, allIn, reason: 'no-price', conditionFlags: flags };
  }
  const depth = 1 - allIn / row.med;
  if (depth > MAX_DEPTH) {
    return { pass: false, allIn, depth, reason: 'scam-cap', conditionFlags: flags };
  }
  if (depth < (overrides.minDepth ?? MIN_DEPTH)) {
    return { pass: false, allIn, depth, reason: 'too-shallow', conditionFlags: flags };
  }
  return { pass: true, allIn, depth, conditionFlags: flags };
}
