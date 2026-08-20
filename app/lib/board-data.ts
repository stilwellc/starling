/**
 * board-data.ts — the UI's OWN defensive reader for board.json v2.
 *
 * The pipeline's v2 contract (scripts/types.ts) adds three OPTIONAL surfaces:
 * lectr `context` stamps on noBook hits, a `leads[]` wide-net section, and a
 * `stats` funnel for the methodology page. scripts/lib/load-board.ts predates
 * them and strips unknown fields, so the app reads the artifact itself here.
 * Every new field is optional and every shape is checked before render —
 * TODAY'S v1 board.json renders identically, and a half-migrated artifact can
 * never break the build.
 *
 * No number is manufactured: everything surfaced here is carried verbatim
 * from the artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Board, BoardStats, HuntNoBookDeal, HuntSection } from '@/scripts/types';

// ─────────────────────────────────────────────────────────────────────────────
// UI-side shapes — deliberately LOOSER than scripts/types so the render layer
// tolerates contract drift (kind strings it hasn't met, flat vs nested stats).
// ─────────────────────────────────────────────────────────────────────────────

/** A lectr context stamp: a REAL corpus read one level up the identity ladder
 *  (signer / player-object / class / artist) — background, never a priced call
 *  on the listing it accompanies. Mirrors DealContext with `kind` loosened. */
export interface LectrContext {
  k: string;
  kind: string;
  med: number;
  lo: number;
  hi: number;
  n: number;
  lastSale: string;
}

/** Wide-net leads are noBook-shaped (scripts/types Board.leads). */
export type Lead = HuntNoBookDeal;

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** A context stamp only renders when its numbers are real numbers. */
export function validContext(c: unknown): c is LectrContext {
  if (!c || typeof c !== 'object') return false;
  const ctx = c as Record<string, unknown>;
  return (
    typeof ctx.k === 'string' &&
    typeof ctx.kind === 'string' &&
    isFiniteNum(ctx.med) &&
    isFiniteNum(ctx.lo) &&
    isFiniteNum(ctx.hi) &&
    isFiniteNum(ctx.n)
  );
}

/** Context carried on a hunt hit / lead / target, or undefined. Never throws. */
export function contextOf(x: unknown): LectrContext | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const c = (x as { context?: unknown }).context;
  return validContext(c) ? c : undefined;
}

// ── stats normalizers — tolerate both the shipped v2 shapes and simpler ones ─

/** Total API calls whether `calls` arrives as a number or a per-bucket ledger
 *  ({ search, getItems } — separate eBay quota buckets). */
export function totalCalls(stats: BoardStats | undefined): number | undefined {
  const calls: unknown = stats?.calls;
  if (isFiniteNum(calls)) return calls;
  if (calls && typeof calls === 'object') {
    const vals = Object.values(calls).filter(isFiniteNum);
    if (vals.length > 0) return vals.reduce((a, b) => a + b, 0);
  }
  return undefined;
}

/** Total identities pinned whether `identified` is a number or per-vertical. */
export function totalIdentified(stats: BoardStats | undefined): number | undefined {
  const idf: unknown = stats?.identified;
  if (isFiniteNum(idf)) return idf;
  if (idf && typeof idf === 'object') {
    const vals = Object.values(idf).filter(isFiniteNum);
    if (vals.length > 0) return vals.reduce((a, b) => a + b, 0);
  }
  return undefined;
}

/** Gate reasons flattened to reason → count, whether the artifact ships them
 *  flat or nested vertical → reason → count. Sorted desc. */
export function flatGateReasons(stats: BoardStats | undefined): Array<[string, number]> {
  const src: unknown = stats?.gateReasons;
  if (!src || typeof src !== 'object') return [];
  const acc = new Map<string, number>();
  for (const [key, val] of Object.entries(src)) {
    if (isFiniteNum(val)) {
      acc.set(key, (acc.get(key) ?? 0) + val);
    } else if (val && typeof val === 'object') {
      for (const [reason, count] of Object.entries(val as Record<string, unknown>)) {
        if (isFiniteNum(count)) acc.set(reason, (acc.get(reason) ?? 0) + count);
      }
    }
  }
  return [...acc.entries()].sort((a, b) => b[1] - a[1]);
}

/** Per-slice funnel rows with only their numeric columns kept. */
export function sliceRows(
  stats: BoardStats | undefined,
): Array<{ slice: string; cols: Record<string, number> }> {
  const src: unknown = stats?.bySlice;
  if (!src || typeof src !== 'object') return [];
  const rows: Array<{ slice: string; cols: Record<string, number> }> = [];
  for (const [slice, val] of Object.entries(src)) {
    if (!val || typeof val !== 'object') continue;
    const cols: Record<string, number> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (isFiniteNum(v)) cols[k] = v;
    }
    if (Object.keys(cols).length > 0) rows.push({ slice, cols });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader — mirrors scripts/lib/load-board.ts fallbacks, keeps the v2 extras
// ─────────────────────────────────────────────────────────────────────────────

const BOARD_PATH = path.join(process.cwd(), 'public', 'data', 'starling', 'board.json');

export const EMPTY_BOARD: Board = {
  schema: 1,
  builtAt: '',
  bookBuiltAt: '',
  deals: [],
  perVertical: {},
};

export function loadBoardExt(): Board {
  try {
    const raw = fs.readFileSync(BOARD_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Board> | null;
    if (!parsed || !Array.isArray(parsed.deals)) {
      console.warn('[board-data] board.json missing a deals array — using empty board.');
      return EMPTY_BOARD;
    }
    const hunt: HuntSection | undefined =
      parsed.hunt && Array.isArray(parsed.hunt.targets) && Array.isArray(parsed.hunt.deals)
        ? parsed.hunt
        : undefined;
    const leads = Array.isArray(parsed.leads)
      ? parsed.leads.filter(
          (l): l is HuntNoBookDeal =>
            Boolean(l && typeof l === 'object' && typeof (l as HuntNoBookDeal).title === 'string'),
        )
      : undefined;
    const stats =
      parsed.stats && typeof parsed.stats === 'object' ? (parsed.stats as BoardStats) : undefined;
    return {
      schema: 1,
      builtAt: parsed.builtAt ?? '',
      bookBuiltAt: parsed.bookBuiltAt ?? '',
      deals: parsed.deals,
      perVertical: parsed.perVertical ?? {},
      ...(hunt ? { hunt } : {}),
      ...(leads && leads.length > 0 ? { leads } : {}),
      ...(stats ? { stats } : {}),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[board-data] could not read/parse board.json (${(err as Error).message}) — using empty board.`,
      );
    }
    return EMPTY_BOARD;
  }
}
