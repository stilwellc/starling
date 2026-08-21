import type { Metadata } from 'next';
import { isBoardStale } from '@/scripts/lib/load-board';
import { loadBoardExt } from '@/app/lib/board-data';
import { BoardControls } from '@/app/components/BoardControls';
import { ClosingSection } from '@/app/components/ClosingSection';
import { StaleBanner, EmptyBoard } from '@/app/components/Banners';
import { HuntModule } from '@/app/components/HuntModule';
import { LeadsSection } from '@/app/components/LeadsSection';
import { shortDate, relativeTime } from '@/app/lib/display';

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Starling — what the net caught today, powered by lectr',
  description:
    "Live eBay Buy It Now listings priced deep under lectr's certified corpus value — every deal shown with its evidence band and an A–D risk grade. Nothing manufactured.",
  openGraph: {
    title: 'Starling — what the net caught today',
    description:
      "Live Buy It Now listings priced deep under lectr's corpus value, risk-graded and evidence-backed.",
    type: 'website',
  },
};

export default function HomePage() {
  const board = loadBoardExt();
  // Board rank is dollar-edge × depth × confidence × risk (PROPOSAL §8) — sort desc, no vertical
  // term, so a great card deal and a great watch deal compete on equal footing.
  const deals = [...board.deals].sort((a, b) => b.rank - a.rank);
  const stale = isBoardStale(board);

  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';

  return (
    <>
      <div className="page-head">
        <div className="page-head-top">
          <span className="kicker">The board · ranked by dollar edge × depth × confidence × risk</span>
          {serial && <span className="serial">No. {serial}</span>}
        </div>
        <h1>
          What the net <span className="accent">caught</span> today.
        </h1>
        <p className="lede">
          Live eBay Buy It Now listings sitting deep under what lectr&apos;s certified price corpus
          says they&apos;re worth — every one shown with its evidence and an A–D risk grade. Nothing
          is manufactured; a deal exists only when its identity pins to an exact corpus key.
        </p>
        {board.builtAt && (
          <p className="build-stamp">
            <span className="stamp-live" aria-hidden="true" />
            <b>{deals.length}</b> live deals · board built{' '}
            <span title={shortDate(board.builtAt)}>{relativeTime(board.builtAt)}</span> · corpus{' '}
            {shortDate(board.bookBuiltAt)}
          </p>
        )}
      </div>

      {stale && <StaleBanner builtAt={board.builtAt} />}

      {/* Closing soon LEADS the page (the value audit's verdict: the closing
          lane is where the edge showed up) — soonest hammer at hero weight,
          before any BIN call. It leads a deal-less board too. */}
      {board.closing && board.closing.length > 0 && <ClosingSection calls={board.closing} />}

      {/* The hunt — curated targets stay PINNED above book-driven discovery
          (PROPOSAL §4.4): a strip carrying the watch state and any PRICED hits;
          the facts-only hits live on /hunt. */}
      {board.hunt && <HuntModule hunt={board.hunt} />}

      {/* The BIN board, in two tiers: "Featured — the defensible calls"
          (hero + grid), then "Worth a look" as caveated tape rows. */}
      {deals.length > 0 ? <BoardControls deals={deals} /> : <EmptyBoard />}

      {/* The wide net (v2, optional) — context leads, clearly not priced calls. */}
      {board.leads && <LeadsSection leads={board.leads} />}
    </>
  );
}
