import type { Metadata } from 'next';
import { loadBoard } from '@/scripts/lib/load-board';
import { ALL_VERTICALS, verticalLabel, shortDate } from '@/app/lib/display';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'About — how Starling works · powered by lectr',
  description:
    "Starling's thesis, methodology, and honesty rules: a buy-side arbitrage lens on eBay Buy It Now, powered by lectr's certified price corpus. Per-vertical metrics, never blended.",
};

export default function AboutPage() {
  const board = loadBoard();
  // Show the verticals that have any activity, in board order.
  const rows = ALL_VERTICALS.map((v) => ({ v, stat: board.perVertical[v] })).filter(
    (r) => r.stat,
  );

  return (
    <div className="prose">
      <div className="page-head">
        <h1>How Starling works</h1>
        <p className="lede">
          Starling is the buy-side face of lectr. lectr spent a year building the sell-side truth —
          a 1.1M+ sold-lot corpus with exact-identity keys and conformal price bands. Starling
          points that knowledge at eBay Buy It Now and surfaces the listings priced deep below it.
        </p>
      </div>

      <h2>The thesis</h2>
      <p>
        eBay Buy It Now is the largest fixed-price collectibles surface on earth, and it is priced
        by humans without lectr&apos;s knowledge. Sellers misprice constantly — wrong comps, stale
        comps, no comps. For every listing whose identity we can pin to an exact corpus key, we look
        up what that exact thing actually trades for, and surface the ones listed deep below it. The
        moat isn&apos;t the eBay integration — anyone can call the Browse API. The moat is the value
        behind every depth call: <strong>761K+ settled prices, conformal bands, and a published
        backtest record.</strong>
      </p>

      <h2>The honesty rules</h2>
      <div className="rule-card">
        <p>
          <b>Starling manufactures no numbers.</b> A deal exists only when an eBay listing&apos;s
          identity pins to an <em>exact</em> corpus key. If the identity is unclear, the matcher
          abstains — it never fuzzy-matches. Every number on a card is a corpus fact, one tap from
          the comps on lectr.
        </p>
      </div>
      <div className="rule-card">
        <p>
          <b>The risk grade is never a black box.</b> Every A/B/C/D grade lists its reasons on the
          card — authenticity anchor, seller signals, listing quality, per-vertical fake-rate prior.
          Nothing is silently hidden; a D-grade deal is shown at the bottom with its reasons, not
          removed.
        </p>
      </div>
      <div className="rule-card">
        <p>
          <b>One hard suppression, stated.</b> A listing more than 90% under book reads as
          fake/broken and is suppressed with the rule named — the only hard gate in the system.
          Everything else is ranked, never gated.
        </p>
      </div>
      <div className="rule-card">
        <p>
          <b>Cards get no special prominence.</b> Cards are first-class and fully polled, but the
          board defaults to the mixed view and ranking has no cards penalty <em>and</em> no cards
          bonus. Rank is <code>depth × confidence × risk</code> — a great watch deal and a great
          card deal compete on equal footing.
        </p>
      </div>

      <h2>The method</h2>
      <ul>
        <li>
          <strong>Depth</strong> = 1 − allIn / book median, where all-in includes the cheapest
          shipping option. A deal must sit between 25% and 90% under book to qualify.
        </li>
        <li>
          <strong>Confidence</strong> is lectr&apos;s tier for the corpus row — high or medium; low
          never ships. It weights the rank and is shown on every card.
        </li>
        <li>
          <strong>Rank</strong> = depth × confidence-weight × risk-weight × a small freshness boost
          for listings under 24h old (they get sniped fast, so we surface them first).
        </li>
        <li>
          <strong>Receipts.</strong> Every surfaced deal is logged with its call frozen, then graded
          against what happened — see <a href="/tape/">the tape</a>. Did the market agree the deal
          was real?
        </li>
      </ul>

      <h2>Per-vertical metrics — never blended</h2>
      <p>
        If watches surface 3 deals a week and cards surface 300, that gap is a visible roadmap item,
        not a hidden fact. Coverage and yield are tracked per vertical, from day one.
      </p>
      {rows.length > 0 ? (
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Vertical</th>
              <th>Polled</th>
              <th>Matched</th>
              <th>Surfaced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, stat }) => (
              <tr key={v}>
                <td>{verticalLabel(v)}</td>
                <td>{stat!.polled}</td>
                <td>{stat!.matched}</td>
                <td>{stat!.surfaced}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: 'var(--text-faint)' }}>
          Per-vertical metrics will render here once the pipeline has run its first sweep.
        </p>
      )}
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
      <p style={{ color: 'var(--text-faint)', fontSize: '12.5px' }}>
        Affiliate disclosure: some links to eBay are affiliate links and Starling may earn a
        commission if you buy, at no additional cost to you. eBay is a trademark of eBay Inc.;
        Starling is an independent affiliate and is not endorsed by eBay.
      </p>
    </div>
  );
}
