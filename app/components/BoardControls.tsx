'use client';

/**
 * BoardControls — the board's opinionated layout, filterable, in TWO TIERS
 * (the editorial bar, Aug 2026 — scripts/lib/tier.ts):
 *
 *   Featured — the defensible calls: high conf with n≥6, or a verified cert
 *   at grade A, depth 0.25–0.60 unless certed. Hero + grid weight. When
 *   nothing clears the bar, an honest line says so — no filler promotion.
 *
 *   Worth a look — everything else that passed the gates (thin books, ladder
 *   pricing, n<6, suspect depth): compact tape rows under an explicit
 *   thinner-evidence caption. Shown, ranked, never dressed up as featured.
 *
 * Vertical chips are FILTERS with live counts, not silos: toggling one
 * narrows both tiers in place. A risk floor hides the D-tail without ever
 * removing it. The closing lane no longer lives here — it LEADS the page
 * (page.tsx). Filtering only ever hides rows the server already rendered —
 * no data is fetched or invented client-side; the static-export contract
 * stays intact. Tier comes from the artifact's stamp when present, else the
 * same shared rule — pre-tier boards render identically to fresh ones.
 */
import { useMemo, useState } from 'react';
import type { Deal, Vertical, RiskGrade } from '@/scripts/types';
import { tierOf } from '@/scripts/lib/tier';
import { verticalLabel } from '@/app/lib/display';
import { DealCard } from './DealCard';

const RISK_ORDER: RiskGrade[] = ['A', 'B', 'C', 'D'];
const GRID_COUNT = 6; // hero + 6 cards, then any featured overflow rides the rows

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

  // The tier split — artifact stamp first, shared rule as the fallback.
  // Rank order within each tier is exactly the board order (rank desc).
  const { featured, worthALook } = useMemo(() => {
    const featured: Deal[] = [];
    const worthALook: Deal[] = [];
    for (const d of shown) ((d.tier ?? tierOf(d)) === 'featured' ? featured : worthALook).push(d);
    return { featured, worthALook };
  }, [shown]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: deals.length };
    for (const d of deals) c[d.vertical] = (c[d.vertical] ?? 0) + 1;
    return c;
  }, [deals]);

  const hero = featured[0];
  const gridDeals = featured.slice(1, 1 + GRID_COUNT);
  // featured past hero+grid still outranks the second tier — rows, same section
  const featuredOverflow = featured.slice(1 + GRID_COUNT);

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
        {vertical !== 'all' ? ` in ${verticalLabel(vertical as Vertical)}` : ''} · {featured.length}{' '}
        featured · ranked by depth × confidence × risk
      </p>

      {shown.length > 0 ? (
        <>
          {/* ── Featured — the defensible calls ─────────────────────────── */}
          <section className="board-featured" aria-label="Featured — the defensible calls">
            <div className="rule-head">
              <span className="kicker">Featured · the defensible calls</span>
              <span className="rule-head-count">
                {featured.length} clear{featured.length === 1 ? 's' : ''} the bar
              </span>
            </div>
            <p className="tier-sub">
              High-confidence rows with 6+ settled sales, or a machine-verified cert — depth
              25–60% unless the cert is verified. The bar, not the boast.
            </p>

            {featured.length > 0 ? (
              <>
                {hero && <DealCard deal={hero} density="hero" />}
                {gridDeals.length > 0 && (
                  <div className="grid grid-after-hero">
                    {gridDeals.map((d) => (
                      <DealCard key={d.id} deal={d} />
                    ))}
                  </div>
                )}
                {featuredOverflow.length > 0 && (
                  <div className="deal-rows deal-rows-featured">
                    {featuredOverflow.map((d) => (
                      <DealCard key={d.id} deal={d} density="row" />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-inline">
                Nothing clears the featured bar right now — that&apos;s the bar working, not the
                net failing. The thinner-evidence catches are below, labeled as such.
              </div>
            )}
          </section>

          {/* ── Worth a look — thinner evidence, said so ────────────────── */}
          {worthALook.length > 0 && (
            <section className="board-tape" aria-label="Worth a look — thinner evidence">
              <div className="rule-head">
                <span className="kicker">Worth a look</span>
                <span className="rule-head-count">{worthALook.length} more</span>
              </div>
              <p className="tier-sub">
                Passed every gate, but on thinner evidence — shallow sale counts, thin books,
                ladder-derived pricing, or depth that reads like unseen condition.{' '}
                <b>Check condition and grade yourself</b> before believing the number.
              </p>
              <div className="deal-rows">
                {worthALook.map((d) => (
                  <DealCard key={d.id} deal={d} density="row" />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="empty-inline">
          No deals match this filter right now. Loosen the risk floor or pick another vertical.
        </div>
      )}
    </>
  );
}
