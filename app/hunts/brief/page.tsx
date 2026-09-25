import type { Metadata } from 'next';
import Link from 'next/link';
import {
  HUNTS,
  HUNT_LIST_META,
  HUNT_NOTES,
  MANUAL_RESEARCH_BRIEF,
  type Hunt,
} from '@/scripts/hunt-engine/hunts';
import { usd } from '@/app/components/hunt/format';

// Read-only brief, rendered from the checked-in hunt list at build time.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'The hunt brief · Starling',
  description:
    'The full hunt list brief: section scopes and rules, notes, every hunt with its query, title rules, exclusions and all-in max, and the manual research brief.',
};

const NOTE_LABEL: Record<keyof typeof HUNT_NOTES, string> = {
  art: 'Art',
  paintings: 'Paintings',
  drawings: 'Drawings',
  sports: 'Sports',
  furniture: 'Furniture',
  researchShape: 'Research result shape',
  priceMax: 'Price max',
};

function mustText(m: Hunt['titleMust']): React.ReactNode {
  return m.map((e, i) => (
    <span key={i} className="hx-must">
      {Array.isArray(e) ? e.map((a) => `“${a}”`).join(' or ') : `“${e}”`}
    </span>
  ));
}

const VERTICALS = ['art', 'sports', 'furniture'] as const;

export default function BriefPage() {
  const s = HUNT_LIST_META.sections;
  const active = HUNTS.filter((h) => h.active);
  return (
    <div className="hx-brief">
      <div className="page-head hx-head">
        <div className="page-head-top">
          <span className="kicker">Hunts · the brief · read-only</span>
          <span className="serial">{active.length} hunts</span>
        </div>
        <h1>{HUNT_LIST_META.title}</h1>
        <p className="lede">{HUNT_LIST_META.sourceOfTruth}</p>
        <p className="lede">
          {HUNT_LIST_META.alertRule} <b>Tax excluded.</b>
        </p>
        <div className="hx-links">
          <Link href="/" className="hx-link-primary">
            ← Back to the hunts
          </Link>
        </div>
      </div>

      <section className="hx-brief-sec">
        <div className="rule-head">
          <h2 className="hx-h2">Sections &amp; rules</h2>
        </div>
        <div className="hx-brief-cols">
          <div className="hx-brief-box">
            <h3>{s.art.heading}</h3>
            <p>{s.art.scope}</p>
            <ul>
              <li>{s.art.paintings}</li>
              <li>{s.art.drawings}</li>
            </ul>
          </div>
          <div className="hx-brief-box">
            <h3>{s.sports.heading}</h3>
            <p>{s.sports.scope}</p>
            <ul>
              <li>{s.sports.signedRule}</li>
              <li>{s.sports.photoRule}</li>
            </ul>
          </div>
          <div className="hx-brief-box">
            <h3>{s.furniture.heading}</h3>
            <p>Subsections: {s.furniture.subsections.join(' · ')}</p>
            <ul>
              {s.furniture.subsections.map((sub) => (
                <li key={sub}>
                  {sub}
                  {(s.furniture.emptySubsections as readonly string[]).includes(sub) && (
                    <span className="hx-dim"> — intentionally empty</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="hx-brief-sec">
        <div className="rule-head">
          <h2 className="hx-h2">Notes</h2>
        </div>
        <dl className="hx-notes">
          {(Object.keys(HUNT_NOTES) as Array<keyof typeof HUNT_NOTES>).map((k) => (
            <div key={k} className="hx-note">
              <dt>{NOTE_LABEL[k] ?? k}</dt>
              <dd>{HUNT_NOTES[k]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="hx-brief-sec">
        <div className="rule-head">
          <h2 className="hx-h2">All hunts</h2>
          <span className="rule-head-count">{active.length} active</span>
        </div>
        {VERTICALS.map((v) => {
          const rows = active.filter((h) => h.vertical === v);
          const secs: string[] = [];
          for (const h of rows) if (!secs.includes(h.section)) secs.push(h.section);
          if (v === 'furniture') {
            for (const sub of s.furniture.subsections) if (!secs.includes(sub)) secs.push(sub);
          }
          return (
            <div key={v} className="hx-cov-vertical">
              <h3 className="hx-cov-vh">{s[v].heading}</h3>
              <div className="hx-cov-wrap">
                <table className="hx-cov hx-brief-table">
                  <thead>
                    <tr>
                      <th>Hunt</th>
                      <th>Scope</th>
                      <th>eBay query</th>
                      <th>Title must have</th>
                      <th>Exclusions</th>
                      <th className="hx-num">Max all-in</th>
                    </tr>
                  </thead>
                  {secs.map((sec) => {
                    const sRows = rows.filter((h) => h.section === sec);
                    return (
                      <tbody key={sec}>
                        <tr className="hx-cov-sec">
                          <th colSpan={6} scope="rowgroup">
                            {sec}
                            <span>
                              {sRows.length} {sRows.length === 1 ? 'hunt' : 'hunts'}
                            </span>
                          </th>
                        </tr>
                        {sRows.length === 0 && (
                          <tr className="hx-cov-empty">
                            <td colSpan={6}>
                              {sec} is empty on purpose — no hunts are configured here, and that is
                              intentional, not lost configuration.
                            </td>
                          </tr>
                        )}
                        {sRows.map((h) => (
                          <tr key={h.id} className="hx-cov-row">
                            <td data-label="Hunt" className="hx-cov-label">
                              {h.label}
                              {h.notes && h.notes.length > 0 && (
                                <span className="hx-dim hx-hunt-notes">{h.notes.join(' · ')}</span>
                              )}
                            </td>
                            <td data-label="Scope">{h.scope}</td>
                            <td data-label="eBay query">
                              <code>{h.query}</code>
                            </td>
                            <td data-label="Title must have">{mustText(h.titleMust)}</td>
                            <td data-label="Exclusions" className="hx-excl">
                              {h.titleExcludes.join(', ')}
                            </td>
                            <td data-label="Max all-in" className={`hx-num ${h.maxAllIn == null ? 'hx-na' : ''}`}>
                              {h.maxAllIn == null ? 'watching — no cap' : usd(h.maxAllIn)}
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

      <section className="hx-brief-sec">
        <div className="rule-head">
          <h2 className="hx-h2">Manual research brief</h2>
        </div>
        <div className="hx-banner hx-banner-warn" role="note">
          <strong>MANUAL USE ONLY</strong>
          <span>
            These tactics and sources are for a person researching by hand. They are not automated —
            the hunt engine does not run them, search these venues, or record these fields.
          </span>
        </div>
        <div className="hx-brief-cols">
          <div className="hx-brief-box">
            <h3>Tactics</h3>
            <ul>
              {MANUAL_RESEARCH_BRIEF.tactics.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="hx-brief-box">
            <h3>External sources</h3>
            <ul className="hx-inline-list">
              {MANUAL_RESEARCH_BRIEF.externalSources.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="hx-brief-box">
            <h3>Record for each result</h3>
            <ul className="hx-inline-list">
              {MANUAL_RESEARCH_BRIEF.resultFields.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <h3 className="hx-brief-sub">Flag</h3>
            <ul className="hx-inline-list">
              {MANUAL_RESEARCH_BRIEF.flags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
