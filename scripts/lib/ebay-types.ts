/**
 * ebay-types.ts — the subset of eBay Browse API response shapes Starling reads.
 *
 * Field names and structure verified against the official OpenAPI spec (Aug
 * 2026): buy/browse/v1. Two endpoints:
 *   - GET /item_summary/search  → { itemSummaries: EbayRawSummary[], total, ... }
 *   - GET /item/{itemId}        → EbayRawItem  (adds localizedAspects)
 *
 * Summaries do NOT carry localizedAspects — that is the entire reason for the
 * two-tier poll→enrich pipeline. normalizeSummary / normalizeItem (poll.ts,
 * enrich.ts) turn these into the EbayListing the matchers consume.
 */

export interface EbayRawPrice {
  value: string; // decimal string, e.g. "1250.00"
  currency: string; // "USD"
}

export interface EbayRawShippingOption {
  shippingCost?: EbayRawPrice;
  shippingCostType?: string; // "FIXED" | "CALCULATED"
}

export interface EbayRawSeller {
  username?: string;
  feedbackPercentage?: string; // "99.5"
  feedbackScore?: number;
  sellerAccountType?: string;
}

export interface EbayRawImage {
  imageUrl?: string;
}

export interface EbayRawSummary {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price?: EbayRawPrice;
  condition?: string;
  conditionId?: string;
  image?: EbayRawImage;
  thumbnailImages?: EbayRawImage[];
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  seller?: EbayRawSeller;
  shippingOptions?: EbayRawShippingOption[];
  itemCreationDate?: string;
  /** auctions: when the listing ends — the closing-calls lane's whole premise */
  itemEndDate?: string;
  /** auctions: the standing bid (the `price` field is the BIN ask, absent on
   *  pure auctions) */
  currentBidPrice?: EbayRawPrice;
  /** auctions: bids placed so far */
  bidCount?: number;
  itemGroupType?: string;
  buyingOptions?: string[];
  categories?: { categoryId: string; categoryName?: string }[];
}

export interface EbayRawTypedNameValue {
  name: string;
  type?: string; // "STRING" | "STRING_ARRAY"
  value: string;
}

/** getItem response — superset of a summary plus the aspect gold. */
export interface EbayRawItem extends EbayRawSummary {
  localizedAspects?: EbayRawTypedNameValue[];
  shortDescription?: string;
  /** Browse getItem availability (OpenAPI: EstimatedAvailability). A sold-out
   *  or ended listing can still come back 200 from getItem — this, plus a past
   *  itemEndDate, is how absence is read off a 200 (normalize.ts). */
  estimatedAvailabilities?: EbayRawAvailability[];
}

export interface EbayRawAvailability {
  /** AVAILABLE | LIMITED_STOCK | OUT_OF_STOCK | TEMPORARILY_UNAVAILABLE */
  estimatedAvailabilityStatus?: string;
  estimatedAvailableQuantity?: number;
  estimatedRemainingQuantity?: number;
  estimatedSoldQuantity?: number;
}

export interface EbaySearchResponse {
  itemSummaries?: EbayRawSummary[];
  total?: number;
  limit?: number;
  offset?: number;
  next?: string;
}
