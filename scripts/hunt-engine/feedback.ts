/**
 * feedback.ts — your "Not it" and "Block seller" choices, written by the
 * /api/v1/feedback function as one small R2 object each (no read-modify-write,
 * so two clicks can't clobber each other), read at the start of every run.
 * A seller you've dismissed twice is blocked automatically (learned).
 */
import type { ObjectStore } from './store';
import { PREFIX } from './store';

export const LEARN_BLOCK_AFTER = 2;

export interface Feedback {
  dismissed: Set<string>; // `${huntId}__${itemId}`
  blockedSellers: Set<string>; // lowercased
  learnedSellers: Set<string>;
}

export const feedbackKey = (huntId: string, itemId: string) => `${huntId}__${itemId.replace(/[^A-Za-z0-9_.-]+/g, '_')}`;
export const sellerKey = (seller: string) => seller.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');

export async function loadFeedback(store: ObjectStore): Promise<Feedback> {
  const fb: Feedback = { dismissed: new Set(), blockedSellers: new Set(), learnedSellers: new Set() };
  const dKeys = await store.list(`${PREFIX}feedback/dismiss/`).catch(() => [] as string[]);
  const perSeller = new Map<string, number>();
  for (const k of dKeys) {
    const name = k.slice(`${PREFIX}feedback/dismiss/`.length).replace(/\.json$/, '');
    fb.dismissed.add(name);
    const body = await store.get(k).catch(() => null);
    try {
      const seller = body ? JSON.parse(body)?.seller : null;
      if (typeof seller === 'string' && seller) perSeller.set(sellerKey(seller), (perSeller.get(sellerKey(seller)) ?? 0) + 1);
    } catch { /* ignore malformed */ }
  }
  for (const k of await store.list(`${PREFIX}feedback/seller/`).catch(() => [] as string[])) {
    fb.blockedSellers.add(k.slice(`${PREFIX}feedback/seller/`.length).replace(/\.json$/, ''));
  }
  for (const [s, n] of perSeller) if (n >= LEARN_BLOCK_AFTER && !fb.blockedSellers.has(s)) fb.learnedSellers.add(s);
  return fb;
}

export function feedbackFor(fb: Feedback, huntId: string, itemId: string, seller: string | null | undefined):
  'dismissed-by-you' | 'seller-blocked' | 'seller-blocked:learned' | null {
  if (fb.dismissed.has(feedbackKey(huntId, itemId))) return 'dismissed-by-you';
  if (seller && fb.blockedSellers.has(sellerKey(seller))) return 'seller-blocked';
  if (seller && fb.learnedSellers.has(sellerKey(seller))) return 'seller-blocked:learned';
  return null;
}
