import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../evaluate';
import { runScan } from '../scan';
import { MemoryStore, PREFIX } from '../store';
import { FixtureProvider } from '../fixture-provider';
import { dHash, hamming, reusedPhotos } from '../enrich';
import { EbayBrowseProvider, PAGE_SIZE } from '../provider';
import { hunt, listing, summary, jsonResponse } from './helpers';

const clockFrom = (iso: string) => { let t = Date.parse(iso); return () => new Date((t += 1000)); };
const crumb = (id: string, price: number, seller = 'dealer') => ({ ...summary(id, 'Robert Crumb Original Pen and Ink Drawing', price, 25), seller: { username: seller, feedbackPercentage: '99.9', feedbackScore: 900 } });

test('item specifics: "Licensed Reprint" and print techniques reject; "Original" and authentication count', () => {
  const h = hunt('art-futura-painting');
  const l = listing({ title: 'Futura 2000 original painting on canvas', price: 3000 });
  assert.equal(evaluate(h, l, { details: { aspects: { 'Original/Licensed Reprint': 'Licensed Reprint' }, description: '' } }).classification, 'reject');
  assert.equal(evaluate(h, l, { details: { aspects: { 'Production Technique': 'Giclée' }, description: '' } }).classification, 'reject');
  const ok = evaluate(h, l, { details: { aspects: { 'Original/Licensed Reprint': 'Original', 'Production Technique': 'Acrylic Painting' }, description: '' } });
  assert.notEqual(ok.classification, 'reject');
  assert.ok(ok.reasons.includes('aspect:original'));
  const sp = evaluate(hunt('sports-hurts-jersey'), listing({ title: 'Jalen Hurts game worn Eagles jersey', price: 3000 }),
    { details: { aspects: { 'Autograph Authentication': 'Fanatics' }, description: '' } });
  assert.ok(!sp.flags.includes('no-authentication-in-title'), 'authentication in item specifics clears the flag');
});

test('description: provenance lowers forgery risk; reproduction language raises it', () => {
  const h = hunt('art-condo-drawing');
  const l = listing({ title: 'George Condo original drawing on paper', price: 6000 });
  assert.equal(evaluate(h, l).risk, 'medium');
  assert.equal(evaluate(h, l, { details: { aspects: {}, description: 'Provenance: acquired directly from the artist, 1998.' } }).risk, 'low');
  const repro = evaluate(h, l, { details: { aspects: {}, description: 'This is a high quality reproduction on archival paper.' } });
  assert.equal(repro.risk, 'high');
});

test('photo reuse and relists feed the risk rating', () => {
  const h = hunt('art-futura-painting');
  const l = listing({ title: 'Futura 2000 original painting on canvas', price: 3000 });
  assert.equal(evaluate(h, l, { flags: ['photo-reused:3'] }).risk, 'high');
  assert.equal(evaluate(h, l, { flags: ['relisted'] }).risk, 'medium');
});

test('dHash: identical images match, different images do not', () => {
  const img = (f: (x: number, y: number) => number, w = 64, h = 48) => {
    const d = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    return d;
  };
  const a = dHash(img((x) => x * 4), 64, 48);
  const b = dHash(img((x) => x * 4 + 3), 64, 48);
  const c = dHash(img((x, y) => ((x * 7 + y * 13) % 17) * 15), 64, 48);
  assert.ok(hamming(a, b) <= 6);
  assert.ok(hamming(a, c) > 6);
  const r = reusedPhotos(new Map([['i1', a], ['i2', b], ['i3', c]]));
  assert.deepEqual(r.get('i1'), ['i2']);
  assert.equal(r.get('i3'), undefined);
});

test('feedback: a dismissed listing and a blocked seller drop out; two dismissals learn a seller block', async () => {
  const store = new MemoryStore();
  const data = { 'art-crumb-drawing': { itemSummaries: [crumb('a', 1500, 'alice'), crumb('b', 1400, 'bob'), { ...crumb('c', 1300, 'carol'), title: 'Robert Crumb original ink drawing sheet two' }] } };
  const put = (k: string, v: unknown) => store.put(PREFIX + k, JSON.stringify(v));
  await put('feedback/dismiss/art-crumb-drawing__a.json', { seller: 'alice' });
  await put('feedback/seller/bob.json', { seller: 'bob' });
  const r = await runScan({ provider: new FixtureProvider(data), store, mode: 'fixture', now: clockFrom('2026-09-25T00:00:00Z'), runId: 'fb', hashPhotos: false, log: () => {} });
  assert.deepEqual(r.dashboard.cards.map((c) => c.listingId), ['c']);
  const ev = JSON.parse((await store.get(`${PREFIX}runs/fb/evaluations/art-crumb-drawing.json`))!);
  assert.ok(ev.find((e: any) => e.itemId === 'a').reasons.includes('dismissed-by-you'));
  assert.ok(ev.find((e: any) => e.itemId === 'b').reasons.includes('seller-blocked'));
  // two dismissals of carol → learned block, even for a listing you didn't dismiss
  await put('feedback/dismiss/art-crumb-drawing__x1.json', { seller: 'carol' });
  await put('feedback/dismiss/art-crumb-drawing__x2.json', { seller: 'carol' });
  const r2 = await runScan({ provider: new FixtureProvider(data), store, mode: 'fixture', now: clockFrom('2026-09-25T01:00:00Z'), runId: 'fb2', hashPhotos: false, log: () => {} });
  assert.equal(r2.dashboard.cards.length, 0);
});

test('price history and relists are tracked across runs', async () => {
  const store = new MemoryStore();
  const run = (id: string, items: any[], at: string) => runScan({ provider: new FixtureProvider({ 'art-crumb-drawing': { itemSummaries: items } }), store, mode: 'fixture', now: clockFrom(at), runId: id, hashPhotos: false, log: () => {} });
  await run('h1', [crumb('p1', 1800)], '2026-09-25T00:00:00Z');
  const r2 = await run('h2', [crumb('p1', 1500)], '2026-09-25T01:00:00Z');
  const c = r2.dashboard.cards.find((x) => x.listingId === 'p1')!;
  assert.equal(c.priceHistory!.length, 2);
  assert.deepEqual(c.priceChange, { from: 1825, to: 1525, since: c.priceHistory![0].at });
  // same seller relists the same title under a new item id
  const r3 = await run('h3', [crumb('p2', 1500)], '2026-09-25T02:00:00Z');
  const re = r3.dashboard.cards.find((x) => x.listingId === 'p2')!;
  assert.deepEqual(re.relisted?.previousItemIds, ['p1']);
  assert.ok(re.riskReasons.some((r) => /relisted/.test(r)));
});

test('item details are fetched for candidates, then cached', async () => {
  const store = new MemoryStore();
  const data = { 'art-crumb-drawing': { itemSummaries: [crumb('d1', 1500)] }, details: { d1: { localizedAspects: [{ name: 'Original/Licensed Reprint', value: 'Original' }], description: '<p>Provenance: from the collection of the artist</p>' } } };
  const p = new FixtureProvider(data);
  let lookups = 0;
  const orig = p.getItem.bind(p);
  p.getItem = async (id: string) => { lookups++; return orig(id); };
  const r = await runScan({ provider: p, store, mode: 'fixture', now: clockFrom('2026-09-25T00:00:00Z'), runId: 'd', hashPhotos: false, log: () => {} });
  const c = r.dashboard.cards.find((x) => x.listingId === 'd1')!;
  assert.equal(c.details?.aspects['Original/Licensed Reprint'], 'Original');
  assert.ok(c.reasons.includes('description:provenance'));
  assert.equal(c.risk, 'low', 'provenance in the description removes the forgery-prone penalty');
  await runScan({ provider: p, store, mode: 'fixture', now: clockFrom('2026-09-25T01:00:00Z'), runId: 'd2', hashPhotos: false, log: () => {} });
  assert.equal(lookups, 1, 'second run uses the 24h cache');
});

test('the run call ceiling limits later hunts to their first page', async () => {
  const page = (off: number) => Array.from({ length: PAGE_SIZE }, (_, i) => summary(`z${off + i}`, 'Robert Crumb drawing', 10, 5));
  const f = (async (url: any) => String(url).includes('oauth2') ? jsonResponse({ access_token: 't', expires_in: 7200 }) : jsonResponse({ total: 5000, itemSummaries: page(Number(new URL(String(url)).searchParams.get('offset'))) })) as typeof fetch;
  const p = new EbayBrowseProvider({ clientId: 'a', clientSecret: 'b', env: 'production', marketplaceId: 'EBAY_US', fetchImpl: f, callCeiling: 12 });
  const r1 = await p.search(hunt('art-crumb-drawing'), new Date());
  assert.equal(r1.pages, 10);
  const r2 = await p.search(hunt('art-saul-drawing'), new Date());
  assert.equal(r2.pages, 2, 'crossed the ceiling mid-hunt');
  const r3 = await p.search(hunt('art-condo-drawing'), new Date());
  assert.equal(r3.pages, 1);
  assert.match(r3.partialError ?? '', /ceiling/);
});
