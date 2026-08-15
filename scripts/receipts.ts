/**
 * receipts.ts — "deals we surfaced, and what happened."
 *
 * Starling's calls-ledger, mirroring lectr's (Ray: scripts/lib/calls-ledger.ts):
 * first-call-wins append (the surfaced call is frozen), later graded against the
 * outcome. This is the trust engine and the marketing engine — the /tape page.
 *
 * The ledger lives in R2 state (.starling-state/receipts.json locally); it is
 * NOT derived from the board, so a deal that leaves the board keeps its receipt.
 * Per the eBay ALA, once a listing is no longer publicly available its live
 * content comes off the board — but our own record (call, book value, outcome)
 * is ours to keep.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Deal, Receipt } from './types';
import type { EbayClient } from './lib/ebay-client';

const LEDGER_PATH = join(process.cwd(), '.starling-state', 'receipts.json');
const PUBLISHED_PATH = join(process.cwd(), 'public', 'data', 'starling', 'receipts.json');

function ensureDir(p: string) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function loadReceipts(): Receipt[] {
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Receipt[];
  } catch {
    return [];
  }
}

function saveReceipts(receipts: Receipt[]) {
  ensureDir(LEDGER_PATH);
  writeFileSync(LEDGER_PATH, JSON.stringify(receipts, null, 2));
  // The published copy is what the /tape page reads (static export).
  ensureDir(PUBLISHED_PATH);
  writeFileSync(PUBLISHED_PATH, JSON.stringify(receipts, null, 2));
}

/** Append newly surfaced deals (first-call-wins — never rewrite an existing id). */
export function recordSurfaced(prior: Receipt[], deals: Deal[], now: string): Receipt[] {
  const byId = new Map(prior.map((r) => [r.id, r]));
  for (const d of deals) {
    if (byId.has(d.id)) continue;
    byId.set(d.id, {
      id: d.id,
      itemId: d.itemId,
      vertical: d.vertical,
      key: d.key,
      surfacedAt: now,
      depthAtSurface: d.depth,
      allInAtSurface: d.allIn,
      med: d.med,
      conf: d.conf,
      riskGrade: d.risk.grade,
      outcome: 'live',
    });
  }
  return [...byId.values()];
}

/**
 * Re-check live receipts and resolve the ones that left Buy It Now. Uses the
 * cheap COMPACT re-check. In fixture mode there's no client, so live receipts
 * stay 'live' (nothing to resolve offline).
 */
export async function resolveReceipts(
  receipts: Receipt[],
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number; nowIso: string; cap?: number },
): Promise<Receipt[]> {
  if (opts.mode === 'fixture' || !opts.client) return receipts;
  const live = receipts.filter((r) => r.outcome === 'live');
  const cap = Math.min(opts.cap ?? live.length, live.length);
  // Rotate a cap-sized window through the live set each tick (same trick as the
  // poll scheduler) — a fixed "first N" would recheck the same stuck listings
  // forever while newer ones never get resolved.
  const start = live.length > 0 ? Math.floor(opts.now / (3 * 60 * 60 * 1000)) % live.length : 0;
  for (let i = 0; i < cap; i++) {
    const r = live[(start + i) % live.length];
    try {
      const status = await opts.client.recheck(r.itemId, opts.now);
      if (status === null) {
        r.outcome = 'ended'; // no longer publicly available
        r.resolvedAt = opts.nowIso;
      }
      // still available → remains 'live'. (Sold-price capture needs the
      // marketplace-deletion signal; 'ended' is the honest default.)
    } catch {
      /* transient — try again next run */
    }
  }
  return receipts;
}

/** Persist the ledger (both the state copy and the published /tape copy). */
export function commitReceipts(receipts: Receipt[]) {
  saveReceipts(receipts);
}
