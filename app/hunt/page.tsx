import type { Metadata } from 'next';
import Link from 'next/link';
import { isBoardStale } from '@/scripts/lib/load-board';
import { loadBoardExt, contextOf } from '@/app/lib/board-data';
import type { HuntDeal, HuntNoBookDeal, HuntPricedDeal } from '@/scripts/types';
import { StaleBanner, EmptyBoard } from '@/app/components/Banners';
import { HuntPricedCard, isPricedHunt } from '@/app/components/HuntModule';
import { ContextPanel } from '@/app/components/ContextPanel';
import { FactRow } from '@/app/components/FactRow';
import { huntLensLabel, shortDate } from '@/app/lib/display';

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The Hunt — curated targets, polled every run · Starling',
  description:
    "Starling's hunt list: hand-curated priority targets watched above book-driven discovery — every target polled every run, every hit surfaced with its evidence or honestly labeled when no book value exists.",
  openGraph: {
    title: 'The Hunt · Starling',
    description:
      'Hand-curated targets watched every run — priced hits with full evidence, everything else as honest listing facts.',
    type: 'website',
  },
};

const ROWS_VISIBLE = 6;

export default function HuntPage() {
  const board = loadBoardExt();
  const hunt = board.hunt;
  const stale = isBoardStale(board);

  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';
  const hitsByTarget = new Map<string, HuntDeal[]>();
  for (const d of hunt?.deals ?? []) {
    const arr = hitsByTarget.get(d.huntId) ?? [];
    arr.push(d); // board order (publish.ts) — priced by rank, then noBook by recency
    hitsByTarget.set(d.huntId, arr);
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head-top">
          <span className="kicker">The hunt · curated priorities above the book</span>
          {serial && <span className="serial">No. {serial}</span>}
        </div>
        <h1>
          What we&apos;re <span className="accent">hunting</span>.
        </h1>
        <p className="lede">
          The book is the floor, not the strategy. These targets are hand-curated — the grails and
          references worth watching regardless of where the data is deepest — and they are polled
          every single run, paid first from the call budget. The book still prices every hit; when
          no book row exists, the hit is shown as facts only, never a manufactured number.
        </p>
        {hunt && (
          <p className="build-stamp">
            <b>{hunt.targets.length}</b> targets watched · {hunt.deals.length} live{' '}
            {hunt.deals.length === 1 ? 'hit' : 'hits'}
            {board.builtAt ? ` · board built ${shortDate(board.builtAt)}` : ''}
          </p>
        )}
      </div>

      {stale && <StaleBanner builtAt={board.builtAt} />}

      {hunt && hunt.targets.length > 0 ? (
        <div className="hunt-targets">
          {hunt.targets.map((t, i) => {
            const hits = hitsByTarget.get(t.id) ?? [];
            const priced = hits.filter(isPricedHunt);
            const noBook = hits.filter((d): d is HuntNoBookDeal => Boolean(d.noBook));
            // Context for the target's certificate: carried on the target itself
            // (v2) or, failing that, on any of its hits — same corpus read.
            const targetContext = contextOf(t) ?? noBook.map(contextOf).find(Boolean);
            const rows = noBook.slice(0, ROWS_VISIBLE);
            const overflow = noBook.slice(ROWS_VISIBLE);

            return (
              <section key={t.id} className="hunt-target" aria-label={t.label}>
                <div className="hunt-target-head">
                  <div className="hunt-target-title">
                    <span className="hunt-index serial">{String(i + 1).padStart(2, '0')}</span>
                    <h2>{t.label}</h2>
                    <span className="hunt-lens">{huntLensLabel(t.vertical)}</span>
                  </div>
                  <span className="hunt-added">watched since {shortDate(t.added)}</span>
                </div>
                {t.note && <p className="hunt-note">{t.note}</p>}

                {targetContext && <ContextPanel context={targetContext} />}

                {priced.length > 0 && (
                  <div className="grid hunt-priced-grid">
                    {priced.map((d: HuntPricedDeal) => (
                      <HuntPricedCard key={d.id} deal={d} />
                    ))}
                  </div>
                )}

                {noBook.length > 0 && (
                  <div className="hunt-facts">
                    <div className="rule-head rule-head-quiet">
                      <span className="kicker">
                        live, facts only · no book row {priced.length > 0 ? '' : '— nothing priced yet'}
                      </span>
                      <span className="rule-head-count">{noBook.length} live</span>
                    </div>
                    <div className="fact-rows">
                      {rows.map((d) => (
                        <FactRow key={d.id} item={d} context={contextOf(d)} />
                      ))}
                    </div>
                    {overflow.length > 0 && (
                      <details className="rows-more">
                        <summary>Show {overflow.length} more live hits</summary>
                        <div className="fact-rows">
                          {overflow.map((d) => (
                            <FactRow key={d.id} item={d} context={contextOf(d)} />
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}

                {hits.length === 0 && (
                  <p className="hunt-watching">
                    <span className="pulse" aria-hidden="true" />
                    nothing live — watching
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyBoard title="No hunt targets configured yet.">
          The hunt list lives in <code>hunt/priority.yaml</code> — hand-curated, PR-reviewed
          targets the pipeline polls every run, above book-driven discovery. Once targets land,
          each appears here with its live hits or an honest &ldquo;watching&rdquo; state.
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
