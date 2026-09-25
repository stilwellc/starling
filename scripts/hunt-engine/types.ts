/** Contracts for the hunt engine. Everything persisted or published is one of these. */
import type { BuyingMode, HuntVertical } from './hunts';

export type DataMode = 'live' | 'fixture';

/** One eBay listing, normalized. Exact title and URL are kept verbatim. */
export interface HuntListing {
  provider: 'ebay';
  itemId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  priceCurrency: string;
  /** null when eBay gave no shipping cost (calculated / not offered) — never guessed */
  shipping: number | null;
  buyingMode: BuyingMode;
  endsAt: string | null;
  bidCount: number | null;
  condition: string | null;
  seller: { username: string | null; feedbackPercentage: number | null; feedbackScore: number | null } | null;
  location: string | null;
  fetchedAt: string;
}

export type Classification = 'under' | 'over' | 'watch' | 'reject';

export interface Evaluation {
  huntId: string;
  itemId: string;
  classification: Classification;
  /** machine-readable: why it matched, or why it was rejected */
  reasons: string[];
  /** machine-readable risk flags */
  flags: string[];
  confidence: number;
  review: 'ok' | 'review';
  allIn: number | null;
  maxAllIn: number | null;
  underBy: number | null;
  underPct: number | null;
  taxExcluded: true;
  /** human wording for the price position ("under cap", "under cap now" for auctions) */
  capWording: string;
}

export type HuntRunState = 'complete' | 'partial' | 'failed' | 'not-searched';

export interface HuntRunResult {
  huntId: string;
  state: HuntRunState;
  pages: number;
  returned: number;
  error: string | null;
  searchedAt: string | null;
}

export type RunState = 'success' | 'partial' | 'failed';

export interface ProviderHealth {
  status: 'ok' | 'auth-failed' | 'rate-limited' | 'degraded' | 'not-configured' | 'fixture';
  calls: number;
  rateLimit?: { limit?: string | null; remaining?: string | null; reset?: string | null; retryAfter?: string | null } | null;
  message?: string | null;
}

export interface Observation {
  listing: HuntListing;
  evaluation: Evaluation;
}

export interface RunSummary {
  schemaVersion: 1;
  runId: string;
  mode: DataMode;
  state: RunState;
  startedAt: string;
  finishedAt: string;
  scope: 'all' | { huntId: string };
  huntsTotal: number;
  huntsComplete: number;
  hunts: HuntRunResult[];
  provider: ProviderHealth;
  counts: { returned: number; retained: number; rejected: number; under: number; over: number; watch: number };
  promoted: boolean;
  promotedReason: string;
  alerts: { created: number; pending: number; delivered: number; deliveryFailed: number };
}

/** The promoted per-hunt state: what the dashboard reads. Carries last-good results for hunts this run couldn't search. */
export interface Manifest {
  schemaVersion: 1;
  runId: string;
  mode: DataMode;
  promotedAt: string;
  /** finish time of the last run that searched every hunt completely */
  lastFullSuccessAt: string | null;
  hunts: Record<string, {
    lastSearchState: HuntRunState;
    lastSearchedAt: string | null;
    lastSuccessfulAt: string | null;
    lastSuccessfulRunId: string | null;
    error: string | null;
    observations: Observation[];
  }>;
}

export type AlertState = 'pending' | 'delivered' | 'expired';

export interface LedgerEntry {
  alertKey: string;
  huntId: string;
  listingId: string;
  version: number;
  trigger: 'first-under' | 'crossed-under' | 'price-drop' | 'authenticity-evidence';
  state: AlertState;
  allInAtAlert: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdRunId: string;
  deliveries: Array<{ at: string; ok: boolean; status: number | null; error: string | null }>;
  /** the listing packet as of the latest run that saw it (the agent-facing record) */
  record: AlertRecord;
}

/** One alert as served on /api/v1/alerts — stable, schemaVersion 1. */
export interface AlertRecord {
  alertKey: string;
  huntId: string;
  listingId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  buyingMode: BuyingMode;
  endsAt: string | null;
  price: number;
  shipping: number | null;
  allIn: number | null;
  maxAllIn: number | null;
  underBy: number | null;
  underPct: number | null;
  currency: 'USD';
  confidence: number;
  reasons: string[];
  flags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AlertLedger {
  schemaVersion: 1;
  /** per (listing, hunt): the last material facts, to decide what counts as a change */
  tracks: Record<string, {
    version: number;
    lastClassification: 'under' | 'over' | 'watch';
    lastAllIn: number | null;
    alertedAllIn: number | null;
    evidence: string[];
    firstSeenAt: string;
    lastSeenAt: string;
  }>;
  alerts: Record<string, LedgerEntry>;
}

export type { BuyingMode, HuntVertical };
