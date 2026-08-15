'use client';

/**
 * BoardControls — the mixed board's filter island.
 *
 * The board defaults to the MIXED view (PROPOSAL §2). Vertical chips are FILTERS,
 * not silos: toggling one narrows the already-ranked, already-interleaved list in
 * place — cards get no special slot or ordering. A risk floor lets a buyer hide
 * the D-grade tail without it ever being silently removed from the corpus.
 *
 * Filtering only ever hides rows the server already rendered — no data is fetched
 * or invented client-side, keeping the static-export contract intact.
 */
import { useMemo, useState } from 'react';
import type { Deal, Vertical, RiskGrade } from '@/scripts/types';
import { verticalLabel } from '@/app/lib/display';
import { DealCard } from './DealCard';

const RISK_ORDER: RiskGrade[] = ['A', 'B', 'C', 'D'];

export function BoardControls({ deals }: { deals: Deal[] }) {
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
        </div>

        <div className="control-row">
          <span className="control-label">Max risk</span>
          <div className="chips chips-risk">
            {RISK_ORDER.map((g) => (
              <button
                key={g}
                className={`chip chip-risk${maxRisk === g ? ' chip-on' : ''} risk-${g.toLowerCase()}-tint`}
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
        {vertical !== 'all' ? ` in ${verticalLabel(vertical as Vertical)}` : ''}
      </p>

      {shown.length > 0 ? (
        <div className="grid">
          {shown.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </div>
      ) : (
        <div className="empty-inline">
          No deals match this filter right now. Loosen the risk floor or pick another vertical.
        </div>
      )}
    </>
  );
}
