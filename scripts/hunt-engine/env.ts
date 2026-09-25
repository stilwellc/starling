/**
 * env.ts — configuration, validated before anything runs. Live is the default
 * and fails CLOSED: missing eBay credentials or missing storage credentials
 * stop the scan before a provider call. Fixture mode must be selected
 * explicitly and is refused in CI/production.
 */
import type { DataMode } from './types';

export class EngineConfigError extends Error { constructor(msg: string) { super(msg); this.name = 'EngineConfigError'; } }

export interface EngineEnv {
  mode: DataMode;
  ebay: { clientId: string; clientSecret: string; env: 'production' | 'sandbox'; marketplaceId: string; buyerZip: string } | null;
  storage: { kind: 'r2'; accountId: string; token: string; bucket: string } | { kind: 'file'; root: string };
  staleAfterMinutes: number;
  alertWebhookUrl: string | null;
}

export function isCI(env: Record<string, string | undefined> = process.env): boolean {
  return env.CI === 'true' || env.GITHUB_ACTIONS === 'true';
}

export function readEngineEnv(env: Record<string, string | undefined> = process.env): EngineEnv {
  const mode = (env.STARLING_DATA_MODE ?? 'live').trim() as DataMode;
  if (mode !== 'live' && mode !== 'fixture') throw new EngineConfigError(`STARLING_DATA_MODE must be "live" or "fixture" (got "${mode}")`);
  if (mode === 'fixture' && isCI(env)) throw new EngineConfigError('fixture mode is refused in CI/production — the hunt engine only publishes live data there');

  const staleRaw = Number(env.STARLING_STALE_AFTER_MINUTES ?? 240);
  const staleAfterMinutes = Number.isFinite(staleRaw) && staleRaw > 0 ? staleRaw : 240;
  const alertWebhookUrl = env.STARLING_ALERT_WEBHOOK_URL?.trim() || null;

  if (mode === 'fixture') {
    return { mode, ebay: null, storage: { kind: 'file', root: env.STARLING_HUNT_STORE_DIR ?? '.starling-state/hunt-engine-fixture' }, staleAfterMinutes, alertWebhookUrl: null };
  }

  const clientId = env.EBAY_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) throw new EngineConfigError('live mode needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET — refusing to run (no fixture fallback)');
  const ebayEnv = (env.EBAY_ENV ?? 'production').trim();
  if (ebayEnv !== 'production' && ebayEnv !== 'sandbox') throw new EngineConfigError('EBAY_ENV must be "production" or "sandbox"');

  let storage: EngineEnv['storage'];
  if (env.STARLING_HUNT_STORE_DIR && !isCI(env)) {
    storage = { kind: 'file', root: env.STARLING_HUNT_STORE_DIR };
  } else {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
    const token = (env.STARLING_R2_TOKEN || env.CLOUDFLARE_API_TOKEN || '').trim();
    if (!accountId || !token) throw new EngineConfigError('live mode needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (or STARLING_R2_TOKEN) to persist evidence');
    storage = { kind: 'r2', accountId, token, bucket: env.STARLING_R2_BUCKET?.trim() || 'starling-data' };
  }

  return {
    mode,
    ebay: { clientId, clientSecret, env: ebayEnv, marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || 'EBAY_US', buyerZip: env.STARLING_BUYER_ZIP?.trim() || '10001' },
    storage,
    staleAfterMinutes,
    alertWebhookUrl,
  };
}
