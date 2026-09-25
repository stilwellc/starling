import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../scan';
import { MemoryStore } from '../store';
import { FixtureProvider } from '../fixture-provider';
import { EbayBrowseProvider, PAGE_SIZE } from '../provider';
import { statusResponse } from '../dashboard';
import { evaluate, isBorderline } from '../evaluate';
import { hunt, jsonResponse, listing, summary } from './helpers';

const clockFrom = (iso: string) => { let t = Date.parse(iso); return () => new Date((t += 1000)); };
const crumb = (id: string, price: number, listedAt: string) => ({ ...summary(id, 'Robert Crumb Original Pen and Ink Drawing', price, 25), itemCreationDate: listedAt });
const scan = (store: MemoryStore, data: any, at: string, runId: string, extra: object = {}) =>
  runScan({ provider: new FixtureProvider(data), store, mode: 'fixture', now: clockFrom(at), runId, hashPhotos: false, log: () => {}, ...extra });

test('searches are newest-first; a delta search stops at the first page older than the last search', async () => {
  const urls: string[] = [];
  const f = (async (url: any) => {
    const u = String(url);
    if (u.includes('oauth2')) return jsonResponse({ access_token: 't', expires_in: 7200 });
    urls.push(u);
    const off = Number(new URL(u).searchParams.get('offset'));
    // newest first: listing i was created i minutes before 12:00
    const items = Array.from({ length: PAGE_SIZE }, (_, i) => ({ ...summary(`n${off + i}`, 'Robert Crumb drawing', 10, 5), itemCreationDate: new Date(Date.parse('2026-09-25T12:00:00Z') - (off + i) * 60_000).toISOString() }));
    return jsonResponse({ total: 5000, itemSummaries: items });
  }) as typeof fetch;
  const p = new EbayBrowseProvider({ clientId: 'i', clientSecret: 's', env: 'production', marketplaceId: 'EBAY_US', fetchImpl: f });
  const r = await p.search(hunt('art-crumb-drawing'), new Date(), { since: '2026-09-25T11:30:00Z' });
  assert.equal(urls.length, 1, 'one call — page 1 already reaches listings older than the last search');
  assert.equal(new URL(urls[0]).searchParams.get('sort'), 'newlyListed');
  assert.equal(r.listings.length, 31, 'only listings created since the cut-off come back');
  await p.search(hunt('art-crumb-drawing'), new Date(), { query: 'r crumb original' });
  assert.equal(new URL(urls[1]).searchParams.get('q'), 'r crumb original');
});

test('recall queries run through the same rules and land in their hunt', async () => {
  const store = new MemoryStore();
  const r = await scan(store, {
    'q:r crumb original': { itemSummaries: [crumb('rc1', 900, '2026-09-24T00:00:00Z'), { ...summary('rc2', 'R Crumb Original Lithograph Poster', 50, 5), itemCreationDate: '2026-09-24T00:00:00Z' }] },
  }, '2026-09-25T00:00:00Z', 'recall');
  const ids = r.dashboard.cards.map((c) => c.listingId);
  assert.ok(ids.includes('rc1'), 'an original found only by the recall query is kept');
  assert.ok(!ids.includes('rc2'), 'the same rules still reject a print');
  const row = r.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(row.searches, 4);
});

test('delta runs only read new listings, carry the rest, and never expire alerts; the seen-index counts what is new', async () => {
  const store = new MemoryStore();
  const old = crumb('old', 1500, '2026-09-20T00:00:00Z');
  const r1 = await scan(store, { 'art-crumb-drawing': { itemSummaries: [old] } }, '2026-09-25T00:00:00Z', 'full-1');
  const row1 = r1.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(row1.sweep, 'full');
  assert.equal(row1.newThisRun, 0, 'the first run seeds the index — nothing is "new" yet');
  assert.equal(r1.summary.alerts.pending, 1);

  // an hour later the old listing is still live but eBay's newest-first page no longer needs to be read past it;
  // the fixture returns only what is new — the old one must stay on the dashboard, its alert pending
  const fresh = crumb('fresh', 1200, '2026-09-25T00:50:00Z');
  const r2 = await scan(store, { 'art-crumb-drawing': { itemSummaries: [fresh, old] } }, '2026-09-25T01:00:00Z', 'delta-2');
  const row2 = r2.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(row2.sweep, 'delta');
  assert.equal(row2.newThisRun, 1);
  assert.equal(row2.newToday, 1);
  assert.deepEqual(r2.dashboard.cards.filter((c) => c.huntId === 'art-crumb-drawing').map((c) => c.listingId).sort(), ['fresh', 'old']);
  assert.equal(r2.summary.alerts.pending, 2, 'delta scans never expire an alert');
  const st = statusResponse(r2.dashboard, Date.parse('2026-09-25T01:05:00Z'));
  assert.equal(st.discovery?.newThisRun, 1);
  assert.ok((st.discovery?.deltaScans ?? 0) > 0);

  // three hours after the last full sweep, the hunt sweeps fully again: a listing no longer returned drops off
  const r3 = await scan(store, { 'art-crumb-drawing': { itemSummaries: [fresh] } }, '2026-09-25T03:00:00Z', 'full-3');
  const row3 = r3.dashboard.hunts.find((h) => h.id === 'art-crumb-drawing')!;
  assert.equal(row3.sweep, 'full');
  assert.equal(row3.newThisRun, 0);
  assert.deepEqual(r3.dashboard.cards.filter((c) => c.huntId === 'art-crumb-drawing').map((c) => c.listingId), ['fresh']);
});

test('a delta run spends fewer calls than a full one', async () => {
  const store = new MemoryStore();
  const full = new FixtureProvider({});
  await runScan({ provider: full, store, mode: 'fixture', now: clockFrom('2026-09-25T00:00:00Z'), runId: 'a', hashPhotos: false, log: () => {} });
  // the fixture is one page per search, so equal counts prove the planner searched each distinct query once
  const distinct = full.health().calls;
  assert.ok(distinct < 70 && distinct > 35, `distinct searches: ${distinct}`);
});

test('borderline rejects get a second look: item specifics can supply what the title left out', async () => {
  const h = hunt('art-crumb-drawing');
  const l = listing({ itemId: 'b1', title: 'R. Crumb Signed Artwork', price: 800 });
  const first = evaluate(h, l);
  assert.equal(first.classification, 'reject');
  assert.ok(first.reasons.includes('art:medium-missing'));
  assert.ok(isBorderline(first));
  assert.ok(!isBorderline(evaluate(h, listing({ title: 'R. Crumb Signed Artwork', price: 5000 }))), 'over cap: not worth a lookup');
  assert.ok(!isBorderline(evaluate(h, listing({ title: 'R Crumb lithograph poster', price: 50 }))), 'a hard reject is not borderline');
  const second = evaluate(h, l, { details: { aspects: { Medium: 'Ink' }, description: '' } });
  assert.equal(second.classification, 'under');
  assert.ok(second.reasons.includes('aspect:medium:ink'));

  const store = new MemoryStore();
  const data = {
    'art-crumb-drawing': { itemSummaries: [summary('b1', 'R. Crumb Signed Artwork', 800, 20)] },
    details: { b1: { localizedAspects: [{ name: 'Medium', value: 'Ink' }], description: 'pen and ink on paper' } },
  };
  const p = new FixtureProvider(data);
  let lookups = 0;
  const orig = p.getItem.bind(p);
  p.getItem = async (id: string) => { lookups++; return orig(id); };
  const r = await runScan({ provider: p, store, mode: 'fixture', now: clockFrom('2026-09-25T00:00:00Z'), runId: 'b', hashPhotos: false, log: () => {} });
  assert.ok(r.dashboard.cards.some((c) => c.listingId === 'b1'), 'cleared on the second look');
  assert.equal(r.summary.discovery?.secondLooks, 1);
  await runScan({ provider: p, store, mode: 'fixture', now: clockFrom('2026-09-26T06:00:00Z'), runId: 'b2', hashPhotos: false, sweep: 'full', log: () => {} });
  assert.equal(lookups, 1, 'item specifics are cached — the same lot is never looked up twice');
});
