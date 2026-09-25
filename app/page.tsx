import type { Metadata } from 'next';
import Link from 'next/link';
import { GROUP_LABEL, GROUP_ORDER, type DashboardPayload, type HuntRow } from '@/scripts/hunt-engine/dashboard';
import { HUNTS, HUNT_LIST_META } from '@/scripts/hunt-engine/hunts';
import { loadHuntDashboard } from '@/app/lib/hunt-data';
import { HuntCard } from '@/app/components/hunt/HuntCard';
import { Coverage } from '@/app/components/hunt/Coverage';
import { Ago, FreshnessChip, StaleRunBanner } from '@/app/components/hunt/Live';
import { utcStamp } from '@/app/components/hunt/format';

// Static export: dashboard.json is read once at build time and baked into HTML.
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Hunts — the hunt list, searched on eBay · Starling',
  description:
    'Every acquisition hunt searched on eBay each run: listings at or under their all-in max, watch-only hunts, and the coverage of every search — including the ones that failed.',
  openGraph: {
    title: 'Hunts · Starling',
    description: 'The hunt list, searched on eBay — unders, watches, and honest coverage.',
    type: 'website',
  },
};

const API_LINKS = [
  { href: '/api/v1/status', label: 'status' },
  { href: '/api/v1/hunts', label: 'hunts' },
  { href: '/api/v1/alerts?state=pending', label: 'alerts · pending' },
];

const RUN_STATE_TONE: Record<string, string> = { success: 'up', partial: 'warn', failed: 'down' };
const PROVIDER_TONE: Record<string, string> = {
  ok: 'up',
  fixture: 'warn',
  degraded: 'warn',
  'rate-limited': 'down',
  'auth-failed': 'down',
  'not-configured': 'down',
};

/** When no run has been published, the coverage table still lists every
 *  hunts — each honestly "not searched". Never an empty table, never "0". */
function unsearchedRows(): HuntRow[] {
  return HUNTS.filter((h) => h.active).map((h) => ({
    id: h.id,
    label: h.label,
    vertical: h.vertical,
    section: h.section,
    scope: h.scope,
    query: h.query,
    maxAllIn: h.maxAllIn,
    priority: h.priority,
    state: 'not-searched',
    lastSearchedAt: null,
    lastSuccessfulAt: null,
    carried: false,
    error: null,
    matchCount: 0,
    underCount: 0,
    overCount: 0,
    watchCount: 0,
  }));
}

function Header({ d }: { d: DashboardPayload | null }) {
  const list = d?.meta.list ?? HUNT_LIST_META;
  return (
    <div className="page-head hx-head">
      <div className="page-head-top">
        <span className="kicker">Hunts · searched on eBay every run</span>
        {d && <span className="serial">Run {d.run.id}</span>}
      </div>
      <h1>{list.title}</h1>
      <p className="lede">
        {list.alertRule} <b>Tax excluded.</b>
      </p>
      <div className="hx-links">
        <Link href="/hunts/brief/" className="hx-link-primary">
          Read the full brief →
        </Link>
        <span className="hx-links-api">
          <span className="hx-dim">JSON API</span>
          {API_LINKS.map((a) => (
            <a key={a.href} href={a.href} className="hx-api">
              <code>{a.href}</code>
            </a>
          ))}
        </span>
      </div>
    </div>
  );
}

function StatusBar({ d }: { d: DashboardPayload }) {
  const r = d.run;
  const ph = r.providerHealth;
  return (
    <section className="hx-status" aria-label="Run status">
      <div className="hx-cell">
        <span className="hx-k">State</span>
        <span className={`hx-badge hx-badge-${RUN_STATE_TONE[r.state] ?? 'down'}`}>{r.state}</span>
      </div>
      <div className="hx-cell">
        <span className="hx-k">Freshness</span>
        <FreshnessChip run={r} />
      </div>
      <div className="hx-cell">
        <span className="hx-k">Mode</span>
        <span className={`hx-badge ${r.mode === 'fixture' ? 'hx-badge-warn' : 'hx-badge-up'}`}>{r.mode}</span>
      </div>
      <div className="hx-cell">
        <span className="hx-k">Hunts complete</span>
        <span className={`hx-v ${r.huntsComplete < r.huntsTotal ? 'hx-warn-text' : ''}`}>
          {r.huntsComplete}/{r.huntsTotal}
        </span>
      </div>
      <div className="hx-cell hx-cell-wide">
        <span className="hx-k">Provider · {ph.calls} calls</span>
        <span className="hx-v">
          <span className={`hx-badge hx-badge-${PROVIDER_TONE[ph.status] ?? 'down'}`}>{ph.status}</span>
          {ph.message && <span className="hx-dim hx-provider-msg">{ph.message}</span>}
        </span>
      </div>
      <div className="hx-cell hx-cell-wide">
        <span className="hx-k">Finished</span>
        <span className="hx-v hx-mono">
          {utcStamp(r.finishedAt)} <Ago iso={r.finishedAt} />
        </span>
      </div>
      <div className="hx-cell hx-cell-wide">
        <span className="hx-k">Last full success</span>
        <span className={`hx-v hx-mono ${r.succeededAt ? '' : 'hx-warn-text'}`}>
          {r.succeededAt ? (
            <>
              {utcStamp(r.succeededAt)} <Ago iso={r.succeededAt} />
            </>
          ) : (
            'no run has searched every hunt yet'
          )}
        </span>
      </div>
      <div className="hx-cell hx-cell-wide">
        <span className="hx-k">Promoted</span>
        <span className={`hx-v ${r.promoted ? '' : 'hx-warn-text'}`}>{r.promoted ? 'yes' : 'no'}</span>
      </div>
    </section>
  );
}

function CoverageBanner({ d }: { d: DashboardPayload }) {
  if (d.run.state === 'success') return null;
  const affected = d.hunts.filter((h) => h.state !== 'complete');
  return (
    <div className={`hx-banner ${d.run.state === 'failed' ? 'hx-banner-stale' : 'hx-banner-warn'}`} role="status">
      <strong>{d.run.state === 'failed' ? 'RUN FAILED' : 'PARTIAL RUN'}</strong>
      <span>
        {d.run.huntsComplete} of {d.run.huntsTotal} hunts searched completely.{' '}
        {affected.length > 0 && (
          <>
            Affected:{' '}
            {affected.map((h, i) => (
              <span key={h.id}>
                {i > 0 && '; '}
                <b>{h.label}</b> ({h.state === 'not-searched' ? 'not searched' : h.state}
                {h.error ? ` — ${h.error}` : ''}
                {h.carried ? ' — showing last good results' : ''})
              </span>
            ))}
            .
          </>
        )}
      </span>
    </div>
  );
}

function Cards({ d }: { d: DashboardPayload }) {
  if (d.cards.length === 0) {
    const clean = d.run.state === 'success';
    return (
      <div className="empty-board hx-empty">
        <h2>{clean ? 'No listings retained — every hunt searched' : 'No listings to show from this run'}</h2>
        <p>
          {clean
            ? `All ${d.run.huntsTotal} hunts were searched completely and nothing matched. The coverage table below shows each search.`
            : `${d.run.huntsTotal - d.run.huntsComplete} of ${d.run.huntsTotal} hunts did not search completely, so this is not a clean zero. See coverage below.`}
        </p>
      </div>
    );
  }
  return (
    <div className="hx-groups">
      {GROUP_ORDER.map((g) => {
        const cards = d.cards.filter((c) => c.group === g);
        if (cards.length === 0) return null;
        return (
          <section key={g} className={`hx-group-sec hx-group-sec-${g}`} aria-labelledby={`hx-g-${g}`}>
            <div className="rule-head">
              <h2 id={`hx-g-${g}`} className="hx-h2">
                {GROUP_LABEL[g]}
              </h2>
              <span className="rule-head-count">
                {cards.length} {cards.length === 1 ? 'listing' : 'listings'}
              </span>
            </div>
            <div className="hx-grid">
              {cards.map((c) => (
                <HuntCard key={c.key} c={c} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function HuntsPage() {
  const d = loadHuntDashboard();

  if (!d) {
    return (
      <>
        <Header d={null} />
        <div className="empty-board hx-empty" role="status">
          <h2>The hunt engine hasn&apos;t published a run yet</h2>
          <p>
            No hunt has been searched, so there are no results to show — this is not &ldquo;0
            results.&rdquo; Every hunt below reads &ldquo;not searched&rdquo; until the first run
            publishes.
          </p>
        </div>
        <Coverage rows={unsearchedRows()} runLabel="— no run yet" />
      </>
    );
  }

  const c = d.counts;
  return (
    <>
      <Header d={d} />

      {d.run.mode === 'fixture' && (
        <div className="hx-banner hx-banner-fixture" role="alert">
          <strong>FIXTURE DATA — not live eBay inventory</strong>
          <span>
            This run used canned test listings. Nothing below is for sale; links and prices are
            fabricated for testing.
          </span>
        </div>
      )}
      <StaleRunBanner run={d.run} />
      <CoverageBanner d={d} />

      <StatusBar d={d} />

      <p className="build-stamp hx-counts">
        <b>{c.under}</b> under cap ({c.newUnder} new) · {c.watch} watching · {c.over} over cap ·{' '}
        {c.pendingAlerts} {c.pendingAlerts === 1 ? 'alert' : 'alerts'} pending · generated{' '}
        {utcStamp(d.generatedAt)}
      </p>

      <Cards d={d} />

      <Coverage rows={d.hunts} />
    </>
  );
}
