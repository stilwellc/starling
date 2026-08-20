'use client';

/**
 * ClosingSection — "Closing soon" (board.json v2 `closing[]`, optional).
 *
 * Live AUCTIONS ending within hours whose bidding sits ≥40% under the book —
 * WATCH SIGNALS, never price calls: a current bid is a moment, not a
 * settlement, and it moves (the section head and every row say so). Compact
 * urgent rows: thumb · title · current bid on the band · % under · bid count ·
 * countdown · out-link.
 *
 * The countdown runs off the CLIENT clock (a board built 2h ago must still
 * count true), hydration-safe: the server (and the client's first paint)
 * render a static "ends soon"; a mounted effect starts the real ticker. Rows
 * whose auction has hammered since build render "ended" and dim — never
 * silently vanish client-side.
 */
import { useEffect, useState } from 'react';
import type { AuctionCall } from '@/scripts/types';
import { verticalLabel, money, depthPct } from '@/app/lib/display';
import { DepthBar } from './DepthBar';

/** "ends in 1h 42m" / "ends in 12m" / "ended" — from endsAt vs the client now.
 *  Null now (pre-mount) → the static placeholder both sides agree on. */
function countdown(endsAt: string, nowMs: number | null): string {
  if (nowMs == null) return 'ends soon';
  const diff = Date.parse(endsAt) - nowMs;
  if (!Number.isFinite(diff)) return 'ends soon';
  if (diff <= 0) return 'ended';
  const mins = Math.floor(diff / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `ends in ${h}h ${m}m` : `ends in ${Math.max(m, 1)}m`;
}

function ClosingRow({ call, nowMs }: { call: AuctionCall; nowMs: number | null }) {
  const href = call.affiliateUrl || call.webUrl;
  const linkProps = href
    ? { href, target: '_blank', rel: 'sponsored noopener noreferrer' as const }
    : undefined;
  const remaining = countdown(call.endsAt, nowMs);
  const ended = remaining === 'ended';

  return (
    <article className={`closing-row${ended ? ' closing-row-ended' : ''}`}>
      <span className="closing-thumb" aria-hidden="true">
        {call.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={call.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="deal-row-noimg" />
        )}
      </span>

      <div className="closing-main">
        <h4 className="closing-title">
          {linkProps ? <a {...linkProps}>{call.title}</a> : call.title}
        </h4>
        <div className="closing-meta">
          <span className="closing-lens">{verticalLabel(call.vertical)}</span>
          <span>
            bid {money(call.currentBid)}
            {call.shipping != null && call.shipping > 0 ? ` + ${money(call.shipping)} ship` : ''}
          </span>
          {typeof call.bidCount === 'number' && (
            <span>
              {call.bidCount} {call.bidCount === 1 ? 'bid' : 'bids'}
            </span>
          )}
          <span>book {money(call.med)}</span>
        </div>
        <DepthBar
          allIn={call.allInBid}
          lo={call.lo}
          med={call.med}
          hi={call.hi}
          depth={call.bidVsBook}
          size="mini"
        />
      </div>

      <div className="closing-nums">
        <span className="closing-depth">{depthPct(call.bidVsBook)}</span>
        <span className="closing-under">under · bids move</span>
        <span
          className={`closing-countdown${ended ? ' is-ended' : ''}`}
          title={`Auction ends ${new Date(call.endsAt).toLocaleString()}`}
        >
          {remaining}
        </span>
      </div>

      {linkProps && (
        <a {...linkProps} className="closing-out" aria-label={`View ${call.title} on eBay`}>
          View on eBay ↗
        </a>
      )}
    </article>
  );
}

export function ClosingSection({ calls }: { calls: AuctionCall[] }) {
  // Client clock, mounted-only: null on the server AND on hydration's first
  // client render (so the trees match), then real and ticking every 30s.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const rows = calls.filter((c) => c && typeof c.endsAt === 'string');
  if (rows.length === 0) return null;

  return (
    <section className="closing" aria-label="Closing soon — live auctions under the book">
      <div className="rule-head">
        <span className="kicker">Closing soon · live auctions under the book</span>
        <span className="rule-head-count">{rows.length} ending</span>
      </div>
      <p className="closing-sub">
        Auctions ending within hours whose <b>current bidding</b> sits 40%+ under lectr&apos;s book —
        a <b>watch signal, not a price call</b>: bids move until the hammer. Depth shown is the bid
        we saw at build time.
      </p>
      <div className="closing-rows">
        {rows.map((c) => (
          <ClosingRow key={c.id} call={c} nowMs={nowMs} />
        ))}
      </div>
    </section>
  );
}
