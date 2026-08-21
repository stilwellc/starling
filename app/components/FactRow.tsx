/**
 * FactRow — the noBook register: a hunt hit or wide-net lead with no corpus
 * row behind it. FACTS ONLY — listing price, listed date, seller history —
 * plus, when the pipeline carries one, a lectr context line for the nearby
 * class, clearly labeled "not a priced call". No depth, no rank, no grade:
 * the no-manufactured-numbers rule survives every lane.
 */
import type { LectrContext } from '@/app/lib/board-data';
import { money, relativeDate, huntLensLabel } from '@/app/lib/display';
import { ContextLine } from './ContextPanel';

export interface FactRowItem {
  id: string;
  title: string;
  imageUrl?: string;
  vertical?: string;
  allIn?: number;
  /** the listing is an auction — allIn is the CURRENT BID, not an ask */
  auction?: boolean;
  itemPrice?: number;
  shipping?: number | null;
  seller?: { username?: string; feedbackPercentage?: number; feedbackScore?: number };
  listedAt?: string;
  webUrl?: string;
  affiliateUrl?: string;
}

export function FactRow({
  item,
  context,
  showLens = false,
}: {
  item: FactRowItem;
  context?: LectrContext;
  showLens?: boolean;
}) {
  const href = item.affiliateUrl || item.webUrl;
  const linkProps = href
    ? { href, target: '_blank', rel: 'sponsored noopener noreferrer' as const }
    : undefined;

  return (
    <article className="fact-row">
      <div className="fact-row-line">
        {linkProps ? (
          <a {...linkProps} className="fact-row-thumb" aria-hidden="true" tabIndex={-1}>
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="deal-row-noimg" />
            )}
          </a>
        ) : (
          <span className="fact-row-thumb">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt="" loading="lazy" />
            ) : (
              <span className="deal-row-noimg" />
            )}
          </span>
        )}

        <div className="fact-row-main">
          <h4 className="fact-row-title">
            {linkProps ? <a {...linkProps}>{item.title}</a> : item.title}
          </h4>
          <div className="fact-row-meta">
            {showLens && item.vertical && (
              <span className="fact-row-lens">{huntLensLabel(item.vertical)}</span>
            )}
            {item.listedAt && <span>listed {relativeDate(item.listedAt)}</span>}
            {item.seller?.feedbackPercentage != null && (
              <span>
                seller {item.seller.feedbackPercentage}%
                {item.seller.feedbackScore != null ? ` · ${item.seller.feedbackScore} ratings` : ''}
              </span>
            )}
          </div>
        </div>

        <div className="fact-row-nums">
          {item.allIn != null && (
            <>
              <span className="fact-row-price">{money(item.allIn)}</span>
              <span className="fact-row-sub">
                {item.auction
                  ? 'current bid — auction'
                  : item.shipping != null && item.shipping > 0
                    ? `incl. ${money(item.shipping)} ship`
                    : item.shipping === 0
                      ? 'free ship'
                      : 'all-in'}
              </span>
            </>
          )}
        </div>

        {linkProps && (
          <a {...linkProps} className="fact-row-out" aria-label={`View ${item.title} on eBay`}>
            eBay ↗
          </a>
        )}
      </div>
      {context && <ContextLine context={context} />}
    </article>
  );
}
