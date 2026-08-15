/**
 * publish.ts — write the board artifact the static site reads at build time.
 * public/data/starling/board.json (+ receipts.json handled by receipts.ts).
 * Deals sorted by rank desc — the mixed board's default order.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Board, Deal, PerVerticalStat, Vertical } from './types';

const OUT_DIR = join(process.cwd(), 'public', 'data', 'starling');
const BOARD_PATH = join(OUT_DIR, 'board.json');

export function publishBoard(
  deals: Deal[],
  perVertical: Partial<Record<Vertical, PerVerticalStat>>,
  meta: { builtAt: string; bookBuiltAt: string },
): Board {
  const board: Board = {
    schema: 1,
    builtAt: meta.builtAt,
    bookBuiltAt: meta.bookBuiltAt,
    deals: deals.slice().sort((a, b) => b.rank - a.rank),
    perVertical,
  };
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BOARD_PATH, JSON.stringify(board, null, 2));
  return board;
}
