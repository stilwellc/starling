/**
 * Coverage — every hunt, every run, whether it found anything or not. A hunt
 * that failed, ran partially, or wasn't searched NEVER reads as "0 matches":
 * only a complete search can report a clean zero.
 */
import type { HuntRow } from '@/scripts/hunt-engine/dashboard';
import { HUNT_LIST_META } from '@/scripts/hunt-engine/hunts';
import { usd, utcShort, utcStamp } from './format';

const VERTICALS = ['art', 'sports', 'furniture', 'grails'] as const;

const STATE_LABEL: Record<HuntRow['state'], string> = {
  complete: 'complete',
  partial: 'partial',
  failed: 'failed',
  'not-searched': 'not searched',
};

function matchesText(r: HuntRow): string {
  const n = r.matchCount;
  const plural = n === 1 ? 'match' : 'matches';
  switch (r.state) {
    case 'complete':
      return n === 0 ? '0 matches (searched)' : `${n} ${plural}`;
    case 'failed':
      return r.lastSuccessfulAt
        ? `search failed — showing last good results${n > 0 ? ` (${n} ${plural})` : ' (none)'}`
        : 'search failed — no successful search yet';
    case 'partial':
      return n > 0 ? `partial — ${n} ${plural} so far` : 'partial';
    case 'not-searched':
    default:
      return 'not searched this run';
  }
}

function undersText(r: HuntRow): string {
  if (r.state === 'complete' || r.matchCount > 0) return String(r.underCount);
  return '—';
}

/** Rows with matches first, then clean zeros, then incomplete coverage. */
function rank(r: HuntRow): number {
  if (r.state !== 'complete') return 2;
  return r.matchCount > 0 ? 0 : 1;
}

function sectionsFor(v: (typeof VERTICALS)[number], rows: HuntRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) if (r.vertical === v && !seen.includes(r.section)) seen.push(r.section);
  if (v === 'furniture') {
    const order = [...HUNT_LIST_META.sections.furniture.subsections] as string[];
    for (const s of order) if (!seen.includes(s)) seen.push(s);
    seen.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }
  return seen;
}

const EMPTY_ON_PURPOSE = HUNT_LIST_META.sections.furniture.emptySubsections as readonly string[];

export function Coverage({ rows, runLabel = 'this run' }: { rows: HuntRow[]; runLabel?: string }) {
  return (
    <section className="hx-coverage" aria-labelledby="hx-coverage-h">
      <div className="rule-head">
        <h2 id="hx-coverage-h" className="hx-h2">
          Hunt coverage
        </h2>
        <span className="rule-head-count">
          {rows.filter((r) => r.state === 'complete').length}/{rows.length} searched completely {runLabel}
        </span>
      </div>
      {VERTICALS.map((v) => {
        const vRows = rows.filter((r) => r.vertical === v);
        const secs = sectionsFor(v, rows);
        if (secs.length === 0) return null;
        return (
          <div key={v} id={`hunts-${v}`} className="hx-cov-vertical">
            <h3 className="hx-cov-vh">{HUNT_LIST_META.sections[v].heading}</h3>
            <div className="hx-cov-wrap">
              <table className="hx-cov">
                <thead>
                  <tr>
                    <th>Hunt</th>
                    <th className="hx-num">Max all-in</th>
                    <th>State</th>
                    <th>Matches</th>
                    <th className="hx-num">Unders</th>
                    <th>Last searched</th>
                    <th>Last successful</th>
                    <th>Error</th>
                  </tr>
                </thead>
                {secs.map((sec) => {
                  const sRows = vRows
                    .filter((r) => r.section === sec)
                    .sort((a, b) => rank(a) - rank(b) || a.priority - b.priority);
                  return (
                    <tbody key={sec}>
                      <tr className="hx-cov-sec">
                        <th colSpan={8} scope="rowgroup">
                          {sec}
                          <span>{sRows.length} {sRows.length === 1 ? 'hunt' : 'hunts'}</span>
                        </th>
                      </tr>
                      {sRows.length === 0 && (
                        <tr className="hx-cov-empty">
                          <td colSpan={8}>
                            {EMPTY_ON_PURPOSE.includes(sec)
                              ? `${sec} is intentionally empty — no hunts on purpose, not lost configuration.`
                              : 'No hunts in this subsection.'}
                          </td>
                        </tr>
                      )}
                      {sRows.map((r) => (
                        <tr key={r.id} className={`hx-cov-row hx-cov-${r.state}`}>
                          <td data-label="Hunt" className="hx-cov-label">
                            {r.label}
                          </td>
                          <td data-label="Max all-in" className={`hx-num ${r.maxAllIn == null ? 'hx-na' : ''}`}>
                            {r.maxAllIn == null ? 'watching — no cap' : usd(r.maxAllIn)}
                          </td>
                          <td data-label="State">
                            <span className={`hx-state hx-state-${r.state}`}>{STATE_LABEL[r.state]}</span>
                          </td>
                          <td data-label="Matches" className={r.state === 'complete' ? '' : 'hx-warn-text'}>
                            {matchesText(r)}
                          </td>
                          <td data-label="Unders" className={`hx-num ${r.underCount > 0 ? 'hx-up' : ''}`}>
                            {undersText(r)}
                          </td>
                          <td data-label="Last searched" className="hx-mono" title={r.lastSearchedAt ? utcStamp(r.lastSearchedAt) : undefined}>
                            {r.lastSearchedAt ? utcShort(r.lastSearchedAt) : 'never'}
                          </td>
                          <td data-label="Last successful" className="hx-mono" title={r.lastSuccessfulAt ? utcStamp(r.lastSuccessfulAt) : undefined}>
                            {r.lastSuccessfulAt ? utcShort(r.lastSuccessfulAt) : 'never'}
                          </td>
                          <td data-label="Error" className={r.error ? 'hx-err' : 'hx-na'}>
                            {r.error ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
