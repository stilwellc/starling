/**
 * HuntModule — the hunt lane on the board (PROPOSAL §4.4).
 *
 * Two pieces, same certificate language as the rest of the board:
 *   - HuntModule: the pinned "The hunt" section at the top of the mixed board.
 *     Curated targets sit ABOVE book-driven discovery, so their hits render
 *     above the ranked grid — priced hits first (full DealCard with the
 *     "hunted" stamp), then the "hunted — no book value" facts cards.
 *   - HuntNoBookCard: a hit whose identity has no book row. FACTS ONLY — no
 *     median, no depth %, no risk grade, no rank. The card says exactly why,
 *     instead of dressing a guess up as a number.
 * board.hunt.deals arrives pre-ordered by publish.ts (priced rank-desc, then
 * noBook recency-desc) — render order IS board order, here and on /hunt.
 */
import Link from 'next/link';
import type { HuntDeal, HuntNoBookDeal, HuntSection } from '@/scripts/types';
import { huntLensLabel, money, relativeDate } from '@/app/lib/display';
import { DealCard } from './DealCard';
import { OutLink } from './OutLink';

export function HuntNoBookCard({ deal }: { deal: HuntNoBookDeal }) {
  return (
    <article className="card">
      <a
        className="card-media"
        href={deal.affiliateUrl || deal.webUrl}
        target="_blank"
        rel="sponsored noopener noreferrer"
        aria-label={deal.title}
      >
        {deal.imageUrl ? (
          // Static export → a plain img keeps it offline-safe; matches DealCard.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={deal.imageUrl} alt={deal.title} loading="lazy" />
        ) : (
          <div className="card-media-empty" aria-hidden="true">
            <span>no image</span>
          </div>
        )}
        <span className="card-vertical">{huntLensLabel(deal.vertical)}</span>
      </a>

      <div className="card-body">
        <span className="hunt-tag" title={`On the hunt list: ${deal.huntLabel}`}>
          hunted · {deal.huntLabel}
        </span>

        {/* No depth hero — there is no book row, so there is no honest depth. */}
        <div className="card-depth">
          <span className="nobook-hero">no book value</span>
        </div>

        <h2 className="card-title">
          <a href={deal.affiliateUrl || deal.webUrl} target="_blank" rel="sponsored noopener noreferrer">
            {deal.title}
          </a>
        </h2>

        <div className="card-price">
          <span className="card-price-allin">{money(deal.allIn)}</span>
          <span className="card-price-sub">
            all-in{deal.shipping != null && deal.shipping > 0 ? ` · incl. ${money(deal.shipping)} ship` : deal.shipping === 0 ? ' · free ship' : ''}
          </span>
        </div>

        {/* Listing facts, ledger-style — everything shown is a fact of the
            listing itself, never a valuation. */}
        <div className="evidence">
          <div className="evidence-head">
            <span className="evidence-brand">listing facts only</span>
          </div>
          <div className="ledger">
            <div className="ledger-row">
              <span className="ledger-k">Listed</span>
              <span className="ledger-lead" aria-hidden="true" />
              <span className="ledger-v">{relativeDate(deal.listedAt)}</span>
            </div>
            {deal.seller?.feedbackPercentage != null && (
              <div className="ledger-row">
                <span className="ledger-k">Seller</span>
                <span className="ledger-lead" aria-hidden="true" />
                <span className="ledger-v">
                  {deal.seller.feedbackPercentage}%
                  {deal.seller.feedbackScore != null ? (
                    <span className="ledger-sub" style={{ marginLeft: 8, marginRight: 0 }}>
                      {deal.seller.feedbackScore} ratings
                    </span>
                  ) : null}
                </span>
              </div>
            )}
          </div>
          <p className="nobook-note">
            A curated target hit with no corpus row behind it — lectr&apos;s book can&apos;t price
            this class yet, so Starling shows the listing&apos;s facts and manufactures nothing.
          </p>
        </div>

        <OutLink deal={deal} />
      </div>
    </article>
  );
}

/** One hunt hit, priced or not — shared by the board module and /hunt. */
export function HuntHitCard({ deal }: { deal: HuntDeal }) {
  return deal.noBook ? (
    <HuntNoBookCard deal={deal} />
  ) : (
    <DealCard deal={deal} huntLabel={deal.huntLabel} />
  );
}

/** The pinned module at the top of the mixed board. */
export function HuntModule({ hunt }: { hunt: HuntSection }) {
  if (hunt.targets.length === 0) return null;
  const hits = hunt.deals;
  return (
    <section className="hunt-module" aria-label="The hunt — curated targets">
      <div className="hunt-module-head">
        <div>
          <span className="kicker">The hunt · curated targets, polled every run</span>
          <p className="hunt-module-sub">
            {hits.length > 0 ? (
              <>
                <b>{hits.length}</b> live {hits.length === 1 ? 'hit' : 'hits'} across{' '}
                {hunt.targets.length} watched targets
              </>
            ) : (
              <>
                {hunt.targets.length} targets on watch — nothing live right now
              </>
            )}
          </p>
        </div>
        <Link href="/hunt/" className="hunt-module-link">
          All targets →
        </Link>
      </div>
      {hits.length > 0 && (
        <div className="grid">
          {hits.map((d) => (
            <HuntHitCard key={d.id} deal={d} />
          ))}
        </div>
      )}
    </section>
  );
}
