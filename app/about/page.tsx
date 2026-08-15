import type { Metadata } from 'next';
import { loadBoard } from '@/scripts/lib/load-board';
import { ALL_VERTICALS, verticalLabel, shortDate } from '@/app/lib/display';

// Static export: figures are read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'About — how Starling works · powered by lectr',
  description:
    "Starling's thesis, methodology, and honesty rules: a buy-side arbitrage lens on eBay Buy It Now, powered by lectr's certified price corpus. Per-vertical metrics, never blended.",
};

export default function AboutPage() {
  const board = loadBoard();
  const serial = board.builtAt ? board.builtAt.slice(0, 10).replace(/-/g, '') : '';

  return (
    <>
      <div className="page-head">
        <div className="page-head-top">
          <span className="kicker">About · the methodology & the honesty rules</span>
          {serial && <span className="serial">No. {serial}</span>}
        </div>
        <h1>
          The buy-side <span className="accent">lens</span> on lectr.
        </h1>
        <p className="lede">
          lectr spent a year building the sell-side truth — a <b>1.1M+ sold-lot corpus</b> with
          exact-identity keys and conformal price bands. Starling points that knowledge at eBay Buy
          It Now and surfaces the listings priced deep below it. Nothing here is manufactured.
        </p>
      </div>

      <div className="prose">
        <h2>The thesis</h2>
        <p>
          eBay Buy It Now is the largest fixed-price collectibles surface on earth, and it is priced
          by humans without lectr&apos;s knowledge. Sellers misprice constantly — wrong comps, stale
          comps, no comps. For every listing whose identity we can pin to an exact corpus key, we
          look up what that exact thing actually trades for and surface the ones listed deep below
          it. The moat isn&apos;t the eBay integration — anyone can call the Browse API. The moat is
          the value behind every depth call:{' '}
          <strong>761K+ settled prices, conformal bands, and a published backtest record.</strong>
        </p>

        <h2>Cards are first-class — and capped</h2>
        <p>
          Cards are the vertical where lectr holds the most data and the arena with the most
          competition: card comps are trivially findable, so mispricings get sniped fast. The
          failure mode to engineer against is a board that fills with card deals by sheer volume,
          starving the opaque-comp verticals — autographs, art editions — where the corpus is a
          genuine information advantage.
        </p>
        <p>
          So cards get a full matcher, full polling, and full board presence — but the{' '}
          <strong>scheduler caps their call budget</strong> so they can&apos;t monopolize attention.
          Ranking stays honest: <code>depth × confidence × risk</code>, with no cards penalty
          <em> and</em> no cards bonus. A great card deal and a great autograph deal compete on equal
          footing, and the board defaults to the mixed view.
        </p>

        <h2>The honesty rules</h2>
        <p>
          <strong>Nothing is manufactured.</strong> A deal exists only when an eBay listing&apos;s
          identity pins to an <em>exact</em> corpus key. If the identity is unclear the matcher
          abstains — it never fuzzy-matches. Every number on a card is a corpus fact, one tap from
          the comps on lectr.
        </p>
        <p>
          <strong>Every risk grade shows its reasons.</strong> Each A/B/C/D grade lists the signals
          behind it — authenticity anchor, seller history, listing quality, per-vertical fake-rate
          prior. Nothing is a black box; a D-grade deal sits at the bottom with its reasons, never
          silently removed.
        </p>
        <p>
          <strong>One hard suppression, stated.</strong> A listing more than 90% under book reads as
          fake or broken and is suppressed with the rule named — the only hard gate in the system.
          Everything else is ranked, never gated.
        </p>

        <h2>The risk model</h2>
        <p>
          Every deal carries an A–D grade, scored from weighted signals and always explained on the
          card:
        </p>
        <p>
          <strong>A — lowest risk.</strong> Authenticity anchor machine-verified (e.g. a PSA cert
          API match), seller ≥98% feedback with volume, aspects complete.{' '}
          <strong>B — low risk.</strong> Slab, papers, or LOA claimed but unverified; a solid seller
          and no condition flags. <strong>C — moderate risk.</strong> A raw item or a thin listing —
          stock photo, sparse aspects, or a newer seller. <strong>D — high risk.</strong> Multiple
          weak signals; shown at the bottom, reasons listed, never hidden.
        </p>
        <p>
          The score sums four axes — authenticity anchor, seller signals, listing quality, and a
          per-vertical fake-rate prior (watches and autographs carry higher priors than slabbed
          cards — priced in, not hidden). Weights live in one reviewed file, tuned later against the
          receipts, not against vibes.
        </p>

        <h2>How the call is built</h2>
        <p>
          <strong>Depth</strong> = 1 − allIn / book median, where all-in includes the cheapest
          shipping option. A deal must sit meaningfully under book to qualify — and no more than 90%
          under, the scam gate. <strong>Confidence</strong> is lectr&apos;s tier for the corpus row,
          high or medium; low never ships. <strong>Rank</strong> = depth × confidence-weight ×
          risk-weight × a small freshness boost for listings under 24h old, because fresh deals get
          sniped fast. And every surfaced deal is logged with its call frozen, then graded against
          what happened — see <a href="/tape/">the tape</a>.
        </p>

        <h2>Per-vertical metrics — never blended</h2>
        <p>
          If autographs surface 3 deals a week and cards surface 300, that gap is a visible roadmap
          item, not a hidden fact. Coverage and yield are tracked per vertical, from day one.
        </p>
      </div>

      <div className="stat-grid" style={{ marginTop: 20, marginBottom: 24 }}>
        {ALL_VERTICALS.map((v) => {
          const stat = board.perVertical[v];
          return (
            <div className="stat-tile" key={v}>
              <div className="stat-label">{verticalLabel(v)}</div>
              <div className="stat-num">{stat ? stat.surfaced : '—'}</div>
              <div className="stat-cap">
                {stat ? `surfaced · ${stat.matched} matched of ${stat.polled} polled` : 'awaiting first sweep'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="prose">
        {board.builtAt && (
          <p className="build-stamp">
            Figures from the board built {shortDate(board.builtAt)}, against the lectr corpus dated{' '}
            {shortDate(board.bookBuiltAt)}.
          </p>
        )}

        <h2>Powered by lectr</h2>
        <p>
          Starling holds no corpus of its own — it consumes lectr&apos;s public price products and
          deep-links every call back to the proof.{' '}
          <a href="https://lectr.bid" target="_blank" rel="noopener noreferrer">
            lectr.bid
          </a>{' '}
          is the sell-side truth engine: 1.1M lots, 761K settled prices, every call replayed against
          history. Starling is the buy-side lens.
        </p>
        <p style={{ color: 'var(--color-text-faint)', fontSize: '12.5px' }}>
          Affiliate disclosure: some links to eBay are affiliate links and Starling may earn a
          commission if you buy, at no additional cost to you. eBay is a trademark of eBay Inc.;
          Starling is an independent affiliate and is not endorsed by eBay.
        </p>
      </div>
    </>
  );
}
