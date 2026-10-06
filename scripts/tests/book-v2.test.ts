/**
 * book-v2.test.ts — lectr value book v2 (emit-value-book BOOK_VERSION
 * 2026.10.06): row `variant` (cards) / `mat` (watches) purity, paired watch
 * references, and the STARLING_BOOK_PATH override + header fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { cardVariantConflict, cardVariantOf, sportsCardsMatcher } from '../match/sports-cards';
import { hasPairedReference, watchBookMaterial, watchMaterialConflict, watchesMatcher } from '../match/watches';
import { gate, closingGate, huntGate, REASON_KEY } from '../gate';
import { syncBook, normalizeBookRows, bookHeaderLine, loadBookFile } from '../sync-book';
import type { EbayListing, ValueBook, ValueBookRow } from '../types';

const NOW = Date.parse('2026-10-06T00:00:00Z');

function listing(title: string, extra: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'v1|1|0',
    title,
    price: 1000,
    currency: 'USD',
    shippingCost: 0,
    seller: { feedbackScore: 500, feedbackPercentage: 100 },
    aspects: [],
    enriched: false,
    marketplaceId: 'EBAY_US',
    ...extra,
  };
}

function row(over: Partial<ValueBookRow>): ValueBookRow {
  return {
    k: 'x', v: 'sports-cards', med: 3000, lo: 2500, hi: 3500, n: 10, n12: 4,
    lastSale: '2026-09-01', trend: null, conf: 'high', ...over,
  };
}

// ── cards: variant purity ────────────────────────────────────────────────────

const BASE = row({ k: 'mike-trout|2011|topps update|US175|PSA9', variant: '' });

test('cards: variant signature mirrors lectr parseCard tokens', () => {
  const v = cardVariantOf(listing('2011 Topps Update #US175 Mike Trout Gold Refractor Auto PSA 9'));
  assert.equal(v.auto, true);
  assert.deepEqual(v.parallel, ['color', 'refractor']);
  // the player's own name and colour-word teams never read as parallels
  const b = cardVariantOf(listing('1971 Topps #544 Vida Blue Oakland PSA 8'));
  assert.deepEqual(b.parallel, []);
  const s = cardVariantOf(listing('1975 Topps #192 Boston Red Sox Team PSA 8'));
  assert.deepEqual(s.parallel, []);
  // 'sp' is never a purity axis
  assert.deepEqual(cardVariantOf(listing('1957 Topps #77 Bill Russell Rookie SP')).parallel, []);
});

test('cards: base row rejects signed and parallel listings, keeps the base card', () => {
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout RC PSA 9'), BASE), null);
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Signed PSA 9'), BASE), 'auto-mismatch');
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Gold PSA 9'), BASE), 'parallel-mismatch');
  // eBay item-specifics count too
  assert.equal(
    cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout PSA 9', { aspects: [{ name: 'Autographed', value: 'Yes' }] }), BASE),
    'auto-mismatch',
  );
  assert.equal(
    cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout PSA 9', { aspects: [{ name: 'Parallel/Variety', value: 'Gold Refractor' }] }), BASE),
    'parallel-mismatch',
  );
});

test('cards: variant rows need the same signature (auto grade included)', () => {
  const autoRow = row({ variant: 'auto' });
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout PSA 9 Auto'), autoRow), null);
  // lectr's own lens: "Auto PSA 9" reads autograph grade 9 — a different pool
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Auto PSA 9'), autoRow), 'auto-mismatch');
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout PSA 9'), autoRow), 'auto-mismatch');
  const ag10 = row({ variant: 'auto|ag:10' });
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Signed PSA 9 Auto 10'), ag10), null);
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Signed PSA 9'), ag10), 'auto-mismatch');
  const refr = row({ variant: 'color+refractor' });
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Gold Refractor PSA 9'), refr), null);
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Refractor PSA 9'), refr), 'parallel-mismatch');
});

test('cards: old book (no variant field) → current behaviour, no check', () => {
  const old = row({});
  assert.equal(cardVariantConflict(listing('2011 Topps Update #US175 Mike Trout Gold Refractor Auto PSA 9'), old), null);
  assert.equal(sportsCardsMatcher.rowConflict!(listing('Mike Trout Auto'), old), null);
});

// ── watches: material purity + paired references ─────────────────────────────

const STEEL = row({ k: 'rolex|16610', v: 'watches', mat: 'steel' });

test('watches: material read the way lectr reads a sale', () => {
  assert.equal(watchBookMaterial(listing('Rolex Submariner 16610 Stainless Steel Watch')), 'steel');
  assert.equal(watchBookMaterial(listing('Rolex Submariner 16613 18k Gold and Stainless Steel')), 'two-tone');
  assert.equal(watchBookMaterial(listing('Patek Philippe 3940 Platinum Watch')), 'platinum');
  assert.equal(watchBookMaterial(listing('Rolex 16610 Watch', { aspects: [{ name: 'Case Material', value: 'Yellow Gold' }] })), 'gold');
  assert.equal(watchBookMaterial(listing('Rolex Submariner 16610 Watch')), null);
});

test('watches: a listing in another stated material is not the row', () => {
  assert.equal(watchMaterialConflict(listing('Rolex Submariner 16610 Stainless Steel Watch'), STEEL), null);
  assert.equal(watchMaterialConflict(listing('Rolex Submariner 16610 Watch'), STEEL), null); // unknown → no check
  assert.equal(watchMaterialConflict(listing('Rolex 16610 18K Yellow Gold Watch'), STEEL), 'material-mismatch');
  assert.equal(watchMaterialConflict(listing('Rolex 16610 Two-Tone Watch'), STEEL), 'material-mismatch');
  // old book / unstated row material → no check
  assert.equal(watchesMatcher.rowConflict!(listing('Rolex 16610 18K Yellow Gold Watch'), row({ v: 'watches' })), null);
});

test('watches: paired references abstain; slash suffixes stay', () => {
  for (const t of [
    'Rolex Submariner 5513/5517 Military Watch',
    'Vintage Rolex 5512/5513 Submariner Automatic',
    'Rolex 5513 / 5517 MilSub Watch',
  ]) {
    assert.ok(hasPairedReference(t), t);
    assert.equal(watchesMatcher.identify(listing(t)), null, t);
    assert.equal(watchesMatcher.rejectTitle!(t), 'paired reference', t);
  }
  for (const t of [
    'Patek Philippe Nautilus 5711/1A-010 Steel Watch',
    'Patek Philippe 3700/1 Nautilus Automatic Watch',
    'Patek Philippe 5723/112R Watch',
    'OMEGA Speedmaster 3590.50/ST145.022 Cal.861 Hand Winding Men\'s Watch',
  ]) {
    assert.equal(hasPairedReference(t), false, t);
  }
  assert.equal(watchesMatcher.identify(listing('Patek Philippe Nautilus 5711/1A Steel Watch')), 'patek-philippe|5711/1a');
  // the Reference Number item-specific can carry the pair too
  assert.equal(
    watchesMatcher.identify(listing('Rolex Submariner Military Watch', { aspects: [{ name: 'Reference Number', value: '5513/5517' }] })),
    null,
  );
});

// ── every gate enforces row purity, with a counted reason ────────────────────

test('gates: row conflicts fail with diagnosable reasons', () => {
  const l = listing('Rolex Submariner 16610 18K Yellow Gold Watch', { price: 1500 });
  const g = gate(l, STEEL, { now: NOW });
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'material-mismatch');
  assert.equal(REASON_KEY['material-mismatch'], 'materialMismatch');
  assert.equal(huntGate(l, {}, STEEL).reason, 'material-mismatch');
  assert.equal(
    closingGate({ ...l, itemEndDate: new Date(NOW + 3600e3).toISOString() }, STEEL, NOW).reason,
    'material-mismatch',
  );
  const card = listing('2011 Topps Update #US175 Mike Trout Auto PSA 9', { price: 1500 });
  assert.equal(gate(card, BASE, { now: NOW }).reason, 'auto-mismatch');
  assert.equal(REASON_KEY['auto-mismatch'], 'autoMismatch');
  assert.equal(REASON_KEY['parallel-mismatch'], 'parallelMismatch');
  // the same listing against an old-book row (no variant) still passes
  assert.equal(gate(card, row({}), { now: NOW }).pass, true);
});

// ── sync-book: STARLING_BOOK_PATH + v2 header ───────────────────────────────

const V2: ValueBook = {
  schema: 1,
  builtAt: '2026-10-05T06:00:00.000Z',
  engineVersion: 'e-test',
  bookVersion: '2026.10.06',
  rows: [
    row({ k: 'a|1|b|1|PSA9' }),
    row({ k: 'a|1|b|1|PSA10', variant: 'auto' }),
    row({ k: 'rolex|16610', v: 'watches', mat: 'steel' }),
  ],
  audit: { skipped: {}, abstained: {}, watchSplit: 0 },
};

test('sync-book: v2 base card rows become explicit; old books untouched', () => {
  const b = structuredClone(V2);
  normalizeBookRows(b);
  assert.equal(b.rows[0].variant, '');
  assert.equal(b.rows[1].variant, 'auto');
  assert.equal(b.rows[2].variant, undefined);
  const old = structuredClone(V2);
  delete old.bookVersion;
  normalizeBookRows(old);
  assert.equal(old.rows[0].variant, undefined);
  assert.match(bookHeaderLine(V2, 'file'), /builtAt=2026-10-05T06:00:00.000Z engineVersion=e-test bookVersion=2026\.10\.06/);
  assert.match(bookHeaderLine(old, 'fixture'), /bookVersion=n\/a/);
});

test('sync-book: STARLING_BOOK_PATH loads plain and gzipped books in either mode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'starling-book-'));
  const plain = join(dir, 'book.json');
  const gz = join(dir, 'book.json.gz');
  writeFileSync(plain, JSON.stringify(V2));
  writeFileSync(gz, gzipSync(Buffer.from(JSON.stringify(V2))));
  assert.equal(loadBookFile(gz).bookVersion, '2026.10.06');
  const prev = process.env.STARLING_BOOK_PATH;
  try {
    for (const p of [plain, gz]) {
      process.env.STARLING_BOOK_PATH = p;
      const s = await syncBook('fixture', NOW);
      assert.equal(s.source, 'file');
      assert.equal(s.book.rows.length, 3);
      assert.equal(s.byKey.get('a|1|b|1|PSA9')?.variant, '');
      assert.equal(s.byVertical.get('watches')?.length, 1);
      assert.equal(s.stale, false);
    }
    // live mode measures staleness on the file's own stamp
    process.env.STARLING_BOOK_PATH = gz;
    assert.equal((await syncBook('live', Date.parse('2026-10-20T00:00:00Z'))).stale, true);
  } finally {
    if (prev === undefined) delete process.env.STARLING_BOOK_PATH;
    else process.env.STARLING_BOOK_PATH = prev;
  }
});
