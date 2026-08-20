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
  /** slice filters BEYOND buyingOptions:{FIXED_PRICE} (price pairs carry their
   *  required priceCurrency:USD) — droppable on an error-1697 probe */
  sliceFilters: string[];
  /** cards-lane slices share the 40% sweep cap (scheduler.allocateSweepBudget) */
  lane: 'cards' | 'other';
}

export const SWEEP_SLICES: SweepSlice[] = [
  // 261328 = Sports Trading Card Singles. Two postures: slabs (condition 2750 =
  // Graded) at any price, and raw with a $20 floor to skip the bulk-common tide.
  { id: 'cards-slabs', categoryId: '261328', lens: 'sports-cards', identifyVerticals: ['sports-cards'], sliceFilters: ['conditionIds:{2750}'], lane: 'cards' },
  { id: 'cards-raw', categoryId: '261328', lens: 'sports-cards', identifyVerticals: ['sports-cards'], sliceFilters: ['price:[20..]', 'priceCurrency:USD'], lane: 'cards' },
  // 183454 = CCG Individual Cards — pokémon identity is title-first, so the
  // whole singles firehose (with a $10 floor) is identifiable at zero cost.
  { id: 'pokemon', categoryId: '183454', lens: 'pokemon', identifyVerticals: ['pokemon'], sliceFilters: ['price:[10..]', 'priceCurrency:USD'], lane: 'other' },
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

function sweepSliceFixture(slice: SweepSlice): SweptSlice {
  const listings = sweepFixtureListings(slice.id);
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
      out.push(sweepSliceFixture(slice));
      continue;
    }
    if (!opts.client) throw new Error('live sweep requires an EbayClient');
    out.push(
      await sweepSliceLive(slice, {
        client: opts.client,
        now: opts.now,
        budget: opts.budgets[slice.id] ?? 0,
        state: opts.state,
      }),
    );
  }
  return out;
}
