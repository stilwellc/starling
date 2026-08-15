/**
 * id.ts — stable deal ids and the lectr evidence deep-link.
 */
import type { Vertical } from '../types';

/** Deterministic short id from an eBay itemId (djb2). Stable across runs so a
 *  deal keeps its /deal/[id] permalink and its receipt lines up. */
export function dealId(itemId: string): string {
  let h = 5381;
  for (let i = 0; i < itemId.length; i++) {
    h = ((h << 5) + h + itemId.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** lectr owns the proof. Every deal deep-links to lectr's evidence page for the
 *  identity key so users can see the comps behind the number. The exact route
 *  shape is confirmed at integration; this is the documented contract. */
export function evidenceUrl(vertical: Vertical, key: string): string {
  return `https://lectr.bid/key/${vertical}/${encodeURIComponent(key)}`;
}
