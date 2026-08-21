/**
 * DealCard — the product's hero unit, one grammar at three densities.
 *
 *   hero — the top of the board: photo plate beside the full certificate
 *          (depth headline, band with the ask ON it, evidence ledger, risk
 *          with reasons, out-link).
 *   grid — the board card: same grammar, condensed (evidence as one line,
 *          risk reasons one tap away).
 *   row  — the tape: thumbnail · title · mini band · depth · price · grade.
 *
 * DEPTH and CONFIDENCE are the hero numbers; the vertical is a quiet chip,
 * never a spotlight (§2). Every density carries its evidence, its risk grade
 * WITH reasons reachable, and an eBay out-link with the affiliate disclosure
 * adjacent.
 */
import Link from 'next/link';
import type { Deal } from '@/scripts/types';
import { verticalLabel, money, depthPct, keyGrade } from '@/app/lib/display';
import { DepthBar } from './DepthBar';
import { EvidencePanel } from './EvidencePanel';
import { EvidenceLine } from './EvidenceLine';
import { RiskChip, RiskCoin } from './RiskChip';
import { OutLink } from './OutLink';

export type DealDensity = 'hero' | 'grid' | 'row';

/** Pricing-basis flags (v2, optional-defensive): 'thin book' = the corpus row
 *  behind this call is an n=3 pool (published only at 40%+ depth); 'ladder-
 *  priced' = no exact row for this grade, med/lo/hi derived from a neighboring
 *  grade via the book's grade ladder. Both explain themselves via title attrs —
 *  the no-black-box rule. Renders nothing on ordinary deals. */
function DealFlags({ deal }: { deal: Deal }) {
  if (!deal.thin && deal.basis !== 'ladder') return null;
  return (
    <span className="deal-flags">
      {deal.thin && (
        <span
          className="deal-flag deal-flag-thin"
          title="Thin book: only 3 settled sales behind this corpus row — surfaced only at 40%+ depth, ranked below equal-depth deals"
        >
          thin book
        </span>
      )}
      {deal.basis === 'ladder' && (
        <span
          className="deal-flag deal-flag-ladder"
          title={`Ladder-priced: no exact corpus row for this grade — value derived from ${
            deal.basisKey ? `"${deal.basisKey}"` : 'a neighboring grade'
          } via the book's grade ladder (raised 35% depth floor)`}
        >
          ladder-priced
        </span>
      )}
    </span>
  );
}

/** Grade transparency on card/pokemon deals: the BOOK row's grade and the
 *  LISTING's pinned grade, both parsed from the identity keys — identical
 *  unless the deal is ladder-priced (basisKey names the source row). "raw"
 *  renders too, on purpose: an ungraded book row is exactly the caveat a
 *  reader should see spelled out. Display only — nothing is re-derived. */
function GradeNote({ deal }: { deal: Deal }) {
  if (deal.vertical !== 'sports-cards' && deal.vertical !== 'pokemon') return null;
  const listing = keyGrade(deal.key);
  const book = keyGrade(deal.basisKey ?? deal.key);
  if (!listing || !book) return null;
  return (
    <span
      className="grade-note"
      title="The grade behind the corpus row vs the grade this listing's identity pinned — read from the keys, never inferred"
    >
      book: {book} · this listing: {listing}
    </span>
  );
}

function PriceLine({ deal }: { deal: Deal }) {
  return (
    <div className="card-price">
      <span className="card-price-allin">{money(deal.allIn)}</span>
      <span className="card-price-sub">
        all-in
        {deal.shipping != null && deal.shipping > 0
          ? ` · incl. ${money(deal.shipping)} ship`
          : deal.shipping === 0
            ? ' · free ship'
            : ''}
      </span>
    </div>
  );
}

function Media({ deal, aspect }: { deal: Deal; aspect?: 'wide' | 'tall' }) {
  return (
    <Link
      href={`/deal/${deal.id}/`}
      className={`card-media${aspect === 'tall' ? ' card-media-tall' : ''}`}
      data-deep={deal.depth >= 0.4}
      aria-label={deal.title}
    >
      {deal.imageUrl ? (
        // Static export → a plain img keeps it simple and offline-safe.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={deal.imageUrl} alt={deal.title} loading="lazy" />
      ) : (
        <div className="card-media-empty" aria-hidden="true">
          <span>no image</span>
        </div>
      )}
      <span className="card-vertical">{verticalLabel(deal.vertical)}</span>
    </Link>
  );
}

/** row — one line of the tape. The whole row links to the deal certificate. */
function DealRow({ deal, huntLabel }: { deal: Deal; huntLabel?: string }) {
  return (
    <article className="deal-row">
      <Link href={`/deal/${deal.id}/`} className="deal-row-thumb" aria-hidden="true" tabIndex={-1}>
        {deal.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={deal.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="deal-row-noimg" />
        )}
      </Link>
      <div className="deal-row-main">
        <h3 className="deal-row-title">
          <Link href={`/deal/${deal.id}/`}>{deal.title}</Link>
        </h3>
        <div className="deal-row-meta">
          <span className="deal-row-vertical">{verticalLabel(deal.vertical)}</span>
          {huntLabel && <span className="deal-row-hunted">hunted</span>}
          <DealFlags deal={deal} />
          <span className="deal-row-fact">
            {deal.n} {deal.n === 1 ? 'sale' : 'sales'} · book {money(deal.med)}
          </span>
          <GradeNote deal={deal} />
        </div>
        <DepthBar
          allIn={deal.allIn}
          lo={deal.lo}
          med={deal.med}
          hi={deal.hi}
          depth={deal.depth}
          size="mini"
        />
      </div>
      <div className="deal-row-nums">
        <span className="deal-row-depth">{money(deal.med - deal.allIn)}</span>
        <span className="deal-row-under">under · {depthPct(deal.depth)}</span>
        <span className="deal-row-price">{money(deal.allIn)}</span>
      </div>
      <div className="deal-row-end">
        <RiskCoin risk={deal.risk} />
        <Link href={`/deal/${deal.id}/`} className="deal-row-open" aria-label={`Open ${deal.title}`}>
          →
        </Link>
      </div>
    </article>
  );
}

/** hero — the top deal, full width: plate beside the complete certificate. */
function DealHero({ deal, huntLabel }: { deal: Deal; huntLabel?: string }) {
  return (
    <article className="card card-hero">
      <Media deal={deal} aspect="tall" />
      <div className="card-body">
        <div className="card-eyebrow">
          <span className="kicker kicker-lit">Top of the board</span>
          {huntLabel && (
            <span className="hunt-tag" title={`On the hunt list: ${huntLabel}`}>
              hunted · {huntLabel}
            </span>
          )}
          <DealFlags deal={deal} />
        </div>
        <div className="card-depth">
          <span className="card-depth-num">{money(deal.med - deal.allIn)}</span>
          <span className="card-depth-word">
            under the book · {depthPct(deal.depth)} deep
            <span className="card-depth-vs">
              {money(deal.allIn)} against a {money(deal.med)} median
            </span>
          </span>
        </div>
        <h2 className="card-title card-title-hero">
          <Link href={`/deal/${deal.id}/`}>{deal.title}</Link>
        </h2>
        <DepthBar
          allIn={deal.allIn}
          lo={deal.lo}
          med={deal.med}
          hi={deal.hi}
          depth={deal.depth}
          size="hero"
        />
        <GradeNote deal={deal} />
        <EvidencePanel deal={deal} />
        <RiskChip risk={deal.risk} expandable />
        <OutLink deal={deal} size="lg" />
      </div>
    </article>
  );
}

export function DealCard({
  deal,
  huntLabel,
  density = 'grid',
}: {
  deal: Deal;
  /** present when this deal was surfaced by the hunt list (§4.4) — renders the
   *  "hunted" stamp; everything else is the same card */
  huntLabel?: string;
  density?: DealDensity;
}) {
  if (density === 'row') return <DealRow deal={deal} huntLabel={huntLabel} />;
  if (density === 'hero') return <DealHero deal={deal} huntLabel={huntLabel} />;

  return (
    <article className="card">
      <Media deal={deal} />
      <div className="card-body">
        {huntLabel && (
          <span className="hunt-tag" title={`On the hunt list: ${huntLabel}`}>
            hunted · {huntLabel}
          </span>
        )}
        <div className="card-depth">
          <span className="card-depth-num">{money(deal.med - deal.allIn)}</span>
          <span className="card-depth-word">under the book · {depthPct(deal.depth)}</span>
          <DealFlags deal={deal} />
        </div>

        <h2 className="card-title">
          <Link href={`/deal/${deal.id}/`}>{deal.title}</Link>
        </h2>

        <PriceLine deal={deal} />
        <GradeNote deal={deal} />

        <DepthBar allIn={deal.allIn} lo={deal.lo} med={deal.med} hi={deal.hi} depth={deal.depth} />

        <div className="card-evidence-row">
          <EvidenceLine deal={deal} />
          <a
            className="evidence-link"
            href={deal.evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            comps on lectr →
          </a>
        </div>

        <RiskChip risk={deal.risk} expandable />

        <OutLink deal={deal} />
      </div>
    </article>
  );
}
