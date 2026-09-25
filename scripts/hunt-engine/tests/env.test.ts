import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEngineEnv, EngineConfigError } from '../env';

test('live is the default and fails closed without eBay credentials', () => {
  assert.throws(() => readEngineEnv({}), (e: any) => e instanceof EngineConfigError && /no fixture fallback/.test(e.message));
});

test('live needs storage credentials in CI', () => {
  assert.throws(() => readEngineEnv({ EBAY_CLIENT_ID: 'a', EBAY_CLIENT_SECRET: 'b', CI: 'true' }), /CLOUDFLARE_ACCOUNT_ID/);
  const ok = readEngineEnv({ EBAY_CLIENT_ID: 'a', EBAY_CLIENT_SECRET: 'b', CI: 'true', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 't' });
  assert.equal(ok.mode, 'live');
  assert.equal(ok.storage.kind, 'r2');
});

test('fixture mode is impossible in CI/production', () => {
  assert.throws(() => readEngineEnv({ STARLING_DATA_MODE: 'fixture', CI: 'true' }), /refused in CI/);
  assert.throws(() => readEngineEnv({ STARLING_DATA_MODE: 'fixture', GITHUB_ACTIONS: 'true' }), /refused in CI/);
  assert.equal(readEngineEnv({ STARLING_DATA_MODE: 'fixture' }).mode, 'fixture');
});

test('an unknown mode is rejected', () => {
  assert.throws(() => readEngineEnv({ STARLING_DATA_MODE: 'sample' }), /must be "live" or "fixture"/);
});
