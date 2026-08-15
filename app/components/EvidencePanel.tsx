/**
 * EvidencePanel — the lectr proof, rendered as lectr's certificate ledger:
 * dotted-leader rows (label ······ value) and a filled-dot confidence meter.
 * Starling manufactures nothing; every number is a corpus fact carried through
 * in the Deal, and one tap deep-links to lectr's evidence page for the identity
 * key (PROPOSAL §4.1, §3.5).
 */
import type { Deal } from '@/scripts/types';
import { money, shortDate, relativeDate, trendPct, isAgingBook, depthPct, prettyKey } from '@/app/lib/display';

/** Book ships only high|medium; render as a 4-dot meter (high = 4, medium = 2). */
function ConfMeter({ conf }: { conf: Deal['conf'] }) {
  const on = conf === 'high' ? 4 : 2;
  return (
    <span className="dotmeter" aria-label={`${conf} confidence`}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < on ? 'on' : ''}>
          ●
        </span>
      ))}
      <span className="conf-word"> {conf}</span>
    </span>
  );
}

function Row({
  k,
  sub,
  children,
  tone,
}: {
  k: string;
  sub?: string;
  children: React.ReactNode;
  tone?: 'up' | 'down' | 'na';
}) {
  return (
    <div className="ledger-row">
      <span className="ledger-k">{k}</span>
      <span className="ledger-lead" aria-hidden="true" />
      <span className={`ledger-v${tone ? ` ${tone}` : ''}`}>
        {sub && <span className="ledger-sub">{sub}</span>}
        {children}
      </span>
    </div>
  );
}

export function EvidencePanel({ deal, expanded = false }: { deal: Deal; expanded?: boolean }) {
  const trend = trendPct(deal.trend);
  const aging = isAgingBook(deal.lastSale);

  return (
    <div className={`evidence${expanded ? ' evidence-expanded' : ''}`}>
      <div className="evidence-head">
        <span className="evidence-brand">the lectr call</span>
        <a className="evidence-link" href={deal.evidenceUrl} target="_blank" rel="noopener noreferrer">
          See the comps on lectr →
        </a>
      </div>

      <div className="ledger">
        <Row k="Book median" sub={`${deal.n} sales`}>
          {money(deal.med)}
        </Row>
        <Row k="The gap" sub="under book" tone="up">
          {depthPct(deal.depth)}
        </Row>
        <Row k="Confidence">
          <ConfMeter conf={deal.conf} />
        </Row>
        <Row k="Last sale">
          <span title={shortDate(deal.lastSale)}>{relativeDate(deal.lastSale)}</span>
          {aging && (
            <span className="aging-flag" title="Most recent settled sale is over 24 months old">
              aging
            </span>
          )}
        </Row>
        <Row k="1Y trend" tone={deal.trend != null ? (deal.trend >= 0 ? 'up' : 'down') : 'na'}>
          {trend ?? 'n/a'}
        </Row>
      </div>

      {expanded && (
        <div className="evidence-band">
          Corpus band {money(deal.lo)} – {money(deal.hi)} · identity <code>{prettyKey(deal.key)}</code>
        </div>
      )}
    </div>
  );
}
