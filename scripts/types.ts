/**
 * types.ts — the contract between every part of Starling.
 *
 * The whole app hangs off these definitions. Matchers, scoring, the pipeline,
 * and the board UI all import from here. Two hard rules encoded below:
 *   1. Starling holds NO corpus — it consumes lectr's `value-book.json.gz`
 *      (ValueBookRow) fetched over plain HTTPS from lectr.bid. See sync-book.ts.
 *   2. A number is never manufactured. A deal exists only when an eBay listing's
 *      identity is pinned to an exact ValueBookRow (identify() must abstain
 *      otherwise) and depth sits inside the sane band (gate.ts).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Verticals
// ─────────────────────────────────────────────────────────────────────────────

/** The vertical slugs — the pockets of the market lectr has the MOST settled
 *  data on. The sweep rebuild (Aug 2026 funnel audit) promoted WATCHES into the
 *  launch set: the book carried 1,278 watch keys with NO matcher — never polled
 *  — and a numeric-reference identity (rolex|16610) is as exact as a card key.
 *  The "they can be broken" condition risk is priced in riskInputs (material +
 *  papers axes), not used to suppress the vertical. Design stays out of the
 *  launch set (matcher registered, abstain-heavy, no sweep slice yet — it only
 *  identifies hunt-lane hits until book rows deepen). Cards are first-class;
 *  the anti-cards-trap guard lives in the sweep budget allocation
 *  (scheduler.ts allocateSweepBudget), never in ranking. */
export type Vertical =
  | 'sports-cards'
  | 'autographs'
  | 'pokemon'
  | 'art-editions'
  | 'watches'
  | 'design'; // matcher registered; launch pending book rows + a sweep slice

export const LAUNCH_VERTICALS: Vertical[] = [
  'sports-cards',
  'autographs',
  'pokemon',
  'art-editions',
  'watches',
];

// ─────────────────────────────────────────────────────────────────────────────
// The lectr data contract — value-book.json.gz  (see PROPOSAL §3.2)
// ─────────────────────────────────────────────────────────────────────────────

/** 'low' never ships in the book. 'thin' (Aug 2026, lectr-side): n=3 pools —
 *  real corpus reads, but shallow; Starling prices them only at depth ≥ 0.40
 *  (gate.ts THIN_MIN_DEPTH) and NEVER for closing calls. Books built before the
 *  tier simply never carry it — every consumer tolerates its absence. */
export type Confidence = 'high' | 'medium' | 'thin';

export interface ValueBookRow {
  /** exact-class identity key, e.g. "mickey-mantle|1952|topps|311|PSA6" */
  k: string;
  v: Vertical;
  /** recency-weighted median + conformal band, USD */
  med: number;
  lo: number;
  hi: number;
  /** settled sales behind the row */
  n: number;
  /** ISO date of most recent settled sale */
  lastSale: string;
  /** 1Y sub-index read where certified, else null */
  trend: number | null;
  conf: Confidence;
}

// ── the context tier (schema-ADDITIVE, Aug 2026) ────────────────────────────
// Honest rollups one level up the identity ladder — signer across formats,
// player × object slug, curated natural-history/early-tech classes, artist
// edition rollups. lectr emits them in the same book (emit-value-book.ts,
// looser bar: n≥3, no dispersion gate — the lo–hi band carries the spread).
// A context row is NEVER a priced call: it annotates noBook hits and feeds
// board.leads, always labeled by kind so the caption stays honest
// ("Charles Schulz signed material — 41 sales, $150–$2.4K").

export type ContextKind = 'signer' | 'player-object' | 'class' | 'artist';

/** A context row as the book carries it (lectr's ContextRow — cross-repo). */
export interface ContextRow {
  k: string;
  /** lectr's market lens for the rollup — wider than Vertical (sports/science) */
  v: Vertical | 'sports' | 'science';
  kind: ContextKind;
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
}

/** The board-facing context stamp on a noBook hit / lead (contract v2: no `v` —
 *  the deal already carries its own vertical lens). */
export interface DealContext {
  k: string;
  kind: ContextKind;
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
}

export interface ValueBook {
  schema: 1;
  /** must match meta.json's build stamp; sync-book.ts enforces freshness */
  builtAt: string;
  rows: ValueBookRow[];
  /** the context tier — ADDITIVE; books built before Aug 2026 don't carry it,
   *  and every consumer must tolerate its absence (schema stays 1) */
  context?: ContextRow[];
  /** the grade ladder (ADDITIVE, Aug 2026, lectr-side): card grade multipliers,
   *  base grade 8 = 1.0. Lets a pinned card key that differs from a book key
   *  ONLY by grade be priced via med × (rungs[listingGrade]/rungs[bookGrade]) —
   *  see ladder.ts. Optional and shape-checked before use: a book without it
   *  (or with a malformed one) simply never ladder-prices. */
  gradeLadder?: { base: number; rungs: Record<string, number> };
}

/** lectr's build stamp sidecar — https://lectr.bid/data/ray/meta.json */
export interface LectrMeta {
  builtAt: string;
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalized eBay listing — what matchers consume
// (raw API response shapes live in scripts/lib/ebay-types.ts; poll.ts / the
//  fixture loader normalize raw → EbayListing so matchers never see raw JSON.)
// ─────────────────────────────────────────────────────────────────────────────

export interface EbayAspect {
  name: string;
  value: string;
}

export interface EbayListing {
  /** eBay RESTful item id, e.g. "v1|1234567890|0" */
  itemId: string;
  legacyItemId?: string;
  title: string;
  /** item price only, USD (all-in is computed with shipping in gate.ts) */
  price: number;
  currency: string;
  /** cheapest shipping option cost, USD; 0 = free; null = unknown/calculated */
  shippingCost: number | null;
  condition?: string;
  conditionId?: string;
  imageUrl?: string;
  itemWebUrl?: string;
  /** EPN affiliate out-link — present when the campaign header was sent */
  itemAffiliateWebUrl?: string;
  seller: {
    username?: string;
    feedbackPercentage?: number; // 0..100
    feedbackScore?: number;
    accountType?: string;
  };
  /** ISO creation date — drives the freshBoost in ranking */
  itemCreationDate?: string;
  /** ISO end date — auction listings only; the closing-calls lane keys off it */
  itemEndDate?: string;
  /** bids placed so far — auction listings only (summary `bidCount`) */
  bidCount?: number;
  /** full item specifics from getItem localizedAspects; empty until enriched */
  aspects: EbayAspect[];
  /** true once enrich.ts has run getItem and populated `aspects` */
  enriched: boolean;
  marketplaceId: string; // EBAY_US | EBAY_GB | EBAY_DE
}

/** Convenience: case-insensitive aspect lookup. Matchers use this heavily. */
export function aspect(l: EbayListing, name: string): string | undefined {
  const hit = l.aspects.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return hit?.value;
}

// ─────────────────────────────────────────────────────────────────────────────
// The matcher contract — one interface, N implementations (PROPOSAL §6)
// ─────────────────────────────────────────────────────────────────────────────

export type IdentityKey = string;

export interface EbayQuery {
  /** the value-book key this query hunts for — carried through for attribution */
  key: string;
  q: string;
  /** LEAF category ids only — buyingOptions filter fails on top-level ids */
  categoryIds: string[];
  aspectFilter?: string;
  /** price bracket in USD derived from the book row's band, e.g. [0, hi*1.1] */
  priceMin?: number;
  priceMax?: number;
}

export type AuthenticityAnchor =
  | 'cert-verified' // grader API confirmed the cert (A-grade evidence)
  | 'slab-claimed' // slab/cert asserted but unverified (B)
  | 'papers' // watch papers / LOA named (B)
  | 'raw'; // no authentication anchor (C/D)

export interface RiskSignals {
  authenticityAnchor: AuthenticityAnchor;
  /** grader + cert number if present, for the verification step (enrich.ts) */
  grader?: string;
  certNumber?: string;
  /** watch reference material axis, edition signed/numbered, etc. — freeform */
  notes?: string[];
  /** condition-qualifier hits from the shared gate (hasConditionFlag) */
  conditionFlags: string[];
}

export interface VerticalMatcher {
  vertical: Vertical;
  /** book rows for THIS vertical → a compiled eBay search plan */
  queriesFor(book: ValueBookRow[]): EbayQuery[];
  /** listing → exact identity key, or null to ABSTAIN (never fuzzy-match) */
  identify(listing: EbayListing): IdentityKey | null;
  /** slab/cert/ref/papers evidence for the risk model */
  riskInputs(listing: EbayListing): RiskSignals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring — risk grade + rank  (PROPOSAL §7, §8)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskGrade = 'A' | 'B' | 'C' | 'D';

/** Front-page tier (the editorial bar, Aug 2026 — lib/tier.ts): 'featured' =
 *  defensible evidence (high conf with n≥6, or a verified cert at grade A,
 *  depth 0.25–0.60 unless certed); 'worth-a-look' = passed the gates on
 *  thinner evidence (thin/ladder/n<6/suspect depth) — shown as tape rows with
 *  the caveat explicit, never hidden. Placement only; rank is untouched. */
export type DealTier = 'featured' | 'worth-a-look';

export interface RiskResult {
  grade: RiskGrade;
  score: number; // 0..100
  /** human-readable reasons rendered on the card — the no-black-box rule */
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The pipeline's working unit and its output
// ─────────────────────────────────────────────────────────────────────────────

/** A listing that has been pinned to a book row — the input to gate+score. */
export interface Candidate {
  listing: EbayListing;
  key: IdentityKey;
  vertical: Vertical;
  row: ValueBookRow;
  risk: RiskSignals;
}

/** A surfaced deal — one row of board.json, consumed by the UI. */
export interface Deal {
  id: string; // stable: hash of itemId (see lib/id.ts)
  itemId: string;
  legacyItemId?: string;
  vertical: Vertical;
  key: string;
  title: string;
  imageUrl?: string;
  /** all-in = item + cheapest shipping, USD */
  allIn: number;
  itemPrice: number;
  shipping: number | null;
  // the book call
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
  trend: number | null;
  conf: Confidence;
  /** 1 - allIn/med (close-board.ts formula, buy-side) */
  depth: number;
  risk: RiskResult;
  /** depth × confW × riskW × freshBoost (rank.ts) — higher is better */
  rank: number;
  listedAt?: string;
  affiliateUrl?: string;
  webUrl?: string;
  marketplace: string;
  /** deep link into lectr's evidence page for this key */
  evidenceUrl: string;
  surfacedAt: string; // ISO — when Starling first surfaced this deal
  /** priced off a 'thin' book row (n=3 pool) — only published at depth ≥ 0.40;
   *  the card renders a "thin book" badge so the shallow pool is never hidden */
  thin?: true;
  /** 'ladder' = no exact book row for this grade; med/lo/hi were derived from a
   *  neighboring-grade row via the book's gradeLadder (ladder.ts). Absent =
   *  priced off the exact row. */
  basis?: 'ladder';
  /** the SOURCE book key the ladder priced from (present iff basis==='ladder');
   *  evidenceUrl points here too — the comps live behind the source row */
  basisKey?: string;
  /** front-page tier — stamped by publish.ts via tierOf (lib/tier.ts).
   *  Optional-additive: boards built before the tier simply don't carry it and
   *  the UI recomputes with the same rule. */
  tier?: DealTier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Closing calls — the auction lane (Aug 2026). BIN mispricings get sniped fast;
// auctions ending with low bids are where the real edge lives.
// ─────────────────────────────────────────────────────────────────────────────

/** A live AUCTION ending soon with bidding deep under the book — a WATCH
 *  SIGNAL, never a price call: the current bid is a moment, not a settlement,
 *  and it moves. Honesty rules (gate.ts closingGate): endsAt within 4h,
 *  bidVsBook ≥ 0.40, conf high|medium only (never thin), seller feedbackScore
 *  ≥ 50. The 0.90 scam cap does NOT apply — a $1 opening bid is normal auction
 *  mechanics, not a fake-listing tell. */
export interface AuctionCall {
  id: string; // stable: hash of itemId (see lib/id.ts)
  itemId: string;
  legacyItemId?: string;
  vertical: Vertical;
  key: string;
  title: string;
  imageUrl?: string;
  /** the bid on the tape when we looked — already stale by publish time */
  currentBid: number;
  bidCount?: number;
  /** ISO — the auction's end (eBay itemEndDate); the lane's sort key */
  endsAt: string;
  shipping: number | null;
  /** currentBid + cheapest shipping — the all-in a snipe would pay right now */
  allInBid: number;
  // the book row behind the signal
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
  trend: number | null;
  conf: Confidence;
  /** 1 − allInBid/med — depth of the CURRENT bid, not of any final price */
  bidVsBook: number;
  risk: RiskResult;
  listedAt?: string;
  affiliateUrl?: string;
  webUrl?: string;
  marketplace: string;
  evidenceUrl: string;
  surfacedAt: string;
}

export interface PerVerticalStat {
  polled: number;
  matched: number;
  surfaced: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// The hunt list — curated priorities above the book (PROPOSAL §4.4)
// Config schema (HuntEntry) lives in scripts/hunt.ts with its loader/validator;
// these are the BOARD-facing shapes the UI consumes from board.json.
// ─────────────────────────────────────────────────────────────────────────────

/** One hunt target as configured — the /hunt page renders every target, hit or
 *  not ("nothing live — watching"). `vertical` is the operator's lens, a free
 *  string that may name pockets beyond the launch Vertical set (culture,
 *  science, …) — hunting is taste-driven, not schema-driven. */
export interface HuntTarget {
  id: string;
  label: string;
  vertical: string;
  note?: string;
  added: string;
}

/** A priced hunt hit: identity pinned to a real book row, so it IS a Deal —
 *  same gate (per-entry minDepth may loosen the 0.25 floor; the 0.90 scam cap
 *  never moves), same risk/rank — plus the hunt stamp. */
export type HuntPricedDeal = Deal & {
  huntId: string;
  huntLabel: string;
  noBook?: false;
};

/** "hunted — no book value": a hit whose identity has NO book row. Still
 *  surfaced — a human explicitly asked for it — but FACTS ONLY: no med, no
 *  depth, no rank. The no-manufactured-numbers rule survives the priority lane. */
export interface HuntNoBookDeal {
  huntId: string;
  huntLabel: string;
  noBook: true;
  id: string; // stable: hash of itemId (see lib/id.ts)
  itemId: string;
  legacyItemId?: string;
  /** the hunt entry's vertical lens (free string — see HuntTarget) */
  vertical: string;
  /** identity key when identify() pinned one that has no book row yet */
  key?: string;
  title: string;
  imageUrl?: string;
  /** all-in = item + cheapest shipping, USD — a listing fact, not a valuation */
  allIn: number;
  itemPrice: number;
  shipping: number | null;
  /** seller facts, carried for the card (no risk grade without a comp context) */
  seller?: { username?: string; feedbackPercentage?: number; feedbackScore?: number };
  listedAt?: string;
  affiliateUrl?: string;
  webUrl?: string;
  marketplace: string;
  surfacedAt: string;
  /** lectr context when a rollup row covers this hit — nearby evidence, never a
   *  valuation ("no book value" stops reading like "no data"). Optional: most
   *  noBook hits have no covering rollup. */
  context?: DealContext;
}

export type HuntDeal = HuntPricedDeal | HuntNoBookDeal;

export interface HuntSection {
  targets: HuntTarget[];
  /** priced hits rank-desc first, then noBook hits recency-desc (publish.ts) */
  deals: HuntDeal[];
}

/** Run observability (board schema v2) — the funnel, on the record. Born from
 *  the audit's blindness: pokemon matched 58 listings and published 0 across 3
 *  runs, and nobody could say why because gate reasons were discarded. Every
 *  field optional-backward-compatible; boards built before the sweep rebuild
 *  simply don't carry it. */
export interface BoardStats {
  /** API calls actually spent this run. search and getItems are SEPARATE eBay
   *  quota buckets (5,000/day each) — ledger them apart. */
  calls: { search: number; getItems: number };
  /** swept listings evaluated after dedupe (the top of the funnel) */
  listingsEvaluated: number;
  /** per-sweep-slice ledger: calls spent, listings taken */
  bySlice: Record<string, { calls: number; listings: number }>;
  /** vertical → gate-reason histogram (tooShallow/scamCap/condition/maxAllIn/
   *  noPrice/noBookRow…) — the funnel's leak map */
  gateReasons: Record<string, Record<string, number>>;
  /** vertical → listings identify() pinned to a key (book row or not) */
  identified: Record<string, number>;
}

export interface Board {
  schema: 1;
  builtAt: string;
  /** book build stamp the board was computed against — staleness display */
  bookBuiltAt: string;
  deals: Deal[];
  perVertical: Partial<Record<Vertical, PerVerticalStat>>;
  /** the hunt lane (§4.4) — absent on boards built before the feature landed,
   *  so existing consumers of `deals`/`perVertical` are untouched */
  hunt?: HuntSection;
  /** context leads from sweeps: no book key, but a context rollup covers the
   *  listing and all-in sits ≤ 0.5× its med. Same shape as noBook hunt hits +
   *  a context stamp; capped at 20; labeled "context lead — not a priced call". */
  leads?: HuntNoBookDeal[];
  /** closing calls — live auctions ending within 4h with bidding ≥ 40% under
   *  the book (see AuctionCall). Sorted endsAt asc, capped at 30. Optional:
   *  boards built before the lane (or runs that caught nothing) don't carry it. */
  closing?: AuctionCall[];
  /** the run's funnel numbers — see BoardStats */
  stats?: BoardStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipts — "deals we surfaced, and what happened" (PROPOSAL §6.1 step 9)
// mirrors lectr's calls-ledger: first-call-wins append, graded against outcome.
// ─────────────────────────────────────────────────────────────────────────────

export type ReceiptOutcome = 'live' | 'sold' | 'ended' | 'delisted';

export interface Receipt {
  id: string;
  itemId: string;
  vertical: Vertical;
  key: string;
  /** 'closing' = this receipt tracks an AuctionCall (watch signal): depth/allIn
   *  at surface are bidVsBook/allInBid — the bid we saw, not a BIN ask. Absent
   *  = a BIN deal, as ever. */
  lane?: 'closing';
  /** the call as first surfaced — frozen, never rewritten */
  surfacedAt: string;
  depthAtSurface: number;
  allInAtSurface: number;
  med: number;
  conf: Confidence;
  riskGrade: RiskGrade;
  // resolved fields (filled when the listing leaves BIN)
  outcome: ReceiptOutcome;
  resolvedAt?: string;
  /** final price if visible (sold) */
  finalPrice?: number;
}
