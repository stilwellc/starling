/**
 * carry.ts — BOARD CARRY-FORWARD: the board is a LIVE SET, not a per-tick
 * snapshot (Aug 2026 — the top product gap left after the sweep rebuild).
 *
 * The symptom, from real runs: the bootstrap tick published 77 deals, the next
 * incremental tick published 1 — because publish.ts only ever saw what THIS
 * tick's sweep caught, and a cursor-advanced sweep re-catches almost nothing.
 * A deal is not dead because our cursor moved past it; it is dead when eBay
 * says the listing is gone, or when its price stops clearing the gate.
 *
 * So the live deal set persists in R2 state (.starling-state/board-state.json,
 * the same tarball ride as sweep-state), and each run the previous board deals
 * that were NOT re-swept get re-verified alive in getItems BATCHES — the
 * getItems bucket, never the search quota:
 *
 *   price unchanged-or-lower → KEEP, with refreshed price/allIn/depth/rank
 *   price raised             → RE-GATE against the stored book call (the deal
 *                              carries its own med/lo/hi/conf — no book lookup)
 *   absent from the batch    → DROP; the itemId feeds receipts resolution
 *                              (absence from getItems IS the take-down signal)
 *
 * Carried survivors merge with the fresh catches — fresh wins on itemId, and a
 * fresh re-catch keeps its ORIGINAL surfacedAt (first-surfaced is a receipt
 * fact; the board should agree with the tape). publish.ts re-ranks the merged
 * set and caps it at BOARD_CAP. Closing calls are NEVER carried — they expire
 * naturally with the hammer. Hunt noBook hits ride the same pattern (fact
 * checks only — they have no depth to re-gate), still capped at
 * NOBOOK_CAP_PER_TARGET after the merge (run-board's existing cap block).
 *
 * FIXTURE MODE is a canned SECOND RUN: fixtures/ebay/carry.json supplies both
 * the "previous board" and the "getItems responses", so every carry path —
 * keep, refresh, re-gate pass, re-gate fail, ended — replays deterministically
 * offline. .starling-state stays untouched, same posture as sweep-state.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Deal, EbayListing, HuntDeal, HuntNoBookDeal, ValueBookRow } from './types';
import { GET_ITEMS_BATCH, type EbayClient } from './lib/ebay-client';
import { gate, huntGate, allInOf, LADDER_MIN_DEPTH } from './gate';
import { rankOf, evidenceWeightOf } from './score/rank';
import { carryFixture } from './lib/fixture-source';

const STATE_PATH = join(process.cwd(), '.starling-state', 'board-state.json');

/** The persisted live deal set — what last tick's board actually published. */
export interface BoardCarryState {
  deals: Deal[];
  huntNoBook: HuntNoBookDeal[];
}

/** getItems calls the carry pass may spend re-verifying per run. 15 × 20 =
 *  300 listings — the 200-deal board cap plus the hunt carry, with margin —
 *  and 15 × 8 runs = 120/day, small change inside the getItems bucket. */
export const CARRY_VERIFY_CALLS = 15;

const EMPTY: BoardCarryState = { deals: [], huntNoBook: [] };

/** Load last tick's live set. Live mode reads R2 state (absent/corrupt → empty:
 *  a first run legitimately has no previous board). Fixture mode reads the
 *  canned previous board from fixtures/ebay/carry.json — never the state dir. */
export function loadBoardState(mode: 'fixture' | 'live'): BoardCarryState {
  if (mode === 'fixture') return carryFixture().prior;
  if (!existsSync(STATE_PATH)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<BoardCarryState>;
    return {
      deals: Array.isArray(raw.deals) ? raw.deals : [],
      huntNoBook: Array.isArray(raw.huntNoBook) ? raw.huntNoBook : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist the published live set for the next tick (live mode only — the
 *  caller guards, same as commitSweepState; fixtures must stay deterministic). */
export function commitBoardState(state: BoardCarryState): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-verification — getItems batches; absence is the take-down signal
// ─────────────────────────────────────────────────────────────────────────────

interface Reverified {
  /** itemId → the current listing, for ids a successful batch returned */
  alive: Map<string, EbayListing>;
  /** ids a SUCCESSFUL batch omitted — no longer publicly available (ALA) */
  absent: Set<string>;
  /** ids we could not check this run (batch failed / over the call cap) —
   *  kept as-was, like resolveReceipts' transient posture; retried next tick */
  unverified: number;
}

async function reverify(
  itemIds: string[],
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number },
): Promise<Reverified> {
  const out: Reverified = { alive: new Map(), absent: new Set(), unverified: 0 };
  if (opts.mode === 'fixture') {
    // the fixture's items map IS the getItems response: null/missing = absent
    const { items } = carryFixture();
    for (const id of itemIds) {
      const l = items.get(id);
      if (l) out.alive.set(id, l);
      else out.absent.add(id);
    }
    return out;
  }
  if (!opts.client) throw new Error('live carry re-verification requires an EbayClient');
  const checkable = itemIds.slice(0, CARRY_VERIFY_CALLS * GET_ITEMS_BATCH);
  out.unverified = itemIds.length - checkable.length;
  for (let i = 0; i < checkable.length; i += GET_ITEMS_BATCH) {
    const chunk = checkable.slice(i, i + GET_ITEMS_BATCH);
    try {
      // singularFallback: carry re-verification is ABSENCE-CRITICAL (ALA + board
      // truth) — it gets the budgeted getItem fallback when batch is denied
      const items = await opts.client.getItems(chunk, opts.now, { singularFallback: true });
      const byId = new Map(items.map((it) => [it.itemId, it]));
      for (const id of chunk) {
        const l = byId.get(id);
        if (l) out.alive.set(id, l);
        else out.absent.add(id); // omitted from a good response — taken down
      }
    } catch (e) {
      // transient — this chunk stays unverified and carries as-was; a listing
      // is only ever dropped on POSITIVE absence, never on a network blip
      out.unverified += chunk.length;
      console.warn(`[carry] getItems batch failed: ${(e as Error).message}`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The carry pass
// ─────────────────────────────────────────────────────────────────────────────

/** The stored deal carries its whole book call — rebuild the row it was priced
 *  against so a raised price re-gates without a book lookup (the book may have
 *  moved since; the receipt froze THIS call, so the re-gate honors it). */
function rowOf(d: Deal): ValueBookRow {
  return { k: d.key, v: d.vertical, med: d.med, lo: d.lo, hi: d.hi, n: d.n, ...(d.n12 !== undefined ? { n12: d.n12 } : {}), lastSale: d.lastSale, trend: d.trend, conf: d.conf };
}

/** A kept deal with the live read folded in: price/allIn/depth refreshed, rank
 *  recomputed (depth moved, and the freshBoost decays as listedAt ages). The
 *  identity, the book call, and surfacedAt are FROZEN — first-call-wins. */
function refreshDeal(d: Deal, l: EbayListing, allIn: number, depth: number, now: number): Deal {
  return {
    ...d,
    itemPrice: l.price,
    shipping: l.shippingCost,
    allIn,
    depth,
    edgeUsd: d.med - allIn,
    rank: rankOf(d.med - allIn, depth, d.conf, d.risk.grade, evidenceWeightOf(d.lastSale, d.n12, new Date(now)), d.listedAt, new Date(now)),
  };
}

export interface CarryResult {
  /** previous-board deals still alive and still clearing the gate */
  deals: Deal[];
  /** previous noBook hunt hits still alive and still passing fact checks */
  huntNoBook: HuntNoBookDeal[];
  /** itemIds a successful batch proved gone — feeds receipts resolution */
  endedItemIds: Set<string>;
}

/**
 * Carry last tick's live set forward past this tick's fresh catches. Mutates
 * NOTHING except fresh deals' surfacedAt (a re-caught deal keeps its original
 * first-surfaced stamp — the receipts ledger already froze it; the board
 * agrees). Returns the survivors to merge; run-board pushes them into the
 * fresh arrays and publish.ts re-ranks/caps the union.
 */
export async function carryForward(
  prev: BoardCarryState,
  fresh: { deals: Deal[]; huntDeals: HuntDeal[]; huntClaimed: Set<string>; liveHuntIds?: Set<string> },
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number },
): Promise<CarryResult> {
  const out: CarryResult = { deals: [], huntNoBook: [], endedItemIds: new Set() };
  const prevDealByItem = new Map(prev.deals.map((d) => [d.itemId, d]));
  // A hit whose hunt TARGET was removed from priority.yaml dies with the
  // target (Aug 21 2026: Collin cleared the broad seeds — their carried hits
  // must not linger on the board until the listings end).
  const orphaned = prev.huntNoBook.filter(
    (h) => fresh.liveHuntIds && !fresh.liveHuntIds.has(h.huntId),
  );
  if (orphaned.length > 0) {
    console.log(`[carry] hunt noBook: ${orphaned.length} dropped — their targets left the hunt list`);
  }
  const prevHuntByItem = new Map(
    prev.huntNoBook
      .filter((h) => !fresh.liveHuntIds || fresh.liveHuntIds.has(h.huntId))
      .map((h) => [h.itemId, h]),
  );

  // fresh wins the dedupe — but first-surfaced survives the re-catch
  for (const d of fresh.deals) {
    const was = prevDealByItem.get(d.itemId);
    if (was) d.surfacedAt = was.surfacedAt;
  }
  for (const h of fresh.huntDeals) {
    const was = h.noBook ? prevHuntByItem.get(h.itemId) : undefined;
    if (was) h.surfacedAt = was.surfacedAt;
  }

  const freshIds = new Set<string>([
    ...fresh.deals.map((d) => d.itemId),
    ...fresh.huntDeals.map((d) => d.itemId),
    ...fresh.huntClaimed,
  ]);
  // verification priority under the call cap: deepest board deals first, then
  // hunt hits newest first — if anything must go unchecked, it's the tail
  const dealCands = prev.deals
    .filter((d) => !freshIds.has(d.itemId))
    .sort((a, b) => b.rank - a.rank);
  const huntCands = prev.huntNoBook
    .filter((h) => !freshIds.has(h.itemId))
    // orphaned targets die here too — this is the list that actually carries
    .filter((h) => !fresh.liveHuntIds || fresh.liveHuntIds.has(h.huntId))
    .sort((a, b) => String(b.listedAt || '').localeCompare(String(a.listedAt || '')));
  if (dealCands.length === 0 && huntCands.length === 0) return out;

  const v = await reverify(
    [...dealCands.map((d) => d.itemId), ...huntCands.map((h) => h.itemId)],
    opts,
  );

  let refreshed = 0;
  let regated = 0;
  let regateFail = 0;
  for (const d of dealCands) {
    if (v.absent.has(d.itemId)) {
      out.endedItemIds.add(d.itemId); // gone from eBay → off the board, onto the tape
      continue;
    }
    const l = v.alive.get(d.itemId);
    if (!l) {
      out.deals.push(d); // unverified — carried as-was, re-checked next tick
      continue;
    }
    const allIn = allInOf(l);
    if (allIn <= d.allIn) {
      // unchanged or repriced DOWN — still the deal we called, or a better one
      if (allIn !== d.allIn) refreshed++;
      out.deals.push(refreshDeal(d, l, allIn, 1 - allIn / d.med, opts.now));
      continue;
    }
    // repriced UP — the call must re-earn its slot against the frozen book row
    const g = gate(l, rowOf(d), { now: opts.now, ...(d.basis === 'ladder' ? { minDepth: LADDER_MIN_DEPTH } : {}) });
    if (!g.pass) {
      regateFail++; // still live on eBay, just no longer a deal — NOT ended
      continue;
    }
    regated++;
    out.deals.push(refreshDeal(d, l, g.allIn, g.depth, opts.now));
  }

  let huntDropped = 0;
  for (const h of huntCands) {
    if (v.absent.has(h.itemId)) {
      huntDropped++; // noBook hits carry no receipt — nothing to resolve
      continue;
    }
    const l = v.alive.get(h.itemId);
    if (!l) {
      out.huntNoBook.push(h); // unverified — carried as-was
      continue;
    }
    // facts only, re-checked on the live read: a real price, no condition flag
    const g = huntGate(l, {});
    if (!g.pass) {
      huntDropped++;
      continue;
    }
    out.huntNoBook.push({ ...h, itemPrice: l.price, shipping: l.shippingCost, allIn: g.allIn });
  }

  const droppedDeals = out.endedItemIds.size + regateFail;
  console.log(
    `[carry] board: ${dealCands.length} prior not re-swept → carried ${out.deals.length} ` +
      `(${refreshed} refreshed lower, ${regated} re-gated on a raise) · ` +
      `dropped ${droppedDeals} (${out.endedItemIds.size} ended, ${regateFail} re-gate fail)` +
      (v.unverified ? ` · ${v.unverified} unverified (kept as-was, retried next tick)` : ''),
  );
  if (huntCands.length) {
    console.log(
      `[carry] hunt noBook: ${huntCands.length} prior → carried ${out.huntNoBook.length} · dropped ${huntDropped}`,
    );
  }
  return out;
}
