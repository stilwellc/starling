import type { Metadata } from 'next';
import { loadReceipts } from '@/scripts/lib/load-board';
import { EmptyBoard } from '@/app/components/Banners';
import {
  verticalLabel,
  money,
  depthPct,
  outcomeLabel,
  shortDate,
} from '@/app/lib/display';
import { prettyKey } from '@/app/lib/display';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The Tape — every call Starling made · powered by lectr',
  description:
    'Starling\'s receipts: every deal we surfaced and what happened to it — sold, ended, or delisted, with the final price where visible. The call is frozen; the outcome is graded against it.',
};

export default function TapePage() {
  const receipts = [...loadReceipts()].sort(
    (a, b) => Date.parse(b.surfacedAt) - Date.parse(a.surfacedAt),
  );

  const sold = receipts.filter((r) => r.outcome === 'sold');
  const medianSoldVsBook =
    sold.length > 0
      ? (() => {
          const ratios = sold
            .filter((r) => r.finalPrice != null && r.med > 0)
            .map((r) => r.finalPrice! / r.med)
            .sort((a, b) => a - b);
          if (ratios.length === 0) return null;
          const mid = Math.floor(ratios.length / 2);
          return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
        })()
      : null;

  return (
    <>
      <div className="page-head">
        <h1>The Tape</h1>
        <p className="lede">
          Every deal Starling surfaced, and what happened to it. The call — book value, depth, risk
          — is frozen the moment we surface it and never rewritten. When a listing leaves Buy It Now
          we record the outcome and grade our call against it. This is Starling&apos;s backtest, in
          public. (The dead listing&apos;s photo and price come off the board immediately; only our
          own record remains here.)
        </p>
        {receipts.length > 0 && (
          <p className="build-stamp">
            <b>{receipts.length}</b> calls logged · {sold.length} sold
            {medianSoldVsBook != null
              ? ` · median sold at ${Math.round(medianSoldVsBook * 100)}% of book`
              : ''}
          </p>
        )}
      </div>

      {receipts.length > 0 ? (
        <>
          <div className="tape-scroll">
            <table className="tape-table">
              <thead>
                <tr>
                  <th>Surfaced</th>
                  <th>Vertical</th>
                  <th>Identity</th>
                  <th>Depth</th>
                  <th>All-in</th>
                  <th>Book</th>
                  <th>Risk</th>
                  <th>Outcome</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>{shortDate(r.surfacedAt)}</td>
                    <td>{verticalLabel(r.vertical)}</td>
                    <td className="tape-key">{prettyKey(r.key)}</td>
                    <td className="tape-depth">{depthPct(r.depthAtSurface)}</td>
                    <td>{money(r.allInAtSurface)}</td>
                    <td>{money(r.med)}</td>
                    <td>{r.riskGrade}</td>
                    <td>
                      <span className={`outcome outcome-${r.outcome}`}>
                        {outcomeLabel(r.outcome)}
                      </span>
                    </td>
                    <td>{r.finalPrice != null ? money(r.finalPrice) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tape-legend">
            Depth and all-in are the call as first surfaced. &ldquo;Sold&rdquo; means the market
            agreed the deal was real; &ldquo;final&rdquo; is the eBay sale price where visible.
            Median sold-vs-book is the honest measure of whether our calls hold up.
          </p>
        </>
      ) : (
        <EmptyBoard title="No calls resolved yet.">
          The tape fills as Starling surfaces deals and their listings resolve — sold, ended, or
          delisted. Every entry is a frozen call graded against what actually happened. Check back
          once the board has run.
        </EmptyBoard>
      )}
    </>
  );
}
