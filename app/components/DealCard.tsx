/**
 * DealCard — one surfaced deal on the mixed board.
 *
 * Layout priority follows the mandate: DEPTH and CONFIDENCE are the hero numbers
 * (PROPOSAL design rules); the vertical is a quiet chip, never a spotlight, so
 * the mixed view does not visually privilege cards (§2). Every card carries its
 * evidence, its risk grade WITH reasons, and an eBay out-link whose affiliate
 * disclosure sits right beside it.
 */
import Link from 'next/link';
import type { Deal } from '@/scripts/types';
import { verticalLabel, money, depthPct } from '@/app/lib/display';
import { DepthBar } from './DepthBar';
import { EvidencePanel } from './EvidencePanel';
import { RiskChip } from './RiskChip';
import { OutLink } from './OutLink';

export function DealCard({ deal }: { deal: Deal }) {
  return (
    <article className="card">
      <Link href={`/deal/${deal.id}/`} className="card-media" aria-label={deal.title}>
        {deal.imageUrl ? (
          // Static export → next/image unoptimized; a plain img keeps it simple
          // and offline-safe. eslint-disable to allow the raw tag by intent.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={deal.imageUrl} alt={deal.title} loading="lazy" />
        ) : (
          <div className="card-media-empty" aria-hidden="true">
            <span>no image</span>
          </div>
        )}
        <span className="card-vertical">{verticalLabel(deal.vertical)}</span>
      </Link>

      <div className="card-body">
        <div className="card-depth">
          <span className="card-depth-num">{depthPct(deal.depth)}</span>
          <span className="card-depth-word">under the book</span>
        </div>

        <h2 className="card-title">
          <Link href={`/deal/${deal.id}/`}>{deal.title}</Link>
        </h2>

        <div className="card-price">
          <span className="card-price-allin">{money(deal.allIn)}</span>
          <span className="card-price-sub">
            all-in{deal.shipping != null && deal.shipping > 0 ? ` · incl. ${money(deal.shipping)} ship` : deal.shipping === 0 ? ' · free ship' : ''}
          </span>
        </div>

        <DepthBar allIn={deal.allIn} lo={deal.lo} med={deal.med} hi={deal.hi} depth={deal.depth} />

        <EvidencePanel deal={deal} />

        <RiskChip risk={deal.risk} showReasons />

        <OutLink deal={deal} />
      </div>
    </article>
  );
}
