import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../scan';
import { MemoryStore, PREFIX } from '../store';
import { FixtureProvider } from '../fixture-provider';
import { EbayBrowseProvider } from '../provider';
import { alertsResponse, effectiveState, huntsResponse, statusResponse } from '../dashboard';
import { HUNTS } from '../hunts';
import { jsonResponse, summary } from './helpers';

const clockFrom = (iso: string) => { let t = Date.parse(iso); return () => new Date((t += 1000)); };
const crumb = (id: string, price: number, ship: number | null = 25) => summary(id, 'Robert Crumb Original Pen and Ink Drawing', price, ship);

test('golden path: one hunt → one listing → one under → persisted run → card + JSON → one pending alert; rerun adds none', async () => {
  const store = new MemoryStore();
  const data = { 'art-crumb-drawing': { itemSummaries: [crumb('c1', 1500)] } };
  const r1 = await runScan({ provider: new FixtureProvider(data), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'run-1', log: () => {} });
  assert.equal(r1.summary.state, 'success');
  assert.equal(r1.summary.counts.under, 1);
  assert.ok(store.objects.has(`${PREFIX}runs/run-1/summary.json`));
  assert.ok(store.objects.has(`${PREFIX}runs/run-1/raw/ebay/art-crumb-drawing.json`));
  assert.ok(store.objects.has(`${PREFIX}listings/ebay/c1.json`));
  assert.ok(store.objects.has(`${PREFIX}manifests/latest.json`));
  const card = r1.dashboard.cards.find((c) => c.listingId === 'c1')!;
  assert.equal(card.group, 'new-under');
  assert.equal(card.allIn, 1525);
  const api = alertsResponse(r1.dashboard, Date.parse('2026-09-24T00:10:00Z'), { state: 'pending' });
  assert.equal(api.alerts.length, 1);
  assert.equal(api.alerts[0].listingId, 'c1');
  assert.equal(api.run.id, 'run-1');

  const r2 = await runScan({ provider: new FixtureProvider(data), store, mode: 'fixture', now: clockFrom('2026-09-24T03:00:00Z'), runId: 'run-2', log: () => {} });
  assert.equal(r2.summary.alerts.created, 0, 'identical rerun creates no alert');
  assert.equal(r2.dashboard.cards.find((c) => c.listingId === 'c1')!.group, 'under');
  assert.equal(alertsResponse(r2.dashboard, Date.parse('2026-09-24T03:10:00Z'), { state: 'pending' }).alerts.length, 1);
});

test('over → under crossing creates exactly one alert; a small wobble creates none', async () => {
  const store = new MemoryStore();
  const run = (id: string, price: number, at: string) =>
    runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('x', price)] } }), store, mode: 'fixture', now: clockFrom(at), runId: id, log: () => {} });
  assert.equal((await run('a', 2500, '2026-09-24T00:00:00Z')).summary.alerts.created, 0);
  const b = await run('b', 1900, '2026-09-24T03:00:00Z');
  assert.equal(b.summary.alerts.created, 1);
  assert.equal(b.dashboard.alerts[0].trigger, 'first-under');
  assert.equal((await run('c', 1890, '2026-09-24T06:00:00Z')).summary.alerts.created, 0, '$10 wobble is not material');
  assert.equal((await run('d', 2500, '2026-09-24T09:00:00Z')).summary.alerts.created, 0, 'going over never alerts');
  const e = await run('e', 1900, '2026-09-24T12:00:00Z');
  assert.equal(e.summary.alerts.created, 1);
  assert.equal(e.dashboard.alerts.find((a) => a.state === 'pending')!.trigger, 'crossed-under');
  const f = await run('f', 1500, '2026-09-24T15:00:00Z');
  assert.equal(f.summary.alerts.created, 1, 'a real price drop is material');
  assert.equal(f.dashboard.alerts.filter((a) => a.state === 'pending').length, 1, 'the older version is superseded');
});

test('an auth failure stops live work; the run is failed, nothing is promoted, the last good manifest stays', async () => {
  const store = new MemoryStore();
  await runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('keep', 1500)] } }), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'good', log: () => {} });
  const before = store.objects.get(`${PREFIX}manifests/latest.json`);
  let browse = 0;
  const f = (async (url: any) => {
    if (String(url).includes('oauth2')) return new Response('bad client', { status: 401 });
    browse++; return jsonResponse({});
  }) as typeof fetch;
  const p = new EbayBrowseProvider({ clientId: 'id', clientSecret: 'SECRET-XYZ-123', env: 'production', marketplaceId: 'EBAY_US', fetchImpl: f });
  const r = await runScan({ provider: p, store, mode: 'live', now: clockFrom('2026-09-24T03:00:00Z'), runId: 'bad', log: () => {} });
  assert.equal(browse, 0);
  assert.equal(r.summary.state, 'failed');
  assert.equal(r.summary.promoted, false);
  assert.equal(store.objects.get(`${PREFIX}manifests/latest.json`), before, 'latest manifest untouched');
  assert.equal(r.summary.hunts.filter((h) => /skipped/.test(h.error ?? '')).length, 21);
  const row = r.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(row.state, 'failed');
  assert.equal(row.carried, true, 'failed coverage shows carried results, never "0 matches"');
  assert.equal(row.matchCount, 1);
  for (const [, body] of store.objects) assert.ok(!body.includes('SECRET-XYZ-123'), 'no secret in persisted artifacts');
  assert.ok(!JSON.stringify(r.dashboard).includes('SECRET-XYZ-123'));
});

test('a timed-out hunt is failed, others complete — partial run promotes with carry', async () => {
  const store = new MemoryStore();
  const r = await runScan({
    provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('ok', 1500)] }, 'art-saul-drawing': { error: 'timeout after 20000ms' } }),
    store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'p', log: () => {},
  });
  assert.equal(r.summary.state, 'partial');
  assert.equal(r.summary.huntsComplete, 21);
  assert.equal(r.summary.promoted, true);
  assert.equal(r.dashboard.hunts.find((h) => h.id === 'art-saul-drawing')!.state, 'failed');
  const empty = r.dashboard.hunts.find((h) => h.id === 'art-condo-drawing')!;
  assert.equal(empty.state, 'complete');
  assert.equal(empty.matchCount, 0, 'a searched hunt with nothing is a real 0');
});

test('a single-hunt run leaves the other 21 as they were', async () => {
  const store = new MemoryStore();
  await runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('one', 1500)] } }), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'all', log: () => {} });
  const r = await runScan({ provider: new FixtureProvider({}), store, mode: 'fixture', now: clockFrom('2026-09-24T01:00:00Z'), runId: 'solo', onlyHuntId: 'art-saul-drawing', log: () => {} });
  assert.equal(r.summary.hunts.filter((h) => h.state === 'not-searched').length, 21);
  const crumbRow = r.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(crumbRow.state, 'complete');
  assert.equal(crumbRow.matchCount, 1);
  assert.equal(r.dashboard.alerts.filter((a) => a.state === 'pending').length, 1, 'an unsearched hunt never expires its alerts');
});

test('manifest promotion is last: a failure writing the pointer leaves the previous manifest', async () => {
  const store = new MemoryStore();
  await runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('a', 1500)] } }), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'r1', log: () => {} });
  const before = store.objects.get(`${PREFIX}manifests/latest.json`);
  store.failOn = (k) => k.endsWith('manifests/latest.json');
  await assert.rejects(runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: [crumb('b', 1400)] } }), store, mode: 'fixture', now: clockFrom('2026-09-24T03:00:00Z'), runId: 'r2', log: () => {} }));
  assert.equal(store.objects.get(`${PREFIX}manifests/latest.json`), before);
  const order = store.writes.filter((k) => k.includes('r2') || k.endsWith('latest.json'));
  assert.ok(order.indexOf(`${PREFIX}manifests/r2.json`) >= 0, 'immutable run manifest written before the pointer');
});

test('page and API report the same run; staleness is computed at read time', async () => {
  const store = new MemoryStore();
  const r = await runScan({ provider: new FixtureProvider({}), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'same', staleAfterMinutes: 240, log: () => {} });
  const now = Date.parse('2026-09-24T01:00:00Z');
  assert.equal(statusResponse(r.dashboard, now).run.id, r.dashboard.run.id);
  assert.equal(huntsResponse(r.dashboard, now).run.id, r.dashboard.run.id);
  assert.equal(alertsResponse(r.dashboard, now, {}).run.id, r.dashboard.run.id);
  assert.equal(huntsResponse(r.dashboard, now).hunts.length, HUNTS.length);
  assert.equal(effectiveState(r.dashboard.run, now), 'success');
  assert.equal(effectiveState(r.dashboard.run, Date.parse('2026-09-24T05:00:00Z')), 'stale');
  assert.equal(r.dashboard.run.mode, 'fixture', 'fixture data is labeled');
});

test('alerts paginate with a stable cursor', async () => {
  const store = new MemoryStore();
  const items = Array.from({ length: 7 }, (_, i) => summary(`k${i}`, `Robert Crumb Original Ink Drawing sheet ${i}`, 1000 + i, 25));
  const r = await runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: items } }), store, mode: 'fixture', now: clockFrom('2026-09-24T00:00:00Z'), runId: 'pg', log: () => {} });
  const now = Date.parse('2026-09-24T00:30:00Z');
  const p1 = alertsResponse(r.dashboard, now, { limit: 3 });
  const p2 = alertsResponse(r.dashboard, now, { limit: 3, cursor: p1.nextCursor });
  const p3 = alertsResponse(r.dashboard, now, { limit: 3, cursor: p2.nextCursor });
  const ids = [...p1.alerts, ...p2.alerts, ...p3.alerts].map((a) => a.listingId);
  assert.equal(new Set(ids).size, 7);
  assert.equal(p3.nextCursor, null);
});

test('bad configuration fails before any provider call', async () => {
  let calls = 0;
  const provider = { kind: 'fixture' as const, health: () => ({ status: 'fixture' as const, calls }), search: async () => { calls++; throw new Error('should not run'); } };
  await assert.rejects(runScan({ provider, store: new MemoryStore(), mode: 'fixture', hunts: HUNTS.slice(1), log: () => {} }), /exactly 22/);
  assert.equal(calls, 0);
});
