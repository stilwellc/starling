'use client';

/**
 * BoardControls — the board's opinionated layout, filterable.
 *
 * "What the net caught today": the top-ranked deal renders at HERO density,
 * the next few as grid cards, and the remainder as the tape — compact rows.
 * Vertical chips are FILTERS with live counts, not silos: toggling one narrows
 * the already-ranked list in place, and the hero is simply the top of whatever
 * is shown. A risk floor hides the D-tail without ever removing it.
 *
 * Filtering only ever hides rows the server already rendered — no data is
 * fetched or invented client-side; the static-export contract stays intact.
 */
import { useMemo, useState } from 'react';
import type { AuctionCall, Deal, Vertical, RiskGrade } from '@/scripts/types';
import { verticalLabel } from '@/app/lib/display';
import { DealCard } from './DealCard';
import { ClosingSection } from './ClosingSection';

const RISK_ORDER: RiskGrade[] = ['A', 'B', 'C', 'D'];
const GRID_COUNT = 6; // hero + 6 cards, then the tape

export function BoardControls({
  deals,
  closing,
}: {
  deals: Deal[];
  /** closing calls (v2, optional) — its own urgency lane pinned above the
   *  tape; deliberately NOT run through the vertical/risk filters (a watch
   *  signal isn't a deal, and 30 rows max don't need narrowing) */
  closing?: AuctionCall[];
}) {
  const [vertical, setVertical] = useState<Vertical | 'all'>('all');
  const [maxRisk, setMaxRisk] = useState<RiskGrade>('D');

  // Which verticals are actually present, in board order (deals arrive rank-desc).
  const presentVerticals = useMemo(() => {
    const seen: Vertical[] = [];
    for (const d of deals) if (!seen.includes(d.vertical)) seen.push(d.vertical);
    return seen;
  }, [deals]);

  const maxRiskIdx = RISK_ORDER.indexOf(maxRisk);

  const shown = useMemo(
    () =>
      deals.filter(
        (d) =>
          (vertical === 'all' || d.vertical === vertical) &&
          RISK_ORDER.indexOf(d.risk.grade) <= maxRiskIdx,
      ),
    [deals, vertical, maxRiskIdx],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: deals.length };
    for (const d of deals) c[d.vertical] = (c[d.vertical] ?? 0) + 1;
    return c;
  }, [deals]);

  const hero = shown[0];
  const gridDeals = shown.slice(1, 1 + GRID_COUNT);
  const tapeDeals = shown.slice(1 + GRID_COUNT);

  return (
    <>
      <div className="controls" role="region" aria-label="Board filters">
        <div className="control-row">
          <span className="control-label">Vertical</span>
          <div className="chips">
            <button
              className={`chip${vertical === 'all' ? ' chip-on' : ''}`}
              onClick={() => setVertical('all')}
              aria-pressed={vertical === 'all'}
            >
              All <span className="chip-count">{counts.all}</span>
            </button>
            {presentVerticals.map((v) => (
              <button
                key={v}
                className={`chip${vertical === v ? ' chip-on' : ''}`}
                onClick={() => setVertical(v)}
                aria-pressed={vertical === v}
              >
                {verticalLabel(v)} <span className="chip-count">{counts[v]}</span>
              </button>
            ))}
          </div>
          <span className="control-label control-label-right">Max risk</span>
          <div className="chips chips-risk">
            {RISK_ORDER.map((g) => (
              <button
                key={g}
                className={`chip chip-risk${maxRisk === g ? ' chip-on' : ''}`}
                onClick={() => setMaxRisk(g)}
                aria-pressed={maxRisk === g}
                title={`Show grades up to and including ${g}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="showing-count">
        Showing {shown.length} of {deals.length} deals
        {vertical !== 'all' ? ` in ${verticalLabel(vertical as Vertical)}` : ''} · ranked by depth ×
        confidence × risk
      </p>

      {shown.length > 0 ? (
        <>
          {hero && <DealCard deal={hero} density="hero" />}

          {gridDeals.length > 0 && (
            <div className="grid grid-after-hero">
              {gridDeals.map((d) => (
                <DealCard key={d.id} deal={d} />
              ))}
            </div>
          )}

          {/* Closing soon — the auction lane, pinned ABOVE the tape: urgency
              reads before the long tail. */}
          {closing && closing.length > 0 && <ClosingSection calls={closing} />}

          {tapeDeals.length > 0 && (
            <section className="board-tape" aria-label="The rest of the board">
              <div className="rule-head">
                <span className="kicker">The rest of the tape</span>
                <span className="rule-head-count">{tapeDeals.length} more</span>
              </div>
              <div className="deal-rows">
                {tapeDeals.map((d) => (
                  <DealCard key={d.id} deal={d} density="row" />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="empty-inline">
            No deals match this filter right now. Loosen the risk floor or pick another vertical.
          </div>
          {/* the auction lane is filter-independent — it stays visible */}
          {closing && closing.length > 0 && <ClosingSection calls={closing} />}
        </>
      )}
    </>
  );
}
