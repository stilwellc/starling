import type { Metadata } from 'next';
import Link from 'next/link';
import { loadBoard, isBoardStale } from '@/scripts/lib/load-board';
import { StaleBanner, EmptyBoard } from '@/app/components/Banners';
import { HuntHitCard } from '@/app/components/HuntModule';
import { huntLensLabel, shortDate } from '@/app/lib/display';

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The Hunt — curated targets, polled every run · Starling',
  description:
    "Starling's hunt list: hand-curated priority targets watched above book-driven discovery — every target polled every run, every hit surfaced with its evidence or honestly labeled when no book value exists.",
};

export default function HuntPage() {
  const board = loadBoard();
  const hunt = board.hunt;
  const stale = isBoardStale(board);

  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';
  const hitsByTarget = new Map<string, NonNullable<typeof hunt>['deals']>();
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
          every single run, paid first from the call budget. The book still prices every hit;
          when no book row exists, the hit is shown as facts only, never a manufactured number.
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
          {hunt.targets.map((t) => {
            const hits = hitsByTarget.get(t.id) ?? [];
            return (
              <section key={t.id} className="hunt-target" aria-label={t.label}>
                <div className="hunt-target-head">
                  <div className="hunt-target-title">
                    <h2>{t.label}</h2>
                    <span className="hunt-lens">{huntLensLabel(t.vertical)}</span>
                  </div>
                  <span className="hunt-added">watched since {shortDate(t.added)}</span>
                </div>
                {t.note && <p className="hunt-note">{t.note}</p>}
                {hits.length > 0 ? (
                  <div className="grid">
                    {hits.map((d) => (
                      <HuntHitCard key={d.id} deal={d} />
                    ))}
                  </div>
                ) : (
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
