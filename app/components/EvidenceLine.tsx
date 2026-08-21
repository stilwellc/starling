/**
 * EvidenceLine — the one-line evidence register for grid/row density:
 *   12 sales · last Jun 2024 · ▲ +8% 1Y · [high conf] · [aging book]
 * Every token is a corpus fact carried in the Deal; the full ledger
 * (EvidencePanel) renders at hero/detail density.
 */
import type { Deal } from '@/scripts/types';
import { shortDate, trendPct, isAgingBook } from '@/app/lib/display';

export function EvidenceLine({ deal }: { deal: Pick<Deal, 'n' | 'n12' | 'lastSale' | 'trend' | 'conf'> }) {
  const trend = trendPct(deal.trend);
  const aging = isAgingBook(deal.lastSale);
  return (
    <div className="evline">
      <span className="evline-fact">
        {deal.n} {deal.n === 1 ? 'sale' : 'sales'}
        {deal.n12 !== undefined && <> · {deal.n12} past year</>}
      </span>
      <span className="evline-dot" aria-hidden="true">
        ·
      </span>
      <span className="evline-fact">last {shortDate(deal.lastSale)}</span>
      {trend != null && deal.trend != null && (
        <>
          <span className="evline-dot" aria-hidden="true">
            ·
          </span>
          <span className={`evline-trend ${deal.trend >= 0 ? 'up' : 'down'}`}>
            <span aria-hidden="true">{deal.trend >= 0 ? '▲' : '▼'}</span> {trend} 1Y
          </span>
        </>
      )}
      <span className={`conf-badge conf-${deal.conf}`} title={`lectr ${deal.conf}-confidence row`}>
        {deal.conf} conf
      </span>
      {aging && (
        <span className="aging-flag" title="Most recent settled sale is over 12 months old">
          aging book
        </span>
      )}
    </div>
  );
}
