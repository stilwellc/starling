/**
 * EvidencePanel — the lectr proof panel. Starling manufactures nothing; every
 * number here is a corpus fact carried through in the Deal, and one tap deep-
 * links to lectr's evidence page for the identity key (PROPOSAL §4.1, §3.5).
 */
import type { Deal } from '@/scripts/types';
import { money, shortDate, relativeDate, trendPct, confLabel, isAgingBook, prettyKey } from '@/app/lib/display';

export function EvidencePanel({ deal, expanded = false }: { deal: Deal; expanded?: boolean }) {
  const trend = trendPct(deal.trend);
  const aging = isAgingBook(deal.lastSale);

  return (
    <div className={`evidence${expanded ? ' evidence-expanded' : ''}`}>
      <div className="evidence-head">
        <span className="evidence-brand">the lectr call</span>
        <span className={`conf-chip conf-${deal.conf}`}>{confLabel(deal.conf)}</span>
      </div>

      <dl className="evidence-grid">
        <div>
          <dt>Book median</dt>
          <dd>{money(deal.med)}</dd>
        </div>
        <div>
          <dt>Settled sales</dt>
          <dd>{deal.n}</dd>
        </div>
        <div>
          <dt>Last sale</dt>
          <dd title={shortDate(deal.lastSale)}>
            {relativeDate(deal.lastSale)}
            {aging && <span className="aging-flag" title="Most recent settled sale is over 24 months old">aging</span>}
          </dd>
        </div>
        <div>
          <dt>1Y trend</dt>
          <dd className={deal.trend != null ? (deal.trend >= 0 ? 'trend-up' : 'trend-down') : 'trend-na'}>
            {trend ?? 'n/a'}
          </dd>
        </div>
      </dl>

      {expanded && (
        <div className="evidence-band">
          Corpus band {money(deal.lo)} – {money(deal.hi)} · identity <code>{prettyKey(deal.key)}</code>
        </div>
      )}

      <a
        className="evidence-link"
        href={deal.evidenceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        See the comps on lectr →
      </a>
    </div>
  );
}
