import type { Hunt } from '../hunts';
import { HUNTS } from '../hunts';
import type { HuntListing } from '../types';

export const hunt = (id: string): Hunt => {
  const h = HUNTS.find((x) => x.id === id);
  if (!h) throw new Error(`no hunt ${id}`);
  return h;
};

export function listing(p: Partial<HuntListing> & { title: string }): HuntListing {
  return {
    provider: 'ebay',
    itemId: p.itemId ?? `v1|${Math.random().toString(36).slice(2, 10)}|0`,
    url: p.url ?? 'https://www.ebay.com/itm/1',
    imageUrl: null,
    price: 100,
    priceCurrency: 'USD',
    shipping: 10,
    buyingMode: 'FIXED_PRICE',
    endsAt: null,
    bidCount: null,
    condition: 'Used',
    seller: { username: 'someone', feedbackPercentage: 99.9, feedbackScore: 500 },
    location: 'US',
    fetchedAt: '2026-09-24T00:00:00.000Z',
    ...p,
  };
}

/** a raw Browse itemSummary */
export function summary(id: string, title: string, price: number, ship: number | null, mode: 'FIXED_PRICE' | 'AUCTION' = 'FIXED_PRICE') {
  return {
    itemId: id,
    title,
    itemWebUrl: `https://www.ebay.com/itm/${id}`,
    buyingOptions: [mode],
    ...(mode === 'AUCTION' ? { currentBidPrice: { value: String(price), currency: 'USD' }, itemEndDate: '2026-10-01T00:00:00.000Z' } : { price: { value: String(price), currency: 'USD' } }),
    ...(ship === null ? {} : { shippingOptions: [{ shippingCost: { value: String(ship), currency: 'USD' } }] }),
    seller: { username: 's', feedbackPercentage: '99.9', feedbackScore: 900 },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
