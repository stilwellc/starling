'use client';

/**
 * ClosingSection — "Closing soon" (board.json v2 `closing[]`, optional).
 *
 * Live AUCTIONS ending within hours whose bidding sits ≥40% under the book —
 * WATCH SIGNALS, never price calls: a current bid is a moment, not a
 * settlement, and it moves (the section head and every row say so). This lane
 * LEADS the page (the value audit's verdict: the closing calls are where the
 * edge actually showed up), so the soonest hammer renders at HERO weight and
 * the rest as compact urgent rows: thumb · title · current bid on the band ·
 * % under vs current bid · bid count · countdown · out-link. Zero or one bids
 * gets a "no action yet" chip — thin action is part of the signal, said aloud.
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

/** Bid count, said plainly. 0 or 1 bids is a real state worth a chip — an
 *  auction nobody has moved on yet — never hidden behind an absent field.
 *  Unknown count renders nothing: we don't claim "no action" without data. */
function BidCount({ call, chip = false }: { call: AuctionCall; chip?: boolean }) {
  if (typeof call.bidCount !== 'number') return null;
  const quiet = call.bidCount <= 1;
  return (
    <>
      <span className={`closing-bidcount${chip ? ' closing-bidcount-chip' : ''}`}>
        {call.bidCount} {call.bidCount === 1 ? 'bid' : 'bids'}
      </span>
      {quiet && (
        <span
          className="closing-noaction"
          title="Zero or one bids so far — nobody has moved on this yet; the current bid is barely a signal"
        >
          no action yet
        </span>
      )}
    </>
  );
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
          {call.isNew && <span className="new-flag" title="First surfaced in the last 24 hours">new</span>}
          <span>
            bid {money(call.currentBid)}
            {call.shipping != null && call.shipping > 0 ? ` + ${money(call.shipping)} ship` : ''}
          </span>
          <BidCount call={call} />
          <span>book {money(call.med)}</span>
          <span className="closing-caveat">bid will move — watch signal, not a price</span>
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
        <span className="closing-depth">{money(call.med - call.allInBid)}</span>
        <span className="closing-under">under · {depthPct(call.bidVsBook)} vs current bid</span>
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

/** The soonest hammer at HERO weight — the lane leads the page, so its top
 *  call gets the top-of-board treatment: big depth number labeled against the
 *  CURRENT bid, the countdown lit, bid count front and center. Same honesty
 *  grammar as the rows, at full volume. */
function ClosingHero({ call, nowMs }: { call: AuctionCall; nowMs: number | null }) {
  const href = call.affiliateUrl || call.webUrl;
  const linkProps = href
    ? { href, target: '_blank', rel: 'sponsored noopener noreferrer' as const }
    : undefined;
  const remaining = countdown(call.endsAt, nowMs);
  const ended = remaining === 'ended';

  return (
    <article className={`closing-hero${ended ? ' closing-row-ended' : ''}`}>
      <span className="closing-hero-media" aria-hidden="true">
        {call.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={call.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="deal-row-noimg" />
        )}
        <span className="card-vertical">{verticalLabel(call.vertical)}</span>
      </span>

      <div className="closing-hero-body">
        <div className="closing-hero-eyebrow">
          <span className="kicker kicker-lit">Next hammer</span>
          {call.isNew && <span className="new-flag" title="First surfaced in the last 24 hours">new</span>}
          <span
            className={`closing-countdown closing-hero-countdown${ended ? ' is-ended' : ''}`}
            title={`Auction ends ${new Date(call.endsAt).toLocaleString()}`}
          >
            {remaining}
          </span>
        </div>

        <div className="card-depth">
          <span className="card-depth-num">{money(call.med - call.allInBid)}</span>
          <span className="card-depth-word">
            under · {depthPct(call.bidVsBook)} vs current bid
            <span className="card-depth-vs">
              bidding sits at {money(call.allInBid)} all-in against a {money(call.med)} median —
              bid will move; watch signal, not a price
            </span>
          </span>
        </div>

        <h3 className="closing-hero-title">
          {linkProps ? <a {...linkProps}>{call.title}</a> : call.title}
        </h3>

        <div className="closing-meta closing-hero-meta">
          <span>
            bid {money(call.currentBid)}
            {call.shipping != null && call.shipping > 0 ? ` + ${money(call.shipping)} ship` : ''}
          </span>
          <BidCount call={call} chip />
          <span>
            book {money(call.med)} · {call.n} {call.n === 1 ? 'sale' : 'sales'}
          </span>
        </div>

        <DepthBar
          allIn={call.allInBid}
          lo={call.lo}
          med={call.med}
          hi={call.hi}
          depth={call.bidVsBook}
          size="hero"
        />

        {linkProps && (
          <a {...linkProps} className="closing-out closing-hero-out">
            Watch it on eBay ↗
          </a>
        )}
      </div>
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

  // soonest hammer leads at hero weight; the rest stay compact rows
  const [lead, ...rest] = rows;

  return (
    <section className="closing" aria-label="Closing soon — live auctions under the book">
      <div className="rule-head">
        <span className="kicker kicker-lit">Closing soon · live auctions under the book</span>
        <span className="rule-head-count">{rows.length} ending</span>
      </div>
      <p className="closing-sub">
        Auctions ending within hours whose <b>current bidding</b> sits 40%+ under lectr&apos;s book —
        every depth here is measured <b>against the current bid</b>, and a bid is a moment, not a
        settlement: <b>watch signals, never price calls</b>. Bids move until the hammer.
      </p>
      <ClosingHero call={lead} nowMs={nowMs} />
      {rest.length > 0 && (
        <div className="closing-rows">
          {rest.map((c) => (
            <ClosingRow key={c.id} call={c} nowMs={nowMs} />
          ))}
        </div>
      )}
    </section>
  );
}
