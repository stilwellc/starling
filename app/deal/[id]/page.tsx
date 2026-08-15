import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadBoard, loadReceipts } from '@/scripts/lib/load-board';
import { EvidencePanel } from '@/app/components/EvidencePanel';
import { RiskChip } from '@/app/components/RiskChip';
import { DepthBar } from '@/app/components/DepthBar';
import { OutLink } from '@/app/components/OutLink';
import {
  verticalLabel,
  money,
  depthPct,
  outcomeLabel,
  shortDate,
} from '@/app/lib/display';

export const dynamic = 'force-static';

// Prebuild one permalink per live deal. Empty board (before the first pipeline
// run) → zero params, and the build still passes.
export function generateStaticParams() {
  const board = loadBoard();
  return board.deals.map((d) => ({ id: d.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const deal = loadBoard().deals.find((d) => d.id === params.id);
  if (!deal) return { title: 'Deal — Starling' };
  return {
    title: `${deal.title} — ${depthPct(deal.depth)} under book · Starling`,
    description: `${money(deal.allIn)} all-in against a lectr book median of ${money(deal.med)} (${deal.n} settled sales). Risk grade ${deal.risk.grade}.`,
  };
}

export default function DealPage({ params }: { params: { id: string } }) {
  const board = loadBoard();
  const deal = board.deals.find((d) => d.id === params.id);
  if (!deal) notFound();

  // The receipt is Starling's frozen record of the call — shown once resolved.
  const receipt = loadReceipts().find((r) => r.id === deal.id || r.itemId === deal.itemId);

  return (
    <>
      <Link href="/" className="backlink">
        ← Back to the board
      </Link>

      <div className="deal">
        <div className="deal-media">
          {deal.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={deal.imageUrl} alt={deal.title} />
          ) : (
            <div className="deal-media-empty">no image available</div>
          )}
        </div>

        <div className="deal-main">
          <div>
            <span className="deal-vertical">
              <Link href={`/v/${deal.vertical}/`}>{verticalLabel(deal.vertical)}</Link>
            </span>
            <h1>{deal.title}</h1>
          </div>

          <div className="deal-hero">
            <span className="h-depth">{depthPct(deal.depth)}</span>
            <div className="h-meta">
              <span className="h-price">{money(deal.allIn)} all-in</span>
              <span className="h-sub">
                under the book median of {money(deal.med)}
                {deal.shipping != null
                  ? deal.shipping > 0
                    ? ` · item ${money(deal.itemPrice)} + ${money(deal.shipping)} ship`
                    : ' · free shipping'
                  : ''}
              </span>
            </div>
          </div>

          <div className="deal-section">
            <h3>Where the ask sits against the corpus band</h3>
            <DepthBar
              allIn={deal.allIn}
              lo={deal.lo}
              med={deal.med}
              hi={deal.hi}
              depth={deal.depth}
            />
          </div>

          <div className="deal-section">
            <h3>The evidence</h3>
            <EvidencePanel deal={deal} expanded />
          </div>

          <div className="deal-section">
            <h3>Risk breakdown — every signal, shown</h3>
            <RiskChip risk={deal.risk} showReasons />
          </div>

          {receipt && (
            <div className="deal-section">
              <h3>Receipt</h3>
              <div className="receipt-status">
                <span className={`outcome outcome-${receipt.outcome}`}>
                  {outcomeLabel(receipt.outcome)}
                </span>
                <span>
                  {receipt.outcome === 'sold' && receipt.finalPrice != null
                    ? `Sold for ${money(receipt.finalPrice)} — surfaced ${shortDate(receipt.surfacedAt)} at ${depthPct(receipt.depthAtSurface)} under book.`
                    : receipt.outcome === 'live'
                      ? `Still live — first surfaced ${shortDate(receipt.surfacedAt)}.`
                      : `${outcomeLabel(receipt.outcome)}${receipt.resolvedAt ? ` ${shortDate(receipt.resolvedAt)}` : ''} — surfaced ${shortDate(receipt.surfacedAt)}.`}
                </span>
              </div>
            </div>
          )}

          <div className="deal-section">
            <OutLink deal={deal} size="lg" />
          </div>
        </div>
      </div>
    </>
  );
}
