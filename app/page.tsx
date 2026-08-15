import { loadBoard, isBoardStale } from '@/scripts/lib/load-board';
import { BoardControls } from '@/app/components/BoardControls';
import { StaleBanner, EmptyBoard } from '@/app/components/Banners';
import { shortDate } from '@/app/lib/display';

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

export default function HomePage() {
  const board = loadBoard();
  // Board rank is depth × confidence × risk (PROPOSAL §8) — sort desc, no vertical
  // term, so a great card deal and a great watch deal compete on equal footing.
  const deals = [...board.deals].sort((a, b) => b.rank - a.rank);
  const stale = isBoardStale(board);

  return (
    <>
      <div className="page-head">
        <h1>Deep-value deals, priced against the corpus.</h1>
        <p className="lede">
          Live eBay Buy It Now listings sitting deep under what lectr&apos;s certified price corpus
          says they&apos;re worth — every one shown with its evidence and an A–D risk grade. Nothing
          is manufactured; a deal exists only when its identity pins to an exact corpus key.
        </p>
        {board.builtAt && (
          <p className="build-stamp">
            <b>{deals.length}</b> live deals · board built {shortDate(board.builtAt)} · corpus{' '}
            {shortDate(board.bookBuiltAt)}
          </p>
        )}
      </div>

      {stale && <StaleBanner builtAt={board.builtAt} />}

      {deals.length > 0 ? (
        <BoardControls deals={deals} />
      ) : (
        <EmptyBoard />
      )}
    </>
  );
}
