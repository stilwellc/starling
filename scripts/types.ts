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
 *  data on. Launch four = where the corpus is deepest: sports cards, autographs
 *  (RR Auction's 252K-lot 30-year archive — the largest non-card corpus),
 *  Pokémon, and art editions. Watches stay in the corpus but out of the launch
 *  set (condition/authenticity noise makes a price-vs-book call unreliable —
 *  "they can be broken"); design is P4. Cards are first-class; the
 *  anti-cards-trap guard lives in the scheduler's budget allocation
 *  (scheduler.ts), never in ranking. */
export type Vertical =
  | 'sports-cards'
  | 'autographs'
  | 'pokemon'
  | 'art-editions'
  | 'watches' // in the corpus, deprioritized at launch
  | 'design'; // P4

export const LAUNCH_VERTICALS: Vertical[] = [
  'sports-cards',
  'autographs',
  'pokemon',
  'art-editions',
];

// ─────────────────────────────────────────────────────────────────────────────
// The lectr data contract — value-book.json.gz  (see PROPOSAL §3.2)
// ─────────────────────────────────────────────────────────────────────────────

export type Confidence = 'high' | 'medium'; // 'low' never ships in the book

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

export interface ValueBook {
  schema: 1;
  /** must match meta.json's build stamp; sync-book.ts enforces freshness */
  builtAt: string;
  rows: ValueBookRow[];
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
}

export interface PerVerticalStat {
  polled: number;
  matched: number;
  surfaced: number;
}

export interface Board {
  schema: 1;
  builtAt: string;
  /** book build stamp the board was computed against — staleness display */
  bookBuiltAt: string;
  deals: Deal[];
  perVertical: Partial<Record<Vertical, PerVerticalStat>>;
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
