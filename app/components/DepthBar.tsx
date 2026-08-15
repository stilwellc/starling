/**
 * DepthBar — the hero visual. Draws the corpus band (lo–med–hi) as a track and
 * plants the all-in ask on it, so "38% under the book" is SHOWN, not just stated
 * (PROPOSAL §4.1: "with the lo–hi band drawn, not just stated").
 *
 * Pure math on numbers already in the Deal — no value is manufactured here.
 */
import { money, depthPct } from '@/app/lib/display';

export function DepthBar({
  allIn,
  lo,
  med,
  hi,
  depth,
}: {
  allIn: number;
  lo: number;
  med: number;
  hi: number;
  depth: number;
}) {
  // Display range must contain the ask (which sits below lo on a deep deal),
  // the band, and a little breathing room on each end.
  const rawMin = Math.min(allIn, lo);
  const rawMax = Math.max(hi, med, allIn);
  const span = Math.max(rawMax - rawMin, 1);
  const pad = span * 0.06;
  const dMin = rawMin - pad;
  const dMax = rawMax + pad;
  const range = dMax - dMin;

  const pos = (x: number) => `${(((x - dMin) / range) * 100).toFixed(2)}%`;
  const bandLeft = ((lo - dMin) / range) * 100;
  const bandRight = ((hi - dMin) / range) * 100;

  return (
    <div className="depthbar" role="img" aria-label={`All-in ${money(allIn)}, ${depthPct(depth)} under the book median of ${money(med)}. Corpus band ${money(lo)} to ${money(hi)}.`}>
      <div className="depthbar-track">
        {/* the corpus band lo→hi */}
        <div
          className="depthbar-band"
          style={{ left: `${bandLeft.toFixed(2)}%`, width: `${(bandRight - bandLeft).toFixed(2)}%` }}
        />
        {/* median tick */}
        <div className="depthbar-med" style={{ left: pos(med) }} />
        {/* the ask, plus the depth gap fill from ask → med */}
        <div
          className="depthbar-gap"
          style={{ left: pos(allIn), width: `${(((med - allIn) / range) * 100).toFixed(2)}%` }}
        />
        <div className="depthbar-ask" style={{ left: pos(allIn) }}>
          <span className="depthbar-ask-dot" />
        </div>
      </div>
      <div className="depthbar-scale">
        <span className="depthbar-lo">{money(lo)}</span>
        <span className="depthbar-medlabel">book {money(med)}</span>
        <span className="depthbar-hi">{money(hi)}</span>
      </div>
    </div>
  );
}
