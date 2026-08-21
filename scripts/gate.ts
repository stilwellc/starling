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

/** The DOLLAR floor (Aug 20 2026, Collin: "90% of a $10 item is 9 bucks —
 *  that's not deep value"). A listing must sit at least this many dollars
 *  under book all-in, whatever its percent depth — percent floors alone let
 *  trinkets through. Applies to the BIN gate and the closing lane; the hunt
 *  gate is exempt on purpose (a curated want-list is allowed to want small
 *  things). */
export const MIN_EDGE_USD = 50;

/** The stale-book cut (Aug 20 2026, the dud diagnosis): a row whose LATEST
 *  sale is older than this prices a market that may no longer exist — the
 *  emitter ships rows up to 4y for context surfaces, but a BUY call needs
 *  living evidence. Applies to the BIN gate and the closing lane; hunt exempt
 *  (curated want-list; its hits are labeled, not certified calls). */
export const STALE_BOOK_MS = 24 * 30.44 * 86_400_000; // 24 months
export const MAX_DEPTH = 0.9;
/** conf:'thin' rows (n=3 pools) price BIN deals only this deep or deeper — a
 *  shallow read off a shallow pool isn't a call worth making. */
export const THIN_MIN_DEPTH = 0.4;
/** ladder-priced deals (basis:'ladder', ladder.ts) carry derivation error on
 *  top of band error, so they clear a raised floor too. */
export const LADDER_MIN_DEPTH = 0.35;

export interface GateResult {
  pass: boolean;
  allIn: number;
  depth: number;
  reason?:
    | 'too-shallow'
    | 'edge-floor'
    | 'stale-book'
    | 'thin-shallow'
    | 'ladder-shallow'
    | 'scam-cap'
    | 'condition-flag'
    | 'no-price';
  conditionFlags: string[];
}

/** Gate reason → the board.stats.gateReasons histogram key (schema v2). The
 *  audit's lesson: reasons were computed and then DISCARDED (`g.reason`), so
 *  "pokemon matched 58, published 0" was undiagnosable from logs. Every gated
 *  listing now increments one of these; 'noBookRow' (identity pinned, no row)
 *  is counted by the pipeline itself since no gate ever runs for it. */
export const REASON_KEY: Record<string, string> = {
  'too-shallow': 'tooShallow',
  'edge-floor': 'edgeFloor',
  'stale-book': 'staleBook',
  'thin-shallow': 'thinTooShallow',
  'ladder-shallow': 'ladderTooShallow',
  'scam-cap': 'scamCap',
  'condition-flag': 'condition',
  'no-price': 'noPrice',
  'over-ceiling': 'maxAllIn',
  // closing-lane reasons (closingGate)
  'no-bid': 'noBid',
  'end-window': 'endWindow',
  'thin-book': 'thinBook',
  'seller-floor': 'sellerFloor',
};

/** all-in = item + cheapest shipping. Unknown/calculated shipping → item only,
 *  with a note; we never invent a shipping number. */
export function allInOf(listing: EbayListing): number {
  const ship = listing.shippingCost == null ? 0 : listing.shippingCost;
  return listing.price + ship;
}

/** `opts.minDepth` raises the floor for derived pricing (LADDER_MIN_DEPTH from
 *  run-board on ladder rows); a 'thin' row raises it to THIN_MIN_DEPTH on its
 *  own. Floors only ever go UP from 0.25 — the scam cap never moves. */
export function gate(
  listing: EbayListing,
  row: ValueBookRow,
  opts?: { minDepth?: number; now?: number },
): GateResult {
  const flags = conditionFlags(listing.title);
  const allIn = allInOf(listing);
  if (!(allIn > 0) || !(row.med > 0)) {
    return { pass: false, allIn, depth: 0, reason: 'no-price', conditionFlags: flags };
  }
  const depth = 1 - allIn / row.med;
  // Living evidence first: a med whose newest sale is 2+ years old prices a
  // market that may have moved out from under it — not a certifiable call.
  const lastMs = Date.parse(row.lastSale);
  if (Number.isFinite(lastMs) && (opts?.now ?? Date.now()) - lastMs > STALE_BOOK_MS) {
    return { pass: false, allIn, depth, reason: 'stale-book', conditionFlags: flags };
  }
  if (hasConditionFlag(listing.title)) {
    return { pass: false, allIn, depth, reason: 'condition-flag', conditionFlags: flags };
  }
  if (depth > MAX_DEPTH) {
    return { pass: false, allIn, depth, reason: 'scam-cap', conditionFlags: flags };
  }
  const floor = Math.max(
    opts?.minDepth ?? MIN_DEPTH,
    row.conf === 'thin' ? THIN_MIN_DEPTH : 0,
  );
  if (depth < floor) {
    // keep the histogram diagnosable: which raised floor actually cut it?
    const reason: GateResult['reason'] =
      depth >= MIN_DEPTH
        ? row.conf === 'thin'
          ? 'thin-shallow'
          : 'ladder-shallow'
        : 'too-shallow';
    return { pass: false, allIn, depth, reason, conditionFlags: flags };
  }
  // Percent floors cleared — now the money has to be real. med − allIn is the
  // dollars on the table; under $50 it's a curiosity, not a deal.
  if (row.med - allIn < MIN_EDGE_USD) {
    return { pass: false, allIn, depth, reason: 'edge-floor', conditionFlags: flags };
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
  // A thin row's raised floor holds even against a per-entry minDepth — the
  // operator may loosen the 0.25, never the shallow-pool guard.
  const floor = Math.max(overrides.minDepth ?? MIN_DEPTH, row.conf === 'thin' ? THIN_MIN_DEPTH : 0);
  if (depth < floor) {
    return { pass: false, allIn, depth, reason: 'too-shallow', conditionFlags: flags };
  }
  return { pass: true, allIn, depth, conditionFlags: flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// The closing gate — auctions ending soon (the closing-calls lane, Aug 2026)
// ─────────────────────────────────────────────────────────────────────────────

/** Only auctions ending inside this window are closing calls — beyond it, bids
 *  have too much time to move for "deep right now" to mean anything. The sweep
 *  uses the same window as its itemEndDate filter (sweep.ts). */
export const CLOSING_WINDOW_MS = 4 * 60 * 60 * 1000;

/** The GOLDMINE closing window: an auction pinned to a top book row is worth
 *  watching days out, not just in the final hours — identity is book-certain
 *  and the section is honest that a bid will move (Aug 21 2026). */
export const GOLDMINE_CLOSING_WINDOW_MS = 72 * 60 * 60 * 1000;
/** bidVsBook floor: bidding this deep this late is genuinely interesting;
 *  anything shallower is just an auction doing auction things. */
export const CLOSING_MIN_BID_VS_BOOK = 0.4;
/** Seller floor. The scam cap does NOT apply here (a $1 opening bid is normal
 *  auction mechanics), so seller history is the lane's only fraud screen. */
export const CLOSING_SELLER_FLOOR = 50;

export interface ClosingGateResult {
  pass: boolean;
  /** currentBid + cheapest shipping (allInOf — same doctrine, bid-side) */
  allInBid: number;
  /** 1 − allInBid/med — depth of the CURRENT bid, present when med prices */
  bidVsBook: number;
  reason?:
    | 'no-bid'
    | 'no-price'
    | 'end-window'
    | 'thin-book'
    | 'seller-floor'
    | 'edge-floor'
    | 'stale-book'
    | 'condition-flag'
    | 'too-shallow';
  conditionFlags: string[];
}

/**
 * Gate an auction listing pinned to a book row into a CLOSING CALL — a watch
 * signal, never a price call (bids move; the label says so). Keeps: a real
 * standing bid, an end inside the 4h window, a high|medium row (never thin —
 * a shallow pool can't back an urgency signal), a seller with history, no
 * condition flag, and bidVsBook ≥ 0.40. Deliberately NO scam cap.
 */
export function closingGate(
  listing: EbayListing,
  row: ValueBookRow,
  now: number,
  opts?: { windowMs?: number },
): ClosingGateResult {
  const flags = conditionFlags(listing.title);
  const allInBid = allInOf(listing);
  if (!(allInBid > 0)) {
    return { pass: false, allInBid, bidVsBook: 0, reason: 'no-bid', conditionFlags: flags };
  }
  if (!(row.med > 0)) {
    return { pass: false, allInBid, bidVsBook: 0, reason: 'no-price', conditionFlags: flags };
  }
  const bidVsBook = 1 - allInBid / row.med;
  const endMs = listing.itemEndDate ? Date.parse(listing.itemEndDate) : NaN;
  if (!Number.isFinite(endMs) || endMs <= now || endMs > now + (opts?.windowMs ?? CLOSING_WINDOW_MS)) {
    return { pass: false, allInBid, bidVsBook, reason: 'end-window', conditionFlags: flags };
  }
  if (row.conf === 'thin') {
    return { pass: false, allInBid, bidVsBook, reason: 'thin-book', conditionFlags: flags };
  }
  const lastMs = Date.parse(row.lastSale);
  if (Number.isFinite(lastMs) && now - lastMs > STALE_BOOK_MS) {
    return { pass: false, allInBid, bidVsBook, reason: 'stale-book', conditionFlags: flags };
  }
  const score = listing.seller.feedbackScore;
  if (!(typeof score === 'number' && score >= CLOSING_SELLER_FLOOR)) {
    return { pass: false, allInBid, bidVsBook, reason: 'seller-floor', conditionFlags: flags };
  }
  if (hasConditionFlag(listing.title)) {
    return { pass: false, allInBid, bidVsBook, reason: 'condition-flag', conditionFlags: flags };
  }
  if (bidVsBook < CLOSING_MIN_BID_VS_BOOK) {
    return { pass: false, allInBid, bidVsBook, reason: 'too-shallow', conditionFlags: flags };
  }
  // Same dollar floor as the BIN gate, read against the CURRENT bid: a small-
  // med lot whose whole upside is under $50 isn't worth a hammer watch either.
  if (row.med - allInBid < MIN_EDGE_USD) {
    return { pass: false, allInBid, bidVsBook, reason: 'edge-floor', conditionFlags: flags };
  }
  return { pass: true, allInBid, bidVsBook, conditionFlags: flags };
}
