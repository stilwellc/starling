import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadBoard, isBoardStale } from '@/scripts/lib/load-board';
import { DealCard } from '@/app/components/DealCard';
import { StaleBanner, EmptyBoard } from '@/app/components/Banners';
import { ALL_VERTICALS, verticalLabel, isVertical, shortDate } from '@/app/lib/display';

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

// Every launch vertical gets a permalink page, prebuilt at export.
export function generateStaticParams() {
  return ALL_VERTICALS.map((vertical) => ({ vertical }));
}

export function generateMetadata({ params }: { params: { vertical: string } }): Metadata {
  if (!isVertical(params.vertical)) return { title: 'Starling' };
  const label = verticalLabel(params.vertical);
  return {
    title: `${label} deals — Starling, powered by lectr`,
    description: `Live eBay Buy It Now ${label} listings priced deep under lectr's corpus value, risk-graded and evidence-backed.`,
    openGraph: {
      title: `${label} deals · Starling`,
      description: `${label} on eBay Buy It Now, priced deep under lectr's corpus value.`,
      type: 'website',
    },
  };
}

export default function VerticalPage({ params }: { params: { vertical: string } }) {
  if (!isVertical(params.vertical)) notFound();
  const vertical = params.vertical;

  const board = loadBoard();
  const deals = board.deals
    .filter((d) => d.vertical === vertical)
    .sort((a, b) => b.rank - a.rank);
  const stat = board.perVertical[vertical];
  const stale = isBoardStale(board);

  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';

  return (
    <>
      <div className="page-head">
        <div className="page-head-top">
          <span className="kicker">{verticalLabel(vertical)} · one slice of the mixed board</span>
          {serial && <span className="serial">No. {serial}</span>}
        </div>
        <h1>
          {verticalLabel(vertical)}, <span className="accent">under book</span>.
        </h1>
        <p className="lede">
          {verticalLabel(vertical)} listings on eBay Buy It Now sitting deep under lectr&apos;s
          certified corpus value. This is the same honest ranking as the mixed board — depth ×
          confidence × risk — filtered to one vertical.
        </p>
        {stat && (
          <p className="build-stamp">
            <b>{stat.surfaced}</b> surfaced · {stat.matched} matched · {stat.polled} polled
            {board.builtAt ? ` · built ${shortDate(board.builtAt)}` : ''}
          </p>
        )}
      </div>

      <div className="controls">
        <div className="control-row">
          <span className="control-label">Vertical</span>
          <div className="chips">
            <Link className="chip" href="/">
              All
            </Link>
            {ALL_VERTICALS.map((v) => (
              <Link
                key={v}
                href={`/v/${v}/`}
                className={`chip${v === vertical ? ' chip-on' : ''}`}
              >
                {verticalLabel(v)}
                {board.perVertical[v] ? (
                  <span className="chip-count">{board.perVertical[v]!.surfaced}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {stale && <StaleBanner builtAt={board.builtAt} />}

      {deals.length > 0 ? (
        <>
          <DealCard deal={deals[0]} density="hero" />
          {deals.length > 1 && (
            <div className="grid grid-after-hero">
              {deals.slice(1, 7).map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          )}
          {deals.length > 7 && (
            <section className="board-tape" aria-label="The rest of this vertical">
              <div className="rule-head">
                <span className="kicker">The rest of the tape</span>
                <span className="rule-head-count">{deals.length - 7} more</span>
              </div>
              <div className="deal-rows">
                {deals.slice(7).map((d) => (
                  <DealCard key={d.id} deal={d} density="row" />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <EmptyBoard title={`No ${verticalLabel(vertical)} deals qualify right now.`}>
          {`The corpus is live for ${verticalLabel(vertical)}, but no eBay listing currently pins to a key and sits deep enough under book value. This gap is a visible roadmap item, not a hidden fact — coverage per vertical is tracked on the About page.`}
        </EmptyBoard>
      )}

      <p className="build-stamp" style={{ marginTop: 28 }}>
        <Link href="/" className="back-link" style={{ margin: 0 }}>
          ← Back to the mixed board
        </Link>
      </p>
    </>
  );
}
