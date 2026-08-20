/**
 * LeadsSection — "The wide net" (board.json v2 `leads[]`, optional).
 *
 * Context leads are listings the net flagged with a lectr context read for a
 * NEARBY class — background, not priced calls. The section says so in its own
 * head, and every row's context line repeats it. Renders nothing when the
 * pipeline hasn't shipped leads.
 */
import type { Lead } from '@/app/lib/board-data';
import { contextOf } from '@/app/lib/board-data';
import { FactRow } from './FactRow';

const LEADS_VISIBLE = 8;

export function LeadsSection({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) return null;
  const visible = leads.slice(0, LEADS_VISIBLE);
  const overflow = leads.slice(LEADS_VISIBLE);

  return (
    <section className="leads" aria-label="The wide net — context leads">
      <div className="rule-head">
        <span className="kicker">The wide net · context leads</span>
        <span className="rule-head-count">{leads.length} live</span>
      </div>
      <p className="leads-sub">
        Listings the net flagged with corpus context for a <em>nearby</em> class — background
        reads, <b>not priced calls</b>. No depth, no rank, no grade until an identity pins to an
        exact book row.
      </p>
      <div className="fact-rows">
        {visible.map((l) => (
          <FactRow key={l.id} item={l} context={contextOf(l)} showLens />
        ))}
      </div>
      {overflow.length > 0 && (
        <details className="rows-more">
          <summary>Show {overflow.length} more leads</summary>
          <div className="fact-rows">
            {overflow.map((l) => (
              <FactRow key={l.id} item={l} context={contextOf(l)} showLens />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
