/**
 * sweep.ts — the SWEEP ENGINE: the wide net (Aug 2026 funnel-audit rebuild).
 *
 * The audit's arithmetic killed the per-key poll: 9,358 book keys × 1 query
 * each ÷ 45 queries/run = 98% of the book idle every run, watches and design
 * never polled at all, ~60% of the search quota unspent. The inversion: stop
 * asking eBay 9,358 narrow questions and ask ten WIDE ones — "everything newly
 * listed in this category since my cursor" — then identify in memory for free.
 *
 * The primitive, per slice:
 *   item_summary/search?category_ids={ONE id}&sort=newlyListed&limit=200
 *     &offset=…&filter=buyingOptions:{FIXED_PRICE},itemStartDate:[cursor−30m..],{sliceFilters}
 * Page until items older than the cursor appear or the page comes back short;
 * new cursor = max(itemCreationDate) seen. Dedupe by itemId against the
 * seen-ledger so a listing is evaluated once, not once per overlapping page.
 *
 * API rules learned the expensive way, encoded here:
 *   - ONE category id per call (mixed ids silently degrade filtering)
 *   - a `price:[…]` filter REQUIRES `priceCurrency:USD` beside it
 *   - error 1697 = this sort+filter combo is unsupported → probe once, drop
 *     the slice filters (keep FIXED_PRICE + the date cursor), mark the ledger
 *     line degraded, keep sweeping. A degraded slice still nets listings.
 *
 * THE AUCTION LANE (Aug 2026, closing calls): 'auction' slices invert the
 * posture — buyingOptions:{AUCTION}, sort=endingSoonest, itemEndDate:[..now+4h]
 * — and carry NO cursor: the 4h window is the filter, paged fully every run so
 * a lot re-checks each 3h tick as its bid moves. Their seen-ledger keys are
 * itemId+captureHour, so within-run page overlap dedupes without suppressing
 * the next run's re-check. Budget: their own ~20% carve (scheduler.ts).
 *
 * State (cursors + seen-ledger) persists in .starling-state/sweep-state.json —
 * the same mechanism as receipts: local file, R2 round-trip via data-store.sh.
 * FIXTURE MODE touches none of it: fixtures replay the same recorded listings
 * every run by design (the determinism contract), so cursor/seen filtering
 * would make the second local run silently empty.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { EbayListing, Vertical } from './types';
import type { EbayClient } from './lib/ebay-client';
import { CLOSING_WINDOW_MS } from './gate';
import { sweepFixtureListings } from './lib/fixture-source';

// ─────────────────────────────────────────────────────────────────────────────
// The slices — each is ONE category × ONE filter posture × ONE cursor
// ─────────────────────────────────────────────────────────────────────────────

export interface SweepSlice {
  /** stable id — the cursor key, the ledger line, the fixture map key */
  id: string;
  /** exactly ONE eBay category id (API rule — never joined) */
  categoryId: string;
  /** the operator's pocket label — leads carry it as their vertical lens */
  lens: string;
  /** matcher verticals bulk-identify tries, in order; [] = context-only class
   *  slices (fossils, vintage computing) — no exact identity exists there yet */
  identifyVerticals: Vertical[];
  /** slice filters BEYOND the buyingOptions posture (price pairs carry their
   *  required priceCurrency:USD) — droppable on an error/probe fallback */
  sliceFilters: string[];
  /** budget lane (scheduler.allocateSweepBudget): cards-lane slices share the
   *  40% cap; 'auction' slices share their own ~20% carve-out AND sweep the
   *  closing-calls posture (AUCTION + endingSoonest + the 4h itemEndDate
   *  window) instead of the newly-listed cursor walk. */
  lane: 'cards' | 'other' | 'auction';
}

export const SWEEP_SLICES: SweepSlice[] = [
  // 261328 = Sports Trading Card Singles. Two postures: slabs (condition 2750 =
  // Graded) at any price, and raw with a $30 floor (raised from $20, Aug 2026:
  // the $20–30 band is the bulk-common tide — budget spent, nothing gated in).
  { id: 'cards-slabs', categoryId: '261328', lens: 'sports-cards', identifyVerticals: ['sports-cards'], sliceFilters: ['conditionIds:{2750}'], lane: 'cards' },
  { id: 'cards-raw', categoryId: '261328', lens: 'sports-cards', identifyVerticals: ['sports-cards'], sliceFilters: ['price:[30..]', 'priceCurrency:USD'], lane: 'cards' },
  // 183454 = CCG Individual Cards — pokémon identity is title-first, so the
  // singles firehose is identifiable at zero cost. Floor raised $10 → $50
  // (Aug 2026, measured): junk-tier holo BIN asks run 1.5–6× above the
  // auction-clearing medians, so the sub-$50 band never gates in — it only
  // burned the slice's page budget before the real book keys scrolled past.
  { id: 'pokemon', categoryId: '183454', lens: 'pokemon', identifyVerticals: ['pokemon'], sliceFilters: ['price:[50..]', 'priceCurrency:USD'], lane: 'other' },
  // 31387 = Wristwatches — the audit's 1,278 never-polled keys, now swept.
  { id: 'watches', categoryId: '31387', lens: 'watches', identifyVerticals: ['watches'], sliceFilters: ['price:[100..]', 'priceCurrency:USD'], lane: 'other' },
  // The three autograph pools (sports 51 / entertainment 57 / historical 14428).
  { id: 'sports-autos', categoryId: '51', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'other' },
  { id: 'ent-autos', categoryId: '57', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'other' },
  { id: 'historical-autos', categoryId: '14428', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'other' },
  // 360 = Art Prints (leaf) — the edition matcher's home turf.
  { id: 'art-prints', categoryId: '360', lens: 'art-editions', identifyVerticals: ['art-editions'], sliceFilters: [], lane: 'other' },
  // Context-only classes: no exact key exists, but CLASS_CANON + the context
  // tier turn these into leads (megalodon tooth at half the rollup med, etc.).
  { id: 'fossils', categoryId: '3213', lens: 'science', identifyVerticals: [], sliceFilters: [], lane: 'other' },
  { id: 'vintage-computing', categoryId: '11189', lens: 'science', identifyVerticals: [], sliceFilters: [], lane: 'other' },
  // ── The AUCTION lane (closing calls). BIN mispricings get sniped fast;
  // auctions ending with low bids are where the real edge lives. Same
  // categories as the BIN net where the book is deepest: slabs, watches, the
  // three autograph pools. Each slice sweeps buyingOptions:{AUCTION} +
  // itemEndDate:[..now+4h] sorted endingSoonest — the window IS the filter, so
  // there is no cursor: every ending-soon auction is re-seen every 3h run (a
  // lot re-checks as its bid moves; the seen-ledger keys on itemId+captureHour
  // so it can't double-count within one run's overlapping pages).
  { id: 'cards-slabs-closing', categoryId: '261328', lens: 'sports-cards', identifyVerticals: ['sports-cards'], sliceFilters: ['conditionIds:{2750}'], lane: 'auction' },
  { id: 'watches-closing', categoryId: '31387', lens: 'watches', identifyVerticals: ['watches'], sliceFilters: ['price:[100..]', 'priceCurrency:USD'], lane: 'auction' },
  { id: 'sports-autos-closing', categoryId: '51', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'auction' },
  { id: 'ent-autos-closing', categoryId: '57', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'auction' },
  { id: 'historical-autos-closing', categoryId: '14428', lens: 'autographs', identifyVerticals: ['autographs'], sliceFilters: ['price:[25..]', 'priceCurrency:USD'], lane: 'auction' },
];

// ─────────────────────────────────────────────────────────────────────────────
// State — per-slice cursors + the cross-run seen-ledger (live mode only)
// ─────────────────────────────────────────────────────────────────────────────

const STATE_PATH = join(process.cwd(), '.starling-state', 'sweep-state.json');

export interface SweepState {
  /** slice id → ISO of the newest itemCreationDate ever seen on that slice */
  cursors: Record<string, string>;
  /** itemId → ISO last seen; pruned past SEEN_TTL_MS so it can't grow forever */
  seen: Record<string, string>;
}

/** Cursor overlap: re-fetch 30 minutes behind the cursor so a listing that
 *  landed during the previous run's pagination can't slip the net. The
 *  seen-ledger absorbs the duplicates the overlap re-fetches. */
const OVERLAP_MS = 30 * 60 * 1000;

/** Seen-ledger retention — a week covers every overlap window with margin. */
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PAGE_LIMIT = 200;
/** Browse search hard offset ceiling. */
const MAX_OFFSET = 10_000 - PAGE_LIMIT;

export function loadSweepState(): SweepState {
  if (!existsSync(STATE_PATH)) return { cursors: {}, seen: {} };
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<SweepState>;
    return { cursors: raw.cursors ?? {}, seen: raw.seen ?? {} };
  } catch {
    return { cursors: {}, seen: {} };
  }
}

export function commitSweepState(state: SweepState, now: number): void {
  // prune the seen-ledger by the injected run timestamp — never the wall clock
  for (const [id, iso] of Object.entries(state.seen)) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || now - t > SEEN_TTL_MS) delete state.seen[id];
  }
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

export interface SweptSlice {
  slice: SweepSlice;
  /** deduped fresh listings this run (seen-ledger already applied, live mode) */
  listings: EbayListing[];
  /** the per-slice ledger line — published in board.stats.bySlice */
  calls: number;
  newest?: string;
  oldest?: string;
  /** true when the slice fell back past an error-1697 sort+filter rejection */
  degraded: boolean;
}

function isoMax(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
function isoMin(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

async function sweepSliceLive(
  slice: SweepSlice,
  opts: { client: EbayClient; now: number; budget: number; state: SweepState },
): Promise<SweptSlice> {
  const { client, now, budget, state } = opts;
  const out: SweptSlice = { slice, listings: [], calls: 0, degraded: false };
  const cursorIso = state.cursors[slice.id];
  const cursorMs = cursorIso ? Date.parse(cursorIso) : NaN;

  const baseFilters = ['buyingOptions:{FIXED_PRICE}'];
  if (cursorIso && Number.isFinite(cursorMs)) {
    // re-fetch a 30-minute overlap; the seen-ledger dedupes the rerun tail
    const from = new Date(cursorMs - OVERLAP_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    baseFilters.push(`itemStartDate:[${from}..]`);
  }

  let offset = 0;
  let newCursor: string | undefined = cursorIso;
  while (out.calls < budget && offset <= MAX_OFFSET) {
    const filters = out.degraded ? baseFilters : [...baseFilters, ...slice.sliceFilters];
    let page: EbayListing[];
    try {
      page = await client.sweepPage(
        { categoryId: slice.categoryId, filters, offset, limit: PAGE_LIMIT },
        now,
      );
      out.calls++;
    } catch (e) {
      const msg = (e as Error).message;
      if (!out.degraded && slice.sliceFilters.length && msg.includes('1697')) {
        // sort+filter combo rejected — probe once, drop the slice filters, go on
        out.calls++; // the rejected call still spent quota
        out.degraded = true;
        console.warn(
          `[sweep] ${slice.id}: error 1697 (sort+filter unsupported) — dropping slice filters ` +
            `[${slice.sliceFilters.join(' ')}] for this run; gate() carries the load.`,
        );
        continue;
      }
      console.warn(`[sweep] ${slice.id} page@${offset} failed: ${msg}`);
      break;
    }

    let sawOlderThanCursor = false;
    for (const l of page) {
      const created = l.itemCreationDate;
      out.newest = isoMax(out.newest, created);
      out.oldest = isoMin(out.oldest, created);
      newCursor = isoMax(newCursor, created);
      if (created && Number.isFinite(cursorMs) && Date.parse(created) < cursorMs) {
        sawOlderThanCursor = true;
        continue; // pre-cursor tail of the overlap window — already evaluated
      }
      if (state.seen[l.itemId]) continue; // seen-ledger dedupe (cross-run + cross-page)
      state.seen[l.itemId] = new Date(now).toISOString();
      out.listings.push(l);
    }

    if (page.length < PAGE_LIMIT) break; // short page — the fresh window is drained
    if (sawOlderThanCursor) break; // paged past the cursor — everything older is old news
    offset += PAGE_LIMIT;
  }

  if (newCursor !== undefined) state.cursors[slice.id] = newCursor;
  return out;
}

/**
 * One AUCTION slice — the closing-calls net. No cursor: the 4h itemEndDate
 * window is the filter AND the pagination bound (sort=endingSoonest means the
 * first out-of-window end date ends the walk). Paged fully each run so every
 * ending-soon auction is seen every 3h tick; the seen-ledger keys on
 * itemId+captureHour, so the SAME lot re-checks next run as its bid moves but
 * never double-counts across one run's overlapping pages.
 *
 * `itemEndDate` is the Buy field-filter for end time (the itemStartDate
 * pattern). If eBay rejects the filter (invalid-filter error on the probe
 * page), we fall back to sort=endingSoonest alone + a client-side end-date cut
 * from the summaries, and mark the ledger line DEGRADED.
 */
async function sweepSliceAuctionLive(
  slice: SweepSlice,
  opts: { client: EbayClient; now: number; budget: number; state: SweepState },
): Promise<SweptSlice> {
  const { client, now, budget, state } = opts;
  const out: SweptSlice = { slice, listings: [], calls: 0, degraded: false };
  const windowEnd = now + CLOSING_WINDOW_MS;
  const endIso = new Date(windowEnd).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const captureHour = new Date(now).toISOString().slice(0, 13); // e.g. "2026-08-19T15"

  let offset = 0;
  while (out.calls < budget && offset <= MAX_OFFSET) {
    const filters = [
      'buyingOptions:{AUCTION}',
      ...(out.degraded ? [] : [`itemEndDate:[..${endIso}]`]),
      ...slice.sliceFilters,
    ];
    let page: EbayListing[];
    try {
      page = await client.sweepPage(
        { categoryId: slice.categoryId, filters, offset, limit: PAGE_LIMIT, sort: 'endingSoonest' },
        now,
      );
      out.calls++;
    } catch (e) {
      const msg = (e as Error).message;
      if (!out.degraded) {
        // probe rejected (invalid filter / unsupported combo) — drop the
        // itemEndDate filter, keep AUCTION + endingSoonest, cut client-side
        out.calls++; // the rejected call still spent quota
        out.degraded = true;
        console.warn(
          `[sweep] ${slice.id}: itemEndDate filter rejected (${msg.slice(0, 120)}) — ` +
            `DEGRADED: sort=endingSoonest + client-side end cut carries the window.`,
        );
        continue;
      }
      console.warn(`[sweep] ${slice.id} page@${offset} failed: ${msg}`);
      break;
    }

    let pastWindow = false;
    for (const l of page) {
      const endMs = l.itemEndDate ? Date.parse(l.itemEndDate) : NaN;
      // the client-side cut is ALWAYS applied — belt for the filter, whole
      // outfit for the degraded fallback. No end date → not a closing call.
      if (!Number.isFinite(endMs)) continue;
      if (endMs > windowEnd) {
        pastWindow = true; // endingSoonest: everything after this ends later still
        continue;
      }
      if (endMs <= now) continue; // already hammered between page and read
      out.newest = isoMax(out.newest, l.itemEndDate);
      out.oldest = isoMin(out.oldest, l.itemEndDate);
      const seenKey = `${l.itemId}@${captureHour}`;
      if (state.seen[seenKey]) continue; // same run/page overlap — one look per capture hour
      state.seen[seenKey] = new Date(now).toISOString();
      out.listings.push(l);
    }

    if (page.length < PAGE_LIMIT) break; // the window is drained
    if (pastWindow) break;
    offset += PAGE_LIMIT;
  }
  return out;
}

function sweepSliceFixture(slice: SweepSlice, now: number): SweptSlice {
  const listings = sweepFixtureListings(slice.id, now);
  let newest: string | undefined;
  let oldest: string | undefined;
  for (const l of listings) {
    newest = isoMax(newest, l.itemCreationDate);
    oldest = isoMin(oldest, l.itemCreationDate);
  }
  return { slice, listings, calls: 0, newest, oldest, degraded: false };
}

/**
 * Run every slice against its per-slice budget (scheduler.allocateSweepBudget).
 * Fixture mode replays fixtures/ebay/sweep.json and touches no state; live mode
 * advances cursors + the seen-ledger in `state` (caller commits after the run).
 */
export async function sweep(
  slices: SweepSlice[],
  opts: {
    mode: 'fixture' | 'live';
    client?: EbayClient;
    now: number;
    budgets: Record<string, number>;
    state: SweepState;
  },
): Promise<SweptSlice[]> {
  const out: SweptSlice[] = [];
  for (const slice of slices) {
    if (opts.mode === 'fixture') {
      out.push(sweepSliceFixture(slice, opts.now));
      continue;
    }
    if (!opts.client) throw new Error('live sweep requires an EbayClient');
    const liveOpts = {
      client: opts.client,
      now: opts.now,
      budget: opts.budgets[slice.id] ?? 0,
      state: opts.state,
    };
    out.push(
      slice.lane === 'auction'
        ? await sweepSliceAuctionLive(slice, liveOpts)
        : await sweepSliceLive(slice, liveOpts),
    );
  }
  return out;
}
