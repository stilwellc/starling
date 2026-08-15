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
