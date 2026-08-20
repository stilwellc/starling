/**
 * fixture-source.ts — the offline eBay stand-in (STARLING_MODE=fixture).
 *
 * Each fixtures/ebay/<vertical>.json is an array of EbayRawItem (getItem shape,
 * WITH localizedAspects). In fixture mode we treat every fixture item as both
 * the search result and the enriched item, so a single file drives the whole
 * poll → identify → gate → score path. See fixtures/README.md.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EbayListing, Vertical } from '../types';
import type { EbayRawItem } from './ebay-types';
import { normalizeItem } from './normalize';

const FIXTURE_DIR = join(process.cwd(), 'fixtures', 'ebay');

const FILE: Record<Vertical, string> = {
  watches: 'watches.json',
  'sports-cards': 'sports-cards.json',
  pokemon: 'pokemon.json',
  'art-editions': 'art-editions.json',
  autographs: 'autographs.json',
  design: 'design.json',
};

/** All fixture listings for a vertical, normalized + pre-enriched. Missing file
 *  → [] (a vertical whose matcher/fixtures haven't landed yet just contributes
 *  nothing, rather than crashing the run). */
export function fixtureListings(vertical: Vertical): EbayListing[] {
  const path = join(FIXTURE_DIR, FILE[vertical]);
  if (!existsSync(path)) return [];
  let raw: EbayRawItem[];
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[fixture-source] failed to parse ${path}: ${(e as Error).message}`);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => normalizeItem(it, it.categories ? 'EBAY_US' : 'EBAY_US'));
}

/** Fixture auction end dates are RELATIVE ("+102m" = 102 minutes after the
 *  injected run `now`) so the closing lane's hard 4h window can be exercised
 *  deterministically forever — a pinned ISO end date would silently age out of
 *  the window the day after it was recorded. Absolute ISO strings pass through
 *  untouched. */
const REL_END_RE = /^\+(\d+)m$/i;

function resolveEndDate(l: EbayListing, now: number): EbayListing {
  const m = l.itemEndDate?.match(REL_END_RE);
  if (!m) return l;
  return { ...l, itemEndDate: new Date(now + Number(m[1]) * 60_000).toISOString() };
}

/** The sweep engine's fixture: fixtures/ebay/sweep.json maps SLICE id (see
 *  scripts/sweep.ts SWEEP_SLICES) → the recorded listings that slice's category
 *  pages "returned". A missing file or absent slice id is a quiet slice this
 *  run, not an error — same posture as the vertical files. `now` is the run
 *  timestamp (injected, never the wall clock here) — it anchors the relative
 *  auction end dates above. */
export function sweepFixtureListings(sliceId: string, now: number): EbayListing[] {
  const path = join(FIXTURE_DIR, 'sweep.json');
  if (!existsSync(path)) return [];
  let raw: Record<string, EbayRawItem[]>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[fixture-source] failed to parse ${path}: ${(e as Error).message}`);
    return [];
  }
  const items = raw?.[sliceId];
  if (!Array.isArray(items)) return [];
  return items.map((it) => resolveEndDate(normalizeItem(it, 'EBAY_US'), now));
}

/** The hunt lane's fixture: fixtures/ebay/hunt.json maps hunt entry id → the
 *  recorded listings "returned" by that entry's queries (PROPOSAL §4.4). Keyed
 *  by entry id — not vertical — because a hunt target is the query. A missing
 *  file or absent id is a target with nothing live ("watching"), not an error. */
export function huntFixtureListings(huntId: string): EbayListing[] {
  const path = join(FIXTURE_DIR, 'hunt.json');
  if (!existsSync(path)) return [];
  let raw: Record<string, EbayRawItem[]>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn(`[fixture-source] failed to parse ${path}: ${(e as Error).message}`);
    return [];
  }
  const items = raw?.[huntId];
  if (!Array.isArray(items)) return [];
  return items.map((it) => normalizeItem(it, 'EBAY_US'));
}
