/**
 * load-board.ts — the UI's build-time bridge to the pipeline's output.
 *
 * Starling is a static export (`output:'export'`): there is no server at runtime,
 * so every route reads the board ONCE at build time via fs and bakes the result
 * into static HTML. The pipeline (publish.ts) owns
 *   public/data/starling/board.json      → Board
 *   public/data/starling/receipts.json   → Receipt[]
 *
 * Neither file is guaranteed to exist — the app must build cleanly BEFORE the
 * first pipeline run (P0 board shell). So both loaders fall back to an empty,
 * schema-valid value instead of throwing, and every route renders its empty
 * state. A malformed file is treated the same as a missing one (with a warning)
 * so a half-written artifact can never break the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Board, Receipt } from '../types';

const DATA_DIR = path.join(process.cwd(), 'public', 'data', 'starling');
const BOARD_PATH = path.join(DATA_DIR, 'board.json');
const RECEIPTS_PATH = path.join(DATA_DIR, 'receipts.json');

/** A valid, empty board. Rendered as the "book is live, no deals yet" state. */
export const EMPTY_BOARD: Board = {
  schema: 1,
  builtAt: '',
  bookBuiltAt: '',
  deals: [],
  perVertical: {},
};

export function loadBoard(): Board {
  try {
    const raw = fs.readFileSync(BOARD_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Board;
    if (!parsed || !Array.isArray(parsed.deals)) {
      console.warn('[load-board] board.json missing a deals array — using empty board.');
      return EMPTY_BOARD;
    }
    return {
      schema: 1,
      builtAt: parsed.builtAt ?? '',
      bookBuiltAt: parsed.bookBuiltAt ?? '',
      deals: parsed.deals,
      perVertical: parsed.perVertical ?? {},
      // hunt section (§4.4) — optional: boards built before the feature (or by
      // a run with no hunt file) simply have no hunt lane to render.
      ...(parsed.hunt && Array.isArray(parsed.hunt.targets) && Array.isArray(parsed.hunt.deals)
        ? { hunt: parsed.hunt }
        : {}),
      // schema v2 (sweep rebuild): context leads + run stats — optional, and
      // passed through verbatim so the UI sees exactly what the pipeline wrote.
      ...(Array.isArray(parsed.leads) ? { leads: parsed.leads } : {}),
      ...(parsed.stats && typeof parsed.stats === 'object' ? { stats: parsed.stats } : {}),
    };
  } catch (err) {
    // ENOENT before the first pipeline run is expected — quiet on that, loud otherwise.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[load-board] could not read/parse board.json (${(err as Error).message}) — using empty board.`);
    }
    return EMPTY_BOARD;
  }
}

export function loadReceipts(): Receipt[] {
  try {
    const raw = fs.readFileSync(RECEIPTS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Receipt[];
    if (!Array.isArray(parsed)) {
      console.warn('[load-board] receipts.json is not an array — using empty tape.');
      return [];
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[load-board] could not read/parse receipts.json (${(err as Error).message}) — using empty tape.`);
    }
    return [];
  }
}

/** True when the board artifact is older than 2 cron periods (6h) — drives the
 *  stale-data banner (PROPOSAL §4.2). Empty/never-built boards are not "stale". */
export function isBoardStale(board: Board, now = Date.now()): boolean {
  if (!board.builtAt) return false;
  const built = Date.parse(board.builtAt);
  if (Number.isNaN(built)) return false;
  const TWO_PERIODS_MS = 6 * 60 * 60 * 1000; // cron runs every 3h
  return now - built > TWO_PERIODS_MS;
}
