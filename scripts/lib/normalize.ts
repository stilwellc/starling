/**
 * normalize.ts — raw eBay API JSON → the EbayListing matchers consume.
 * Shared by the live client (ebay-client.ts) and the fixture source, so matchers
 * never see raw response shapes and fixtures exercise the exact same path.
 */
import type { EbayListing, EbayAspect } from '../types';
import type { EbayRawSummary, EbayRawItem } from './ebay-types';

function num(s: string | undefined | null): number | undefined {
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** cheapest shipping cost in USD: 0 = free, null = unknown/calculated. */
function shippingOf(raw: EbayRawSummary): number | null {
  const opts = raw.shippingOptions;
  if (!opts || opts.length === 0) return null;
  let best: number | null = null;
  for (const o of opts) {
    if (o.shippingCost?.value != null) {
      const c = Number(o.shippingCost.value);
      if (Number.isFinite(c)) best = best == null ? c : Math.min(best, c);
    } else if (o.shippingCostType === 'CALCULATED') {
      // calculated-at-checkout — leave unknown unless a concrete value exists
    }
  }
  return best;
}

function aspectsOf(raw: EbayRawItem): EbayAspect[] {
  const la = raw.localizedAspects;
  if (!la) return [];
  return la
    .filter((a) => a && a.name != null && a.value != null)
    .map((a) => ({ name: a.name, value: a.value }));
}

/** Normalize a search summary (no aspects yet — enriched=false). */
export function normalizeSummary(
  raw: EbayRawSummary,
  marketplaceId = 'EBAY_US',
): EbayListing {
  return {
    itemId: raw.itemId,
    legacyItemId: raw.legacyItemId,
    title: raw.title ?? '',
    // Pure auctions carry no `price` — the standing bid IS the listing's price
    // on this surface (the closing lane reads it as currentBid).
    price: num(raw.price?.value) ?? num(raw.currentBidPrice?.value) ?? 0,
    currency: raw.price?.currency ?? 'USD',
    shippingCost: shippingOf(raw),
    condition: raw.condition,
    conditionId: raw.conditionId,
    imageUrl: raw.image?.imageUrl ?? raw.thumbnailImages?.[0]?.imageUrl,
    itemWebUrl: raw.itemWebUrl,
    itemAffiliateWebUrl: raw.itemAffiliateWebUrl,
    seller: {
      username: raw.seller?.username,
      feedbackPercentage: num(raw.seller?.feedbackPercentage),
      feedbackScore: raw.seller?.feedbackScore,
      accountType: raw.seller?.sellerAccountType,
    },
    itemCreationDate: raw.itemCreationDate,
    itemEndDate: raw.itemEndDate,
    bidCount: raw.bidCount,
    buyingOptions: raw.buyingOptions,
    aspects: [],
    enriched: false,
    marketplaceId,
  };
}

/**
 * Is a getItem response a listing that can no longer be bought? (Oct 2026
 * audit: the batch endpoint is denied for this keyset, and the singular
 * getItem fallback answers 200 for SOLD and seller-ENDED listings — so the
 * absence-only check never fired: 0 carried deals ended across 65 runs while
 * a third of the sampled board was sold/ended on eBay.) Absence is read off a
 * 200 two ways: an availability status with nothing left to buy, or an end
 * date already in the past. Unknown/missing fields → available (never drop a
 * listing on a guess).
 */
export function isUnavailable(raw: EbayRawItem, now: number): boolean {
  const av = raw.estimatedAvailabilities;
  if (Array.isArray(av) && av.length > 0) {
    const buyable = av.some((a) => {
      const s = String(a?.estimatedAvailabilityStatus ?? '').toUpperCase();
      if (s === 'OUT_OF_STOCK' || s === 'TEMPORARILY_UNAVAILABLE') return false;
      if (typeof a?.estimatedRemainingQuantity === 'number' && a.estimatedRemainingQuantity <= 0) return false;
      if (typeof a?.estimatedAvailableQuantity === 'number' && a.estimatedAvailableQuantity <= 0) return false;
      return true;
    });
    if (!buyable) return true;
  }
  const end = raw.itemEndDate ? Date.parse(raw.itemEndDate) : NaN;
  return Number.isFinite(end) && end <= now;
}

/** Normalize a getItem response (has aspects — enriched=true). Also used by the
 *  fixture source, where each fixture is a full EbayRawItem. `now` (optional)
 *  stamps `unavailable` when the 200 describes a sold/ended listing. */
export function normalizeItem(
  raw: EbayRawItem,
  marketplaceId = 'EBAY_US',
  now?: number,
): EbayListing {
  const base = normalizeSummary(raw, marketplaceId);
  const gone = now != null && isUnavailable(raw, now);
  return { ...base, aspects: aspectsOf(raw), enriched: true, ...(gone ? { unavailable: true as const } : {}) };
}
