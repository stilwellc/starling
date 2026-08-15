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
