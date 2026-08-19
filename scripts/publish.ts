/**
 * publish.ts — write the board artifact the static site reads at build time.
 * public/data/starling/board.json (+ receipts.json handled by receipts.ts).
 * Deals sorted by rank desc — the mixed board's default order. The hunt section
 * (§4.4) carries its own order: priced hits by rank desc, then the "hunted — no
 * book value" hits by recency — a priced deal is a stronger claim than facts,
 * and among facts the newest listing matters most.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Board, Deal, HuntDeal, HuntSection, PerVerticalStat, Vertical } from './types';

const OUT_DIR = join(process.cwd(), 'public', 'data', 'starling');
const BOARD_PATH = join(OUT_DIR, 'board.json');

/** Hunt-section order: priced above noBook; rank desc within priced; recency
 *  desc (listedAt, else surfacedAt) within noBook; id as the deterministic tie. */
export function sortHuntDeals(deals: HuntDeal[]): HuntDeal[] {
  const recency = (d: HuntDeal) => Date.parse(d.listedAt ?? d.surfacedAt) || 0;
  return deals.slice().sort((a, b) => {
    if (!a.noBook !== !b.noBook) return a.noBook ? 1 : -1;
    if (!a.noBook && !b.noBook) {
      const byRank = (b as Deal).rank - (a as Deal).rank;
      if (byRank !== 0) return byRank;
    } else {
      const byRecency = recency(b) - recency(a);
      if (byRecency !== 0) return byRecency;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function publishBoard(
  deals: Deal[],
  perVertical: Partial<Record<Vertical, PerVerticalStat>>,
  meta: { builtAt: string; bookBuiltAt: string },
  hunt?: HuntSection,
): Board {
  const board: Board = {
    schema: 1,
    builtAt: meta.builtAt,
    bookBuiltAt: meta.bookBuiltAt,
    deals: deals.slice().sort((a, b) => b.rank - a.rank),
    perVertical,
    ...(hunt ? { hunt: { targets: hunt.targets, deals: sortHuntDeals(hunt.deals) } } : {}),
  };
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BOARD_PATH, JSON.stringify(board, null, 2));
  return board;
}
