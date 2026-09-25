/**
 * cli.ts — `npm run hunt:scan` (live) / `npm run hunt:scan:fixture` (explicit local fixture).
 *   --hunt=<id>   search one hunt only (others carry their last results)
 *   --full        every hunt gets a full sweep (default: full when due, new-listings-only otherwise)
 *   --validate    validate the checked-in hunts and exit
 * Writes the dashboard payload to public/data/starling/hunt/dashboard.json so
 * the static page and the /api/v1 functions ship the same run.
 * Exit codes: 0 success/partial · 1 failed run · 2 bad config (no provider call made).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateHunts, HuntConfigError } from './validate';
import { readEngineEnv, EngineConfigError } from './env';
import { EbayBrowseProvider, ProviderConfigError } from './provider';
import { FixtureProvider } from './fixture-provider';
import { FileStore, R2RestStore } from './store';
import { runScan } from './scan';
import { writeHuntUsage } from './usage';
import type { HuntProvider } from './provider';

export const PUBLIC_DASHBOARD = join(process.cwd(), 'public', 'data', 'starling', 'hunt', 'dashboard.json');

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--hunt='))?.slice(7) || process.env.HUNT_ID?.trim() || null;
  let provider: HuntProvider | null = null;
  let runId: string | null = null;
  try {
    const hunts = validateHunts();
    if (args.includes('--validate')) {
      console.log(`hunt list valid: ${hunts.length} active hunts`);
      return 0;
    }
    const env = readEngineEnv();
    provider = env.mode === 'fixture'
      ? new FixtureProvider()
      : new EbayBrowseProvider({ ...env.ebay! });
    const store = env.storage.kind === 'r2'
      ? new R2RestStore({ accountId: env.storage.accountId, token: env.storage.token, bucket: env.storage.bucket })
      : new FileStore(env.storage.root);
    console.log(`[hunt] mode=${env.mode} store=${env.storage.kind}${only ? ` hunt=${only}` : ''}`);
    const { summary, dashboard } = await runScan({
      provider, store, mode: env.mode, onlyHuntId: only,
      staleAfterMinutes: env.staleAfterMinutes, webhookUrl: env.alertWebhookUrl,
      sweep: args.includes('--full') || process.env.HUNT_FULL === '1' ? 'full' : 'auto',
    });
    runId = summary.runId;
    mkdirSync(dirname(PUBLIC_DASHBOARD), { recursive: true });
    writeFileSync(PUBLIC_DASHBOARD, JSON.stringify(dashboard, null, 1));
    const d = summary.discovery;
    if (d) console.log(`[hunt] discovery: ${d.searches} searches · ${d.fullSweeps} full sweeps · ${d.deltaScans} new-only scans · ${d.newThisRun} new listings · ${d.secondLooks} second looks`);
    console.log(`[hunt] run ${summary.runId}: ${summary.state} · ${summary.huntsComplete}/${summary.huntsTotal} complete · ${summary.counts.under} under · ${summary.alerts.created} new alerts · promoted=${summary.promoted} · ${summary.provider.calls} calls`);
    return summary.state === 'failed' ? 1 : 0;
  } catch (e: any) {
    if (e instanceof HuntConfigError || e instanceof EngineConfigError || e instanceof ProviderConfigError) {
      console.error(`[hunt] ${e.message}`);
      return 2;
    }
    console.error(`[hunt] run aborted: ${String(e?.message ?? e).slice(0, 300)}`);
    return 1;
  } finally {
    // tell the board what the hunts actually spent this tick (it budgets the rest)
    if (provider) {
      const calls = provider.health().calls;
      writeHuntUsage({ runId, finishedAt: new Date().toISOString(), calls });
      console.log(`[hunt] spent ${calls} search calls this tick — the board gets the rest`);
    }
  }
}

main().then((code) => process.exit(code));
