/**
 * HuntCard — one retained eBay listing for one hunt. The exact eBay title,
 * verbatim, links to the exact eBay URL. Price position is the engine's
 * (capWording is printed verbatim — auctions say "under cap now", never a
 * promise about the hammer). All-in = item + shipping; tax excluded.
 */
import type { Card, CardGroup } from '@/scripts/hunt-engine/dashboard';

/** The v2 engine fields (docs: hunt engine v2 contract). Optional here so the
 *  card compiles and renders against both old and new payloads. */
type CardV2 = Card & {
  details?: { aspects: Record<string, string>; descriptionSnippet: string | null; fetchedAt: string } | null;
  priceHistory?: Array<{ at: string; price: number; allIn: number | null }>;
  priceChange?: { from: number; to: number; since: string } | null;
  relisted?: { firstSeenAt: string; previousItemIds: string[] } | null;
  photoReused?: { count: number; otherListingIds: string[] } | null;
  dismissible?: boolean;
};

const CARD_TAG: Record<CardGroup, string> = {
  'new-under': 'new under',
  'changed-under': 'changed under',
  under: 'under cap',
  watch: 'watching',
  over: 'over cap',
};
import { EndsIn, Ago, HuntImage } from './Live';
import { Feedback } from './Feedback';
import { flagText, isKnownCode, pct, reasonText, usd, utcDay, utcStamp } from './format';

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: 'up' | 'down' | 'na' }) {
  return (
    <div className="hx-row">
      <dt>{k}</dt>
      <dd className={tone ? `hx-${tone}` : undefined}>{children}</dd>
    </div>
  );
}

/** Price first (what you'd pay, all-in), THEN how it sits against the budget. */
function Verdict({ c }: { c: CardV2 }) {
  const auction = c.buyingMode === 'AUCTION';
  const price = c.allIn ?? c.price;
  const priceLabel = c.allIn != null
    ? `${auction ? 'current bid ' : ''}all-in · price + shipping`
    : `${auction ? 'current bid' : 'item price'} · shipping not listed`;
  let delta: { text: string; cls: string };
  if (c.maxAllIn == null) delta = { text: 'no cap — watching', cls: 'hx-verdict-na' };
  else if (c.underBy == null || c.underPct == null) delta = { text: `max ${usd(c.maxAllIn)} · all-in unknown`, cls: 'hx-verdict-na' };
  else if (c.underBy >= 0) delta = { text: `${usd(c.underBy)} under your ${usd(c.maxAllIn)} max (${pct(c.underPct)})`, cls: 'hx-verdict-up' };
  else delta = { text: `${usd(-c.underBy)} over your ${usd(c.maxAllIn)} max (${pct(-c.underPct)})`, cls: 'hx-verdict-down' };
  return (
    <div className="hx-verdict">
      <div className="hx-verdict-price">
        <span className="hx-verdict-num">{usd(price)}</span>
        <span className="hx-verdict-word">{priceLabel}</span>
      </div>
      <PriceMove c={c} />
      <div className={`hx-verdict-delta ${delta.cls}`}>{delta.text}</div>
    </div>
  );
}

/** "was $X · since Sep 20" + an inline sparkline of the recorded price points. */
function PriceMove({ c }: { c: CardV2 }) {
  const ch = c.priceChange;
  const pts = (c.priceHistory ?? [])
    .map((p) => ({ at: p.at, v: p.allIn ?? p.price }))
    .filter((p) => Number.isFinite(p.v));
  const spark = pts.length >= 2;
  if (!ch && !spark) return null;
  const year = new Date(c.lastSeenAt).getUTCFullYear();
  const dropped = ch ? ch.to < ch.from : false;
  return (
    <div className="hx-pmove">
      {ch && (
        <span className={dropped ? 'hx-up' : 'hx-down'} title={`${usd(ch.from)} → ${usd(ch.to)} since ${utcStamp(ch.since)}`}>
          <span aria-hidden="true">{dropped ? '▼' : '▲'} </span>
          was <s>{usd(ch.from)}</s> · since {utcDay(ch.since, year)}
        </span>
      )}
      {spark && <Sparkline pts={pts} year={year} />}
    </div>
  );
}

function Sparkline({ pts, year }: { pts: Array<{ at: string; v: number }>; year: number }) {
  const W = 80;
  const H = 20;
  const pad = 2.5;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : pad + ((hi - v) * (H - 2 * pad)) / (hi - lo));
  const d = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const tone = last.v < pts[0].v ? 'hx-spark-up' : last.v > pts[0].v ? 'hx-spark-down' : 'hx-spark-flat';
  const label = `Price history: ${pts.map((p) => `${usd(p.v)} on ${utcDay(p.at, year)}`).join(', ')}`;
  return (
    <svg className={`hx-spark ${tone}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={d} fill="none" />
      <circle cx={x(pts.length - 1)} cy={y(last.v)} r="2.2" />
    </svg>
  );
}

/** eBay item specifics — the authenticity-relevant keys first, the rest folded. */
const USEFUL_ASPECTS = [
  'Original/Licensed Reprint',
  'Signed',
  'Production Technique',
  'Medium',
  'Material',
  'Type',
  'Authenticity',
  'Autograph Authentication',
  'Year',
  'Artist',
  'Size',
];

function Specifics({ d }: { d: NonNullable<CardV2['details']> }) {
  const all = Object.entries(d.aspects ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
  const rank = (k: string) => {
    const i = USEFUL_ASPECTS.findIndex((u) => u.toLowerCase() === k.toLowerCase());
    return i < 0 ? Infinity : i;
  };
  const useful = all.filter(([k]) => rank(k) !== Infinity).sort((a, b) => rank(a[0]) - rank(b[0]));
  const rest = all.filter(([k]) => rank(k) === Infinity);
  // nothing recognisable → still show a few, so the block never reads empty
  const lead = useful.length > 0 ? useful : rest.slice(0, 4);
  const more = useful.length > 0 ? rest : rest.slice(4);
  const snippet = d.descriptionSnippet?.trim();
  if (lead.length === 0 && !snippet) return null;
  return (
    <section className="hx-specs" aria-label="Item specifics">
      {lead.length > 0 && (
        <>
          <h4 className="hx-specs-h">Item specifics</h4>
          <dl className="hx-specs-grid">
            {lead.map(([k, v]) => (
              <div key={k} className="hx-spec">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {more.length > 0 && (
            <details className="hx-specs-more">
              <summary>+{more.length} more</summary>
              <dl className="hx-specs-grid">
                {more.map(([k, v]) => (
                  <div key={k} className="hx-spec">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
      {snippet && (
        <blockquote className="hx-desc" title="First lines of the seller's description">
          “{snippet}
          {snippet.length >= 270 ? '…' : ''}”
        </blockquote>
      )}
    </section>
  );
}

/** Fake / misrepresentation risk — the first thing you read about a listing. */
function RiskBadge({ c }: { c: CardV2 }) {
  const risk = c.risk ?? 'low';
  const label = risk === 'high' ? 'High fake risk' : risk === 'medium' ? 'Medium risk' : 'Low risk';
  return (
    <div className={`hx-risk hx-risk-${risk}`}>
      <span className="hx-risk-label">{label}</span>
      {c.riskReasons?.length > 0 && (
        <ul className="hx-risk-why">
          {c.riskReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {(c.relisted || (c.photoReused && c.photoReused.count > 0)) && (
        <ul className="hx-risk-chips" aria-label="Listing history signals">
          {c.photoReused && c.photoReused.count > 0 && (
            <li
              className="hx-risk-chip hx-risk-chip-high"
              title={`Same photo (perceptual match) as: ${c.photoReused.otherListingIds.join(', ')}`}
            >
              same photo on {c.photoReused.count} other {c.photoReused.count === 1 ? 'listing' : 'listings'}
            </li>
          )}
          {c.relisted && (
            <li
              className="hx-risk-chip hx-risk-chip-medium"
              title={
                c.relisted.previousItemIds.length
                  ? `Earlier item ids: ${c.relisted.previousItemIds.join(', ')}`
                  : 'Same seller, same title seen before'
              }
            >
              relisted — first seen {utcDay(c.relisted.firstSeenAt, new Date(c.lastSeenAt).getUTCFullYear())}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function HuntCard({ c: card }: { c: Card }) {
  const c = card as CardV2;
  const auction = c.buyingMode === 'AUCTION';
  const tone = c.underBy == null ? undefined : c.underBy >= 0 ? 'up' : 'down';
  const s = c.seller;
  // structured signals shown in the risk box / beside the price replace their flag chips
  const flags = c.flags.filter(
    (f) =>
      !(f === 'relisted' && c.relisted) &&
      !(f.startsWith('photo-reused:') && c.photoReused?.count) &&
      !(f === 'price-dropped' && c.priceChange),
  );
  return (
    <article
      className={`hx-card hx-card-${c.group} hx-card-risk-${c.risk ?? 'low'}`}
      data-classification={c.classification}
      data-risk={c.risk ?? 'low'}
      data-card-key={c.key}
      data-seller={s?.username ?? undefined}
    >
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

        <RiskBadge c={c} />
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

        {c.details && <Specifics d={c.details} />}

        {(c.reasons.length > 0 || flags.length > 0) && (
          <ul className="hx-chips" aria-label="Match reasons and risk flags">
            {c.reasons.map((r) => (
              <li key={`r-${r}`} className={`hx-chip ${isKnownCode(r) ? '' : 'hx-chip-raw'}`} title={r}>
                {reasonText(r)}
              </li>
            ))}
            {flags.map((f) => (
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
          {c.similarCount > 0 && (
            <span className="hx-badge" title="Same seller, same title — folded into this card; the lowest all-in is shown.">
              +{c.similarCount} similar from this seller
            </span>
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
        {c.dismissible !== false && (
          <Feedback cardKey={c.key} huntId={c.huntId} listingId={c.listingId} seller={s?.username ?? null} />
        )}
      </div>
    </article>
  );
}
