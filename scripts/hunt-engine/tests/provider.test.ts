import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EbayBrowseProvider, ProviderAuthError, ProviderConfigError, ProviderPageError, ProviderRateLimitError, PAGE_SIZE, MAX_PAGES, redact } from '../provider';
import { hunt, jsonResponse, summary } from './helpers';

const SECRET = 'SUPERSECRET-client-secret-value';
const ID = 'client-id-XYZ';
const TOKEN = 'v^1.1#i^1#fake-bearer-token-abcdef';

function fakeEbay(handler: (url: string, n: number) => Response | Promise<Response>) {
  const calls: string[] = [];
  let oauth = 0;
  const f = (async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes('/oauth2/token')) { oauth++; return jsonResponse({ access_token: TOKEN, expires_in: 7200 }); }
    calls.push(u);
    return handler(u, calls.length);
  }) as typeof fetch;
  return { f, calls, oauthCount: () => oauth };
}
const mk = (f: typeof fetch, timeoutMs?: number) =>
  new EbayBrowseProvider({ clientId: ID, clientSecret: SECRET, env: 'production', marketplaceId: 'EBAY_US', fetchImpl: f, timeoutMs });

test('missing credentials fail closed', () => {
  assert.throws(() => new EbayBrowseProvider({ clientId: '', clientSecret: '', env: 'production', marketplaceId: 'EBAY_US' }), ProviderConfigError);
});

test('the OAuth token is minted once and cached across searches', async () => {
  const e = fakeEbay(() => jsonResponse({ total: 1, itemSummaries: [summary('a', 'Robert Crumb drawing', 10, 5)] }));
  const p = mk(e.f);
  await p.search(hunt('art-crumb-drawing'), new Date());
  await p.search(hunt('art-saul-drawing'), new Date());
  assert.equal(e.oauthCount(), 1);
  assert.equal(p.health().calls, 2);
});

test('search paginates to completion, and stops at the documented page cap', async () => {
  const page = (off: number, total: number) => Array.from({ length: Math.min(PAGE_SIZE, total - off) }, (_, i) => summary(`id${off + i}`, 'Robert Crumb drawing', 10, 5));
  const five = fakeEbay((u) => jsonResponse({ total: 500, itemSummaries: page(Number(new URL(u).searchParams.get('offset')), 500) }));
  const r = await mk(five.f).search(hunt('art-crumb-drawing'), new Date());
  assert.equal(r.pages, 5);
  assert.equal(r.listings.length, 500);
  assert.ok(five.calls[0].includes('filter=buyingOptions%3A%7BFIXED_PRICE%7CAUCTION%7D'));
  const huge = fakeEbay((u) => jsonResponse({ total: 50_000, itemSummaries: page(Number(new URL(u).searchParams.get('offset')), 50_000) }));
  const h = await mk(huge.f).search(hunt('art-crumb-drawing'), new Date());
  assert.equal(h.pages, MAX_PAGES);
  assert.equal(huge.calls.length, MAX_PAGES);
});

test('401 and 403 stop the provider', async () => {
  for (const status of [401, 403]) {
    const e = fakeEbay(() => new Response('nope', { status }));
    const p = mk(e.f);
    await assert.rejects(p.search(hunt('art-crumb-drawing'), new Date()), ProviderAuthError);
    await assert.rejects(p.search(hunt('art-saul-drawing'), new Date()), ProviderAuthError);
    assert.equal(e.calls.length, 1, 'no further Browse calls after an auth failure');
    assert.equal(p.health().status, 'auth-failed');
  }
});

test('429 is a hard stop for the rest of the run and keeps rate-limit metadata', async () => {
  const e = fakeEbay(() => new Response('slow down', { status: 429, headers: { 'retry-after': '3600', 'x-ratelimit-remaining': '0' } }));
  const p = mk(e.f);
  await assert.rejects(p.search(hunt('art-crumb-drawing'), new Date()), ProviderRateLimitError);
  await assert.rejects(p.search(hunt('art-saul-drawing'), new Date()), ProviderRateLimitError);
  assert.equal(e.calls.length, 1);
  assert.equal(p.health().status, 'rate-limited');
  assert.equal(p.health().rateLimit?.retryAfter, '3600');
});

test('a timeout fails the hunt; a later-page failure makes it partial', async () => {
  const hang = fakeEbay(() => new Promise<Response>(() => {}));
  const slow = (async (url: any, init?: any) => {
    if (String(url).includes('/oauth2/token')) return jsonResponse({ access_token: TOKEN, expires_in: 7200 });
    return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => { const err = new Error('aborted'); err.name = 'AbortError'; rej(err); }));
  }) as typeof fetch;
  await assert.rejects(mk(slow, 30).search(hunt('art-crumb-drawing'), new Date()), ProviderPageError);
  void hang;
  const page = Array.from({ length: PAGE_SIZE }, (_, i) => summary(`p${i}`, 'Robert Crumb drawing', 10, 5));
  const e = fakeEbay((_u, n) => (n === 1 ? jsonResponse({ total: 500, itemSummaries: page }) : new Response('boom', { status: 502 })));
  const r = await mk(e.f).search(hunt('art-crumb-drawing'), new Date());
  assert.equal(r.pages, 1);
  assert.match(r.partialError ?? '', /502/);
});

test('malformed payloads are errors, not zero results', async () => {
  const bad = fakeEbay(() => new Response('<html>not json', { status: 200 }));
  await assert.rejects(mk(bad.f).search(hunt('art-crumb-drawing'), new Date()), /malformed/);
  const shape = fakeEbay(() => jsonResponse({ itemSummaries: 'nope' }));
  await assert.rejects(mk(shape.f).search(hunt('art-crumb-drawing'), new Date()), /unexpected shape/);
});

test('credentials and tokens are redacted from messages', () => {
  const msg = redact(`failed with ${SECRET} and Bearer ${TOKEN} and Basic Y2xpZW50OnNlY3JldA==`, [SECRET, ID]);
  assert.ok(!msg.includes(SECRET));
  assert.ok(!msg.includes(TOKEN));
  assert.ok(!msg.includes('Y2xpZW50OnNlY3JldA=='));
});
