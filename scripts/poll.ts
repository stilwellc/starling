/**
 * poll.ts — Tier-1 discovery. Turns a run plan into normalized listings.
 *   fixture: load every recorded listing for the vertical (already enriched).
 *   live:    run each compiled query via the Browse API, dedup by itemId.
 * Downstream (identify → enrich → gate → score) is identical for both.
 * The hunt lane (pollHunt) is the same two modes, grouped per hunt entry so
 * every hit carries its target's stamp (PROPOSAL §4.4).
 */
import type { EbayListing, Vertical } from './types';
import type { VerticalPlan, HuntPlan } from './scheduler';
import type { HuntEntry } from './hunt';
import type { EbayClient } from './lib/ebay-client';
import { fixtureListings, huntFixtureListings } from './lib/fixture-source';

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

// ─────────────────────────────────────────────────────────────────────────────
// The hunt lane — polled FIRST, every run (PROPOSAL §4.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolledHunt {
  entry: HuntEntry;
  /** matcher verticals that may identify this entry's hits, in compile order —
   *  empty for raw-terms targets outside the launch set (noBook-only) */
  identifyVerticals: Vertical[];
  listings: EbayListing[];
  calls: number;
}

/**
 * Poll the hunt plan, grouped per entry (a keyPrefix entry compiles several
 * queries; its hits pool under the one target). fixture: recorded listings per
 * entry id. live: each query via Browse, dedup by itemId within the entry.
 */
export async function pollHunt(
  plan: HuntPlan,
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number },
): Promise<PolledHunt[]> {
  // Group compiled queries by entry, preserving yaml (priority) order.
  const groups = new Map<string, PolledHunt>();
  for (const c of plan.queries) {
    let g = groups.get(c.entry.id);
    if (!g) {
      g = { entry: c.entry, identifyVerticals: [], listings: [], calls: 0 };
      groups.set(c.entry.id, g);
    }
    if (c.identifyVertical && !g.identifyVerticals.includes(c.identifyVertical)) {
      g.identifyVerticals.push(c.identifyVertical);
    }
  }

  if (opts.mode === 'fixture') {
    for (const g of groups.values()) g.listings = huntFixtureListings(g.entry.id);
    return [...groups.values()];
  }

  if (!opts.client) throw new Error('live hunt poll requires an EbayClient');
  const seenByEntry = new Map<string, Map<string, EbayListing>>();
  for (const c of plan.queries) {
    const g = groups.get(c.entry.id)!;
    let page: EbayListing[] = [];
    try {
      page = await opts.client.search(c.query, opts.now);
      g.calls++;
    } catch (e) {
      console.warn(`[poll] hunt ${c.entry.id} query "${c.query.q}" failed: ${(e as Error).message}`);
      continue;
    }
    let seen = seenByEntry.get(c.entry.id);
    if (!seen) {
      seen = new Map();
      seenByEntry.set(c.entry.id, seen);
    }
    for (const l of page) if (!seen.has(l.itemId)) seen.set(l.itemId, l);
  }
  for (const [id, seen] of seenByEntry) groups.get(id)!.listings = [...seen.values()];
  return [...groups.values()];
}
