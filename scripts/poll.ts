/**
 * poll.ts — Tier-1 discovery. Turns a run plan into normalized listings.
 *   fixture: load every recorded listing for the vertical (already enriched).
 *   live:    run each compiled query via the Browse API, dedup by itemId.
 * Downstream (identify → enrich → gate → score) is identical for both.
 */
import type { EbayListing, Vertical } from './types';
import type { VerticalPlan } from './scheduler';
import type { EbayClient } from './lib/ebay-client';
import { fixtureListings } from './lib/fixture-source';

export interface PolledVertical {
  vertical: Vertical;
  listings: EbayListing[];
  calls: number; // Tier-1 calls actually spent (quota accounting)
}

export async function poll(
  plans: VerticalPlan[],
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number },
): Promise<PolledVertical[]> {
  const out: PolledVertical[] = [];
  for (const plan of plans) {
    if (opts.mode === 'fixture') {
      out.push({ vertical: plan.vertical, listings: fixtureListings(plan.vertical), calls: 0 });
      continue;
    }
    if (!opts.client) throw new Error('live poll requires an EbayClient');
    const seen = new Map<string, EbayListing>();
    let calls = 0;
    for (const q of plan.queries) {
      let page: EbayListing[] = [];
      try {
        page = await opts.client.search(q, opts.now);
        calls++;
      } catch (e) {
        console.warn(`[poll] ${plan.vertical} query "${q.q}" failed: ${(e as Error).message}`);
        continue;
      }
      for (const l of page) if (!seen.has(l.itemId)) seen.set(l.itemId, l);
    }
    out.push({ vertical: plan.vertical, listings: [...seen.values()], calls });
  }
  return out;
}
