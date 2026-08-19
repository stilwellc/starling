/**
 * OutLink — the eBay Buy It Now button, with its affiliate disclosure placed
 * IMMEDIATELY adjacent (PROPOSAL §4.1 / §5.6.3: EPN requires the disclosure be
 * "unavoidable" and next to the out-link, not buried in a footer/Terms page).
 *
 * When the affiliate URL is present the link is monetised and the disclosure
 * says so; when only the plain webUrl exists we still label it as an eBay
 * out-link and never imply a commission.
 */
import type { Deal } from '@/scripts/types';

// Accepts anything carrying the two link fields (Deal, HuntNoBookDeal) — the
// button only ever reads the URLs.
export function OutLink({
  deal,
  size = 'md',
}: {
  deal: Pick<Deal, 'affiliateUrl' | 'webUrl'>;
  size?: 'md' | 'lg';
}) {
  const href = deal.affiliateUrl || deal.webUrl;
  const isAffiliate = Boolean(deal.affiliateUrl);
  if (!href) {
    return <span className="outlink-missing">Listing link unavailable</span>;
  }
  return (
    <div className={`outlink outlink-${size}`}>
      <a className="outlink-btn" href={href} target="_blank" rel="sponsored noopener noreferrer">
        View on eBay
        <span className="outlink-arrow" aria-hidden="true">↗</span>
      </a>
      <p className="outlink-disclosure">
        {isAffiliate
          ? 'Affiliate link — Starling may earn a commission if you buy, at no cost to you.'
          : 'Out-link to eBay — Starling is not affiliated with this listing.'}
      </p>
    </div>
  );
}
