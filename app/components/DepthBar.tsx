/**
 * DepthBar — the money visualization and the product's signature instrument.
 *
 * Draws the corpus band (lo — med — hi) as a physical object and plants the
 * all-in ask ON it as the brand diamond, with the mint gap fill running
 * ask → median: "38% under the book", shown before it's stated.
 *
 * Three sizes, one geometry:
 *   hero — tall, ask price labeled above the diamond, full scale row
 *   grid — the card instrument (default)
 *   mini — a 14px strip for row density; no labels, title carries the numbers
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
  size = 'grid',
}: {
  allIn: number;
  lo: number;
  med: number;
  hi: number;
  depth: number;
  size?: 'hero' | 'grid' | 'mini';
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

  const pct = (x: number) => ((x - dMin) / range) * 100;
  const pos = (x: number) => `${pct(x).toFixed(2)}%`;
  const bandLeft = pct(lo);
  const bandRight = pct(hi);
  const askPct = pct(allIn);
  const gapLeft = Math.min(askPct, pct(med));
  const gapWidth = Math.abs(pct(med) - askPct);

  // Keep the floating ask label on the canvas near the edges.
  const askAlign = askPct < 14 ? 'left' : askPct > 86 ? 'right' : 'center';

  // Scale labels sit at their TRUE positions on the rail (the instrument never
  // lies about geometry); lo/hi drop out when they'd collide with the median.
  const medPct = pct(med);
  const showLo = Math.abs(bandLeft - medPct) > 12;
  const showHi = Math.abs(bandRight - medPct) > 12;
  const edgeAlign = (p: number) => (p < 10 ? 'left' : p > 90 ? 'right' : 'center');

  const label = `All-in ${money(allIn)}, ${depthPct(depth)} under the book median of ${money(
    med,
  )}. Corpus band ${money(lo)} to ${money(hi)}.`;

  if (size === 'mini') {
    return (
      <div className="depthbar depthbar-mini" role="img" aria-label={label}>
        <div className="depthbar-track">
          <div
            className="depthbar-band"
            style={{
              left: `${bandLeft.toFixed(2)}%`,
              width: `${(bandRight - bandLeft).toFixed(2)}%`,
            }}
          />
          <div className="depthbar-med" style={{ left: pos(med) }} />
          <div
            className="depthbar-gap"
            style={{ left: `${gapLeft.toFixed(2)}%`, width: `${gapWidth.toFixed(2)}%` }}
          />
          <div className="depthbar-ask" style={{ left: pos(allIn) }}>
            <span className="depthbar-ask-dot" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`depthbar${size === 'hero' ? ' depthbar-hero' : ''}`} role="img" aria-label={label}>
      {/* the floating ask price, anchored to the diamond */}
      <div className="depthbar-askrow">
        <span
          className={`depthbar-asklabel align-${askAlign}`}
          style={{ left: pos(allIn) }}
        >
          ask {money(allIn)}
        </span>
      </div>
      <div className="depthbar-track">
        {/* the corpus band lo→hi, with end ticks */}
        <div
          className="depthbar-band"
          style={{
            left: `${bandLeft.toFixed(2)}%`,
            width: `${(bandRight - bandLeft).toFixed(2)}%`,
          }}
        />
        {/* median tick */}
        <div className="depthbar-med" style={{ left: pos(med) }} />
        {/* the depth gap fill from ask → med */}
        <div
          className="depthbar-gap"
          style={{ left: `${gapLeft.toFixed(2)}%`, width: `${gapWidth.toFixed(2)}%` }}
        />
        {/* the ask — the brand diamond */}
        <div className="depthbar-ask" style={{ left: pos(allIn) }}>
          <span className="depthbar-ask-dot" />
        </div>
      </div>
      <div className="depthbar-scale">
        {showLo && (
          <span className={`depthbar-lo align-${edgeAlign(bandLeft)}`} style={{ left: pos(lo) }}>
            {money(lo)}
          </span>
        )}
        <span
          className={`depthbar-medlabel align-${edgeAlign(medPct)}`}
          style={{ left: pos(med) }}
        >
          book {money(med)}
        </span>
        {showHi && (
          <span className={`depthbar-hi align-${edgeAlign(bandRight)}`} style={{ left: pos(hi) }}>
            {money(hi)}
          </span>
        )}
      </div>
    </div>
  );
}
