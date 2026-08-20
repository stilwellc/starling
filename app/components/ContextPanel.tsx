/**
 * ContextPanel / ContextLine — the lectr context surface (board.json v2).
 *
 * A context block is a REAL corpus read for a NEARBY class — "Charles Schulz
 * signed material · 41 sales · $150–$2.4K · median $600 · last Jul 2026" —
 * shown as background under a hunt target or beside a wide-net lead. It is
 * never a priced call on the specific listing: no depth, no rank, and the
 * caption says so. Kind-aware phrasing lives in contextCaption().
 */
import type { LectrContext } from '@/app/lib/board-data';
import { contextCaption, moneyCompact, monthYear } from '@/app/lib/display';

function ContextFacts({ context }: { context: LectrContext }) {
  return (
    <>
      <span className="ctx-fact">
        {context.n} {context.n === 1 ? 'sale' : 'sales'}
      </span>
      <span className="ctx-dot" aria-hidden="true">
        ·
      </span>
      <span className="ctx-fact">
        {moneyCompact(context.lo)}–{moneyCompact(context.hi)}
      </span>
      <span className="ctx-dot" aria-hidden="true">
        ·
      </span>
      <span className="ctx-fact">
        median <b>{moneyCompact(context.med)}</b>
      </span>
      {context.lastSale && (
        <>
          <span className="ctx-dot" aria-hidden="true">
            ·
          </span>
          <span className="ctx-fact">last {monthYear(context.lastSale)}</span>
        </>
      )}
    </>
  );
}

/** The certificate panel under a hunt target's head. */
export function ContextPanel({ context }: { context: LectrContext }) {
  return (
    <div className="ctx-panel" role="note" aria-label="lectr context for this target">
      <span className="ctx-brand">lectr context</span>
      <span className="ctx-caption">{contextCaption(context.kind, context.k)}</span>
      <span className="ctx-facts">
        <ContextFacts context={context} />
      </span>
    </div>
  );
}

/** The one-line register on a noBook fact row / wide-net lead. */
export function ContextLine({ context }: { context: LectrContext }) {
  return (
    <div className="ctx-line" role="note">
      <span className="ctx-brand">context</span>
      <span className="ctx-caption">{contextCaption(context.kind, context.k)}</span>
      <span className="ctx-facts">
        <ContextFacts context={context} />
      </span>
      <span className="ctx-disclaim">not a priced call</span>
    </div>
  );
}
