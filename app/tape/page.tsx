import type { Metadata } from 'next';
import { loadBoard, loadReceipts } from '@/scripts/lib/load-board';
import { EmptyBoard } from '@/app/components/Banners';
import {
  verticalLabel,
  money,
  depthPct,
  outcomeLabel,
  shortDate,
  prettyKey,
} from '@/app/lib/display';

// Static export: receipts are read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The Tape — every call Starling made · powered by lectr',
  description:
    "Starling's receipts: every deal we surfaced and what happened to it — sold, ended, or delisted, with the final price where visible. The call is frozen; the outcome is graded against it.",
  openGraph: {
    title: 'The Tape · Starling',
    description:
      'Every call Starling made, frozen at surface and graded against the outcome — the backtest, in public.',
    type: 'website',
  },
};

export default function TapePage() {
  const board = loadBoard();
  const receipts = [...loadReceipts()].sort(
    (a, b) => Date.parse(b.surfacedAt) - Date.parse(a.surfacedAt),
  );

  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';

  // Summary metrics — computed from the receipts array, never manufactured.
  const sold = receipts.filter((r) => r.outcome === 'sold');
  const live = receipts.filter((r) => r.outcome === 'live');
  const soldPct = receipts.length > 0 ? Math.round((sold.length / receipts.length) * 100) : 0;

  const soldVsBookRatios = sold
    .filter((r) => r.finalPrice != null && r.med > 0)
    .map((r) => r.finalPrice! / r.med)
    .sort((a, b) => a - b);
  const medianSoldVsBook =
    soldVsBookRatios.length > 0
      ? soldVsBookRatios.length % 2
        ? soldVsBookRatios[(soldVsBookRatios.length - 1) / 2]
        : (soldVsBookRatios[soldVsBookRatios.length / 2 - 1] +
            soldVsBookRatios[soldVsBookRatios.length / 2]) /
          2
      : null;

  return (
    <>
      <div className="page-head">
        <div className="page-head-top">
          <span className="kicker">The tape · deals we surfaced, and what happened</span>
          {serial && <span className="serial">No. {serial}</span>}
        </div>
        <h1>
          Every call, <span className="accent">settled</span>.
        </h1>
        <p className="lede">
          The call — book value, depth, risk — is frozen the moment Starling surfaces a deal and
          never rewritten. When a listing leaves Buy It Now we record the outcome and grade the call
          against it. This is the backtest, in public: the dead listing&apos;s photo and price come
          off the board immediately, but our own record stays here.
        </p>
      </div>

      {receipts.length > 0 ? (
        <>
          <div className="stat-grid" style={{ marginBottom: 28 }}>
            <div className="stat-tile">
              <div className="stat-label">Calls logged</div>
              <div className="stat-num">{receipts.length}</div>
              <div className="stat-cap">frozen the moment surfaced</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Resolved sold</div>
              <div className="stat-num">{sold.length}</div>
              <div className="stat-cap">{soldPct}% of calls to date</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Still live</div>
              <div className="stat-num">{live.length}</div>
              <div className="stat-cap">open on Buy It Now now</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Median sold vs book</div>
              <div className="stat-num">
                {medianSoldVsBook != null ? `${Math.round(medianSoldVsBook * 100)}%` : '—'}
              </div>
              <div className="stat-cap">
                {medianSoldVsBook != null ? 'of the lectr median' : 'awaiting first sale'}
              </div>
            </div>
          </div>

          <div className="tape-wrap">
            <table className="tape-table">
              <thead>
                <tr>
                  <th>Surfaced</th>
                  <th>Vertical</th>
                  <th>Identity</th>
                  <th className="tape-num">Depth at surface</th>
                  <th className="tape-num">Book</th>
                  <th>Risk</th>
                  <th>Outcome</th>
                  <th className="tape-num">Final</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Surfaced">{shortDate(r.surfacedAt)}</td>
                    <td data-label="Vertical">{verticalLabel(r.vertical)}</td>
                    <td data-label="Identity">
                      <code>{prettyKey(r.key)}</code>
                    </td>
                    <td className="tape-num" data-label="Depth at surface">{depthPct(r.depthAtSurface)}</td>
                    <td className="tape-num" data-label="Book">{money(r.med)}</td>
                    <td data-label="Risk">{r.riskGrade}</td>
                    <td data-label="Outcome">
                      <span className={`outcome outcome-${r.outcome}`}>
                        {outcomeLabel(r.outcome)}
                      </span>
                    </td>
                    <td className="tape-num" data-label="Final">{r.finalPrice != null ? money(r.finalPrice) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="build-stamp">
            Depth at surface and the book median are the call as first surfaced. &ldquo;Sold&rdquo;
            means the market agreed the deal was real; &ldquo;final&rdquo; is the eBay sale price
            where visible. Median sold-vs-book is the honest measure of whether the calls hold up.
          </p>
        </>
      ) : (
        <EmptyBoard title="No settled calls yet.">
          The tape fills as surfaced deals resolve — sold, ended, or delisted. Every entry is a
          frozen call graded against what actually happened. Check back once the board has run.
        </EmptyBoard>
      )}
    </>
  );
}
