/**
 * enrich.ts — evidence beyond the title.
 *
 * Item details: eBay getItem (item specifics + description) for the candidates
 * that matter — unders first (most under first), then watch — capped per run,
 * cached in R2 for 24h (re-fetched early if the price moved).
 *
 * Photos: a 64-bit difference hash (dHash) of each candidate's listing photo.
 * The same photo on different listings (Hamming distance ≤ 6) is a strong
 * fake / stock-image signal for "unique" works.
 */
import jpeg from 'jpeg-js';
import type { HuntProvider } from './provider';
import { getJson, putJson, type ObjectStore } from './store';
import { isBorderline } from './evaluate';
import type { Observation } from './types';

export const DETAILS_PER_RUN = 40;
/** of those, lookups held for borderline rejects (a second look can clear a title-only reject) */
export const BORDERLINE_PER_RUN = 8;
export const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
export const PHOTOS_PER_RUN = 160;
export const PHOTO_MATCH_MAX_DISTANCE = 6;

export interface DetailsRecord {
  aspects: Record<string, string>;
  description: string;
  descriptionSnippet: string | null;
  price: number;
  fetchedAt: string;
}

const safeKey = (id: string) => id.replace(/[^A-Za-z0-9_.-]+/g, '_');

/** fetch (or reuse cached) details for the priority candidates; returns itemId → details */
export async function loadDetails(
  obs: Observation[],
  provider: HuntProvider,
  store: ObjectStore,
  now: Date,
  budget = DETAILS_PER_RUN,
): Promise<{ details: Map<string, DetailsRecord>; fetched: number; cached: number; secondLook: number }> {
  const out = new Map<string, DetailsRecord>();
  let fetched = 0, cached = 0, secondLook = 0;
  const reserve = Math.min(BORDERLINE_PER_RUN, Math.floor(budget / 4));
  // spend lookups where they change a decision: one per distinct seller+title (spam repeats
  // fold into one card anyway), unders before watch, lower fake risk first, most-under first
  const riskRank = { low: 0, medium: 1, high: 2 } as const;
  const cands = obs
    .filter((o) => o.evaluation.classification === 'under' || o.evaluation.classification === 'watch')
    .sort((a, b) =>
      (a.evaluation.classification === 'under' ? 0 : 1) - (b.evaluation.classification === 'under' ? 0 : 1) ||
      riskRank[a.evaluation.risk ?? 'low'] - riskRank[b.evaluation.risk ?? 'low'] ||
      (b.evaluation.underPct ?? -1) - (a.evaluation.underPct ?? -1));
  const seen = new Set<string>();
  const seenGroup = new Set<string>();
  for (const o of cands) {
    const id = o.listing.itemId;
    const group = `${o.listing.seller?.username ?? ''}|${o.listing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (seen.has(id) || seenGroup.has(group)) continue;
    seen.add(id);
    seenGroup.add(group);
    const key = `details/ebay/${safeKey(id)}.json`;
    const hit = await getJson<DetailsRecord>(store, key).catch(() => null);
    if (hit && now.getTime() - Date.parse(hit.fetchedAt) < DETAILS_TTL_MS && hit.price === o.listing.price) {
      out.set(id, hit); cached++; continue;
    }
    if (!provider.getItem || fetched >= budget - reserve) { if (hit) out.set(id, hit); continue; }
    fetched++;
    const d = await provider.getItem(id, now);
    if (!d) { if (hit) out.set(id, hit); continue; }
    const rec: DetailsRecord = {
      aspects: d.aspects,
      description: d.description,
      descriptionSnippet: d.description ? d.description.replace(/\s+/g, ' ').slice(0, 280) : null,
      price: o.listing.price,
      fetchedAt: now.toISOString(),
    };
    out.set(id, rec);
    await putJson(store, key, rec);
  }
  // second look: borderline rejects, cheapest first. Item specifics don't change with the
  // price, so a cached look is reused forever — the same reject is never paid for twice.
  const border = obs
    .filter((o) => isBorderline(o.evaluation))
    .sort((a, b) => (a.evaluation.allIn ?? 0) - (b.evaluation.allIn ?? 0));
  for (const o of border) {
    const id = o.listing.itemId;
    const group = `${o.listing.seller?.username ?? ''}|${o.listing.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    if (seen.has(id) || seenGroup.has(group)) continue;
    seen.add(id);
    seenGroup.add(group);
    const key = `details/ebay/${safeKey(id)}.json`;
    const hit = await getJson<DetailsRecord>(store, key).catch(() => null);
    if (hit) { out.set(id, hit); cached++; continue; }
    if (!provider.getItem || fetched >= budget) continue;
    fetched++;
    secondLook++;
    const d = await provider.getItem(id, now);
    if (!d) continue;
    const rec: DetailsRecord = {
      aspects: d.aspects,
      description: d.description,
      descriptionSnippet: d.description ? d.description.replace(/\s+/g, ' ').slice(0, 280) : null,
      price: o.listing.price,
      fetchedAt: now.toISOString(),
    };
    out.set(id, rec);
    await putJson(store, key, rec);
  }
  return { details: out, fetched, cached, secondLook };
}

// ── photo hashing ───────────────────────────────────────────────────────────

/** 9×8 grayscale sample → 64-bit dHash as 16 hex chars */
export function dHash(rgba: Uint8Array, width: number, height: number): string {
  const g: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      // box-average the source region for this cell
      const x0 = Math.floor((x * width) / 9), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / 9));
      const y0 = Math.floor((y * height) / 8), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / 8));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy += Math.max(1, Math.floor((y1 - y0) / 6))) {
        for (let xx = x0; xx < x1; xx += Math.max(1, Math.floor((x1 - x0) / 6))) {
          const i = (yy * width + xx) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      g.push(sum / Math.max(1, n));
    }
  }
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** eBay image URLs carry a size token (s-l500 / s-l1600); ask for a small JPEG */
export function smallImageUrl(url: string): string {
  return url.replace(/s-l\d+\.(jpg|jpeg|png|webp)/i, 's-l225.jpg');
}

export async function hashPhoto(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(smallImageUrl(url), {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 64 });
    return dHash(img.data, img.width, img.height);
  } catch {
    return null;
  }
}

/** photo hashes persist across runs, so a photo is downloaded once and a reused photo is caught even when the other listing showed up days ago */
export const PHOTO_CACHE_KEY = 'evidence/photo-hashes.json';
export const PHOTO_CACHE_MAX = 4000;
export interface PhotoCache { schemaVersion: 1; items: Record<string, { hash: string; url: string; at: string; seller?: string | null }> }

export async function loadPhotoCache(store: ObjectStore): Promise<PhotoCache> {
  const c = await getJson<PhotoCache>(store, PHOTO_CACHE_KEY).catch(() => null);
  return c?.items ? c : { schemaVersion: 1, items: {} };
}

export async function savePhotoCache(store: ObjectStore, c: PhotoCache): Promise<void> {
  const entries = Object.entries(c.items).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, PHOTO_CACHE_MAX);
  await putJson(store, PHOTO_CACHE_KEY, { schemaVersion: 1, items: Object.fromEntries(entries) });
}

/** itemId → other itemIds that share its photo. Only ids in `focus` (default: all) get an entry. */
export function reusedPhotos(hashes: Map<string, string>, focus?: Set<string>): Map<string, string[]> {
  if (focus) {
    const out = new Map<string, string[]>();
    for (const id of focus) {
      const h = hashes.get(id);
      if (!h) continue;
      const others: string[] = [];
      for (const [o, oh] of hashes) if (o !== id && hamming(h, oh) <= PHOTO_MATCH_MAX_DISTANCE) others.push(o);
      if (others.length) out.set(id, others);
    }
    return out;
  }
  const ids = [...hashes.keys()];
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (hamming(hashes.get(ids[i])!, hashes.get(ids[j])!) <= PHOTO_MATCH_MAX_DISTANCE) {
        out.set(ids[i], [...(out.get(ids[i]) ?? []), ids[j]]);
        out.set(ids[j], [...(out.get(ids[j]) ?? []), ids[i]]);
      }
    }
  }
  return out;
}
