import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { Board, Deal, HuntPricedDeal } from '@/scripts/types';
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

// Static export: the board is read once at build time and baked into HTML.
export const dynamic = 'force-static';

// Priced hunt hits are full deals living in the board's hunt section (§4.4) —
// they earn the same permalink. noBook hits carry no evidence to certify, so
// they get no /deal page (the hunt card out-links straight to eBay).
function allPermalinkDeals(board: Board): Deal[] {
  const pricedHunt = (board.hunt?.deals ?? []).filter(
    (d): d is HuntPricedDeal => !d.noBook,
  );
  return [...board.deals, ...pricedHunt];
}

// Prebuild one permalink per live deal. Empty board (before the first pipeline
// run) → zero params, and the build still passes.
export function generateStaticParams() {
  const board = loadBoard();
  return allPermalinkDeals(board).map((d) => ({ id: d.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const deal = allPermalinkDeals(loadBoard()).find((d) => d.id === params.id);
  if (!deal) return { title: 'Deal — Starling' };
  const description = `${money(deal.allIn)} all-in against a lectr book median of ${money(deal.med)} (${deal.n} settled sales). Risk grade ${deal.risk.grade}.`;
  return {
    title: `${deal.title} — ${depthPct(deal.depth)} under book · Starling`,
    description,
    openGraph: {
      title: `${deal.title} — ${depthPct(deal.depth)} under the book`,
      description,
      type: 'website',
      ...(deal.imageUrl ? { images: [{ url: deal.imageUrl }] } : {}),
    },
  };
}

export default function DealPage({ params }: { params: { id: string } }) {
  const board = loadBoard();
  const deal = allPermalinkDeals(board).find((d) => d.id === params.id);
  if (!deal) notFound();

  // Present only when this deal arrived via the hunt lane (§4.4).
  const huntLabel = (deal as Partial<HuntPricedDeal>).huntLabel;

  // The receipt is Starling's frozen record of the call — shown once it exists.
  const receipt = loadReceipts().find((r) => r.id === deal.id || r.itemId === deal.itemId);

  return (
    <>
      <Link href="/" className="back-link">
        ← Board
      </Link>

      <div className="deal-detail">
        {/* Left — the image well, same treatment as the board card. */}
        <div className="card-media" data-deep={deal.depth >= 0.4}>
          {deal.imageUrl ? (
            // Static export → a plain img keeps it offline-safe; matches DealCard.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={deal.imageUrl} alt={deal.title} />
          ) : (
            <div className="card-media-empty" aria-hidden="true">
              <span>no image</span>
            </div>
          )}
          <Link href={`/v/${deal.vertical}/`} className="card-vertical">
            {verticalLabel(deal.vertical)}
          </Link>
        </div>

        {/* Right — the full certificate. */}
        <div className="card-body">
          {huntLabel && (
            <span className="hunt-tag" title={`On the hunt list: ${huntLabel}`}>
              hunted · {huntLabel}
            </span>
          )}
          <div className="card-depth">
            <span className="card-depth-num">{depthPct(deal.depth)}</span>
            <span className="card-depth-word">under the book</span>
          </div>

          <h1 className="card-title" style={{ fontSize: 'clamp(24px, 3vw, 34px)' }}>
            {deal.title}
          </h1>

          <div className="card-price">
            <span className="card-price-allin">{money(deal.allIn)}</span>
            <span className="card-price-sub">
              all-in
              {deal.shipping != null
                ? deal.shipping > 0
                  ? ` · item ${money(deal.itemPrice)} + ${money(deal.shipping)} ship`
                  : ' · free shipping'
                : ''}
            </span>
          </div>

          <DepthBar allIn={deal.allIn} lo={deal.lo} med={deal.med} hi={deal.hi} depth={deal.depth} />

          <EvidencePanel deal={deal} expanded />

          <RiskChip risk={deal.risk} showReasons />

          {receipt && (
            <div className="ledger" style={{ marginBottom: 14 }}>
              <div className="ledger-row">
                <span className="ledger-k">Receipt</span>
                <span className="ledger-lead" aria-hidden="true" />
                <span className="ledger-v">
                  <span className={`outcome outcome-${receipt.outcome}`}>
                    {outcomeLabel(receipt.outcome)}
                  </span>
                </span>
              </div>
              <div className="ledger-row">
                <span className="ledger-k">
                  {receipt.outcome === 'sold' && receipt.finalPrice != null
                    ? 'Sold for'
                    : receipt.outcome === 'live'
                      ? 'Surfaced'
                      : `${outcomeLabel(receipt.outcome)}${receipt.resolvedAt ? ` ${shortDate(receipt.resolvedAt)}` : ''}`}
                </span>
                <span className="ledger-lead" aria-hidden="true" />
                <span className="ledger-v">
                  {receipt.outcome === 'sold' && receipt.finalPrice != null
                    ? `${money(receipt.finalPrice)} · surfaced ${shortDate(receipt.surfacedAt)}`
                    : `${shortDate(receipt.surfacedAt)} · ${depthPct(receipt.depthAtSurface)} under book`}
                </span>
              </div>
            </div>
          )}

          <OutLink deal={deal} size="lg" />
        </div>
      </div>
    </>
  );
}
