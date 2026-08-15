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
    price: num(raw.price?.value) ?? 0,
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
    aspects: [],
    enriched: false,
    marketplaceId,
  };
}

/** Normalize a getItem response (has aspects — enriched=true). Also used by the
 *  fixture source, where each fixture is a full EbayRawItem. */
export function normalizeItem(
  raw: EbayRawItem,
  marketplaceId = 'EBAY_US',
): EbayListing {
  const base = normalizeSummary(raw, marketplaceId);
  return { ...base, aspects: aspectsOf(raw), enriched: true };
}
