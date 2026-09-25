/**
 * HuntCard — one retained eBay listing for one hunt. The exact eBay title,
 * verbatim, links to the exact eBay URL. Price position is the engine's
 * (capWording is printed verbatim — auctions say "under cap now", never a
 * promise about the hammer). All-in = item + shipping; tax excluded.
 */
import type { Card, CardGroup } from '@/scripts/hunt-engine/dashboard';

const CARD_TAG: Record<CardGroup, string> = {
  'new-under': 'new under',
  'changed-under': 'changed under',
  under: 'under cap',
  watch: 'watching',
  over: 'over cap',
};
import { EndsIn, Ago, HuntImage } from './Live';
import { flagText, isKnownCode, pct, reasonText, usd, utcStamp } from './format';

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: 'up' | 'down' | 'na' }) {
  return (
    <div className="hx-row">
      <dt>{k}</dt>
      <dd className={tone ? `hx-${tone}` : undefined}>{children}</dd>
    </div>
  );
}

function Verdict({ c }: { c: Card }) {
  if (c.underBy != null && c.underPct != null) {
    const under = c.underBy >= 0;
    return (
      <div className={`hx-verdict ${under ? 'hx-verdict-up' : 'hx-verdict-down'}`}>
        <span className="hx-verdict-num">{usd(Math.abs(c.underBy))}</span>
        <span className="hx-verdict-word">
          {under ? 'under' : 'over'} · {pct(c.underPct)} {under ? 'under' : 'over'} max
        </span>
      </div>
    );
  }
  return (
    <div className="hx-verdict hx-verdict-na">
      <span className="hx-verdict-num">{c.allIn == null ? 'all-in unknown' : 'no cap'}</span>
    </div>
  );
}

export function HuntCard({ c }: { c: Card }) {
  const auction = c.buyingMode === 'AUCTION';
  const tone = c.underBy == null ? undefined : c.underBy >= 0 ? 'up' : 'down';
  const s = c.seller;
  return (
    <article className={`hx-card hx-card-${c.group}`} data-classification={c.classification}>
      <a className="hx-media" href={c.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <HuntImage src={c.imageUrl} alt={c.title} />
        <span className={`hx-mode ${auction ? 'hx-mode-auction' : ''}`}>{auction ? 'Auction' : 'Fixed price'}</span>
      </a>

      <div className="hx-body">
        <div className="hx-card-top">
          <span className="hx-hunt">{c.huntLabel}</span>
          <span className={`hx-group hx-group-${c.group}`}>{CARD_TAG[c.group]}</span>
        </div>

        <h3 className="hx-title">
          <a href={c.url} target="_blank" rel="noopener noreferrer">
            {c.title}
          </a>
        </h3>

        <Verdict c={c} />
        <p className="hx-capword">
          <span className={`hx-capword-chip ${tone ? `hx-${tone}` : ''}`}>{c.capWording}</span>
          <span className="hx-tax">tax excluded</span>
        </p>

        {auction && (
          <p className="hx-auction">
            <span>{c.endsAt ? <EndsIn endsAt={c.endsAt} /> : 'end time not listed'}</span>
            {c.endsAt && <span className="hx-dim">{utcStamp(c.endsAt)}</span>}
            <span>
              {c.bidCount == null ? 'bids not listed' : `${c.bidCount} ${c.bidCount === 1 ? 'bid' : 'bids'}`}
            </span>
          </p>
        )}

        <dl className="hx-ledger">
          <Row k="Item price">
            {auction && <span className="hx-dim">current bid </span>}
            {usd(c.price)}
          </Row>
          <Row k="Shipping" tone={c.shipping == null ? 'na' : undefined}>
            {c.shipping == null ? 'not listed' : c.shipping === 0 ? 'free ($0)' : usd(c.shipping)}
          </Row>
          <Row k="All-in" tone={c.allIn == null ? 'na' : tone}>
            {c.allIn == null ? 'unknown' : usd(c.allIn)}
          </Row>
          <Row k="Max all-in" tone={c.maxAllIn == null ? 'na' : undefined}>
            {c.maxAllIn == null ? 'no cap — watching' : usd(c.maxAllIn)}
          </Row>
        </dl>

        <dl className="hx-ledger hx-ledger-quiet">
          <Row k="Seller" tone={s?.username ? undefined : 'na'}>
            {s?.username ? (
              <>
                {s.username}
                <span className="hx-dim">
                  {' '}
                  {s.feedbackPercentage != null ? `${s.feedbackPercentage}%` : '—%'} ·{' '}
                  {s.feedbackScore != null ? s.feedbackScore.toLocaleString('en-US') : '—'}
                </span>
              </>
            ) : (
              'not listed'
            )}
          </Row>
          <Row k="Condition" tone={c.condition ? undefined : 'na'}>
            {c.condition ?? 'not listed'}
          </Row>
          <Row k="Location" tone={c.location ? undefined : 'na'}>
            {c.location ?? 'not listed'}
          </Row>
          <Row k="First seen">
            {utcStamp(c.firstSeenAt)} <Ago iso={c.firstSeenAt} />
          </Row>
          <Row k="Last seen">
            {utcStamp(c.lastSeenAt)} <Ago iso={c.lastSeenAt} />
          </Row>
        </dl>

        {(c.reasons.length > 0 || c.flags.length > 0) && (
          <ul className="hx-chips" aria-label="Match reasons and risk flags">
            {c.reasons.map((r) => (
              <li key={`r-${r}`} className={`hx-chip ${isKnownCode(r) ? '' : 'hx-chip-raw'}`} title={r}>
                {reasonText(r)}
              </li>
            ))}
            {c.flags.map((f) => (
              <li key={`f-${f}`} className={`hx-chip hx-chip-flag ${isKnownCode(f) ? '' : 'hx-chip-raw'}`} title={f}>
                {flagText(f)}
              </li>
            ))}
          </ul>
        )}

        <div className="hx-card-foot">
          <span>
            confidence <b>{Math.round(c.confidence * 100)}%</b>
          </span>
          {c.review === 'review' ? (
            <span className="hx-badge hx-badge-down">needs review</span>
          ) : (
            <span className="hx-badge">reviewed ok</span>
          )}
          {c.carried && (
            <span className="hx-badge hx-badge-warn" title="This hunt's latest search did not complete; this listing is from an earlier successful run.">
              carried from an earlier run
            </span>
          )}
        </div>
        {c.alertKey && (
          <p className="hx-alert">
            <span className="hx-badge hx-badge-accent">alert pending</span>
            <code>{c.alertKey}</code>
          </p>
        )}
      </div>
    </article>
  );
}
