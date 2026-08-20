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
import { tierOf } from './lib/tier';
import type {
  AuctionCall,
  Board,
  BoardStats,
  Deal,
  HuntDeal,
  HuntNoBookDeal,
  HuntSection,
  PerVerticalStat,
  Vertical,
} from './types';

const OUT_DIR = join(process.cwd(), 'public', 'data', 'starling');
const BOARD_PATH = join(OUT_DIR, 'board.json');

/** board.deals cap. With carry-forward (carry.ts) the board is a LIVE SET that
 *  accumulates across ticks, so it needs a ceiling: rank orders the merged set
 *  and the tail past 200 is depth the page would never show anyway. What falls
 *  off the cap also falls out of board-state — a capped-out deal re-earns its
 *  slot only by being re-swept. */
export const BOARD_CAP = 200;

/** board.closing cap — the lane is an urgency strip, not a second board. */
export const CLOSING_CAP = 30;

/** Closing calls publish soonest-ending FIRST — urgency is the lane's whole
 *  point — with id as the deterministic tie. */
export function sortClosing(calls: AuctionCall[]): AuctionCall[] {
  return calls
    .slice()
    .sort(
      (a, b) =>
        (Date.parse(a.endsAt) || 0) - (Date.parse(b.endsAt) || 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

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
  extras?: { leads?: HuntNoBookDeal[]; stats?: BoardStats; closing?: AuctionCall[] },
): Board {
  const board: Board = {
    schema: 1,
    builtAt: meta.builtAt,
    bookBuiltAt: meta.bookBuiltAt,
    // rank-desc as ever, then each deal stamped with its front-page tier
    // (lib/tier.ts): 'featured' = the defensible calls, 'worth-a-look' = the
    // rest. Placement only — the sort is untouched, and nothing is dropped.
    deals: deals
      .slice()
      .sort((a, b) => b.rank - a.rank)
      .slice(0, BOARD_CAP)
      .map((d) => ({ ...d, tier: tierOf(d) })),
    perVertical,
    ...(hunt ? { hunt: { targets: hunt.targets, deals: sortHuntDeals(hunt.deals) } } : {}),
    // schema v2 additions — all optional, all absent on pre-sweep boards.
    // Leads arrive pre-capped/pre-sorted from run-board (ratio-to-context-med);
    // closing calls sort endsAt asc here (soonest hammer first) and cap at 30.
    ...(extras?.leads?.length ? { leads: extras.leads } : {}),
    ...(extras?.closing?.length ? { closing: sortClosing(extras.closing).slice(0, CLOSING_CAP) } : {}),
    ...(extras?.stats ? { stats: extras.stats } : {}),
  };
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BOARD_PATH, JSON.stringify(board, null, 2));
  return board;
}
