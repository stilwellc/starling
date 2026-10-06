/**
 * board-audit.test.ts — regressions from the Oct 2026 frozen-board audit.
 * Every title below is a REAL listing that sat on the live board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchPartReason, watchesMatcher } from '../match/watches';
import { cardGradeAbstainReason, sportsCardsMatcher } from '../match/sports-cards';
import { isUnavailable, normalizeItem } from '../lib/normalize';
import { carryForward } from '../carry';
import type { Deal, EbayListing, ValueBookRow } from '../types';
import type { EbayClient } from '../lib/ebay-client';
import type { EbayRawItem } from '../lib/ebay-types';

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

// ── watches: parts / accessories / modified pieces never pin a reference ──────

const WATCH_PARTS = [
  'MK1 Type Bezel for Rolex Daytona 6263 ( 1969 -1988 ) and 6240.6241.6264.',
  'ROLEX DAYTONA WHITE 16518 16523 16528 DIAL DIAL DIAL DIAL DIAL GRACEFUL DIAL MK3 RARE',
  'ROLEX Finali End Links Jubilee 550 for GMT-MASTER 1675 16750',
  'Rolex Submariner Org. Zeiger 6536',
  'Authentic Rolex President Single Quick Set 3055 Movement Working Keeps time',
  'Vintage Patek Philippe 3544 18k Solid Yellow Gold Watch Case No Bezel For 23-300',
  'ROLEX Warranty Paper Booklet GMT-Master 16750',
  'ROLEX BOX WITH KIT AND WARRANTY TO FILL OUT FOR SUBMARINER 1680',
  'Rare Vintage 1960\'s Rolex Submariner Long 5 Bezel Insert 5512 5513 5508',
  'ROLEX REHAUT 18kt White Gold DAYTONA Black Index Blue Strap 116519 SANT BLANC',
  'Patek Philippe 5396G RARE Mint Blue Dial',
  'ROLEX SUBMARINER 5512 GILT DIAL',
  'ULTRA RARE ROLEX EXPLORER II 1655 ARROW SERVICE DIAL NOS',
  'Original Rolex Link Lady Datejust Pearlmaster Link 69298 18k Gold Rubellite',
  'Rolex Datejust 16018 Yellow Gold 1ct Diamond Bezel 750 K18 Replacement',
  'Unauthenticated Patek Philippe Nautilus Blue Men\'s Watch - 5811/1G-001',
  'GENUINE VINTAGE ROLEX 1500 OYSTER DATE 14k SOLID YELLOW GOL CASE BACK 34mm #782',
  'Vintage Rolex Movement Cal. 1530, 26J Same as Explorer! The Rest Included, 6582',
];

const WHOLE_WATCHES = [
  'Rolex Day-Date President MOP DIAMOND 36mm 18K White Gold Automatic Watch 18039',
  '1978 Rolex Submariner 1680 Black Matte Dial SS Oyster No Papers 40mm',
  'OMEGA Speedmaster 3590.50/ST145.022 Cal.861 Hand Winding Men\'s Watch_945738',
  'Patek Philippe Nautilus 5980 2007 Complete Bracelet Steel Blue-black Dial Auto',
  'Rolex Day-Date 18238 18K Yellow Gold Champagne Dial - Head Only',
  'June 2024 Rolex Submariner Date 126610LN 41mm Black Dial - Full Set Box Papers',
  'Rolex Submariner Date 16610 Stainless Steel Box & Papers 1998',
  'Rolex Day-Date 18238',
  'VINTAGE GENUINE ROLEX 16753 TWO TONE QUICK SET GMT MASTER 1981 #711',
  'Vintage Rolex Submariner Date 1680 Steel Black Oyster 40mm Watch Box with 2 extra links',
];

test('watch parts, accessories and modified pieces abstain', () => {
  for (const t of WATCH_PARTS) {
    assert.ok(watchPartReason(t), `should be a part: ${t}`);
    assert.equal(watchesMatcher.identify(listing(t)), null, `identify must abstain: ${t}`);
  }
});

test('whole watches still pin their reference', () => {
  for (const t of WHOLE_WATCHES) {
    assert.equal(watchPartReason(t), null, `should be a whole watch: ${t}`);
    assert.ok(watchesMatcher.identify(listing(t)), `identify should pin: ${t}`);
  }
  assert.equal(watchesMatcher.identify(listing(WHOLE_WATCHES[0])), 'rolex|18039');
});

// ── cards: qualified grades and unkeyable slabs abstain; clean slabs pin ──────

test('qualified grades and unkeyable slabs abstain', () => {
  const abstain = [
    '1968 Topps Nolan Ryan #177 New York Mets HOF ROOKIE PSA 9 (OC)',
    '1956 Topps #130 Willie Mays PSA 8 OC',
    '1952 Topps Mickey Mantle #311 PSA 2 MK',
    '1957 Topps Bill Russell #77 - SGC 50 VG/EX',
    '1957 Topps Bill Russell #77 RC Rookie Boston Celtics TGA 2.5 Good+',
    '1986 Fleer Michael Jordan #57 PSA Authentic',
    '1986 Fleer Michael Jordan #57 off-center PSA 7',
  ];
  for (const t of abstain) {
    assert.ok(cardGradeAbstainReason(t), `should abstain: ${t}`);
    assert.equal(sportsCardsMatcher.identify(listing(t)), null, `identify must abstain: ${t}`);
  }
});

test('clean slabs and raw cards still pin', () => {
  assert.equal(
    sportsCardsMatcher.identify(listing('1968 Topps Nolan Ryan #177 PSA 9')),
    'nolan-ryan|1968|topps|177|PSA9',
  );
  // "ST." is a city, not the ST (stain) qualifier
  assert.equal(cardGradeAbstainReason('1968 Topps Bob Gibson #100 PSA 9 St. Louis Cardinals'), null);
  assert.equal(
    sportsCardsMatcher.identify(listing('1957-58 Topps - Bill Russell #77 (RC)')),
    'bill-russell|1957|topps|77|raw',
  );
  // grader named, number unreadable → abstain, never "raw"
  assert.equal(
    sportsCardsMatcher.identify(
      listing('1952 Topps Mickey Mantle #311', { aspects: [{ name: 'Professional Grader', value: 'PSA' }] }),
    ),
    null,
  );
});

// ── eBay availability: a 200 can still be a sold / ended listing ──────────────

test('sold-out or ended getItem responses read as unavailable', () => {
  const base = { itemId: 'v1|9|0', title: 'x' } as EbayRawItem;
  assert.equal(isUnavailable({ ...base, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, NOW), true);
  assert.equal(isUnavailable({ ...base, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'AVAILABLE', estimatedRemainingQuantity: 0 }] }, NOW), true);
  assert.equal(isUnavailable({ ...base, itemEndDate: '2026-09-13T15:21:00Z' }, NOW), true);
  assert.equal(isUnavailable({ ...base, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'AVAILABLE' }] }, NOW), false);
  assert.equal(isUnavailable({ ...base, itemEndDate: '2026-11-01T00:00:00Z' }, NOW), false);
  assert.equal(isUnavailable(base, NOW), false); // unknown → never dropped on a guess
  assert.equal(normalizeItem({ ...base, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, 'EBAY_US', NOW).unavailable, true);
});

// ── carry: today's rules and today's book, not the first call forever ─────────

function deal(itemId: string, title: string, key: string, vertical: Deal['vertical'], med: number, allIn: number): Deal {
  return {
    id: itemId,
    itemId,
    vertical,
    key,
    title,
    allIn,
    itemPrice: allIn,
    shipping: 0,
    med,
    lo: med * 0.5,
    hi: med * 1.2,
    n: 20,
    n12: 5,
    lastSale: '2026-09-01',
    trend: null,
    conf: 'medium',
    depth: 1 - allIn / med,
    risk: { grade: 'B', score: 70, reasons: [] },
    edgeUsd: med - allIn,
    rank: 1,
    marketplace: 'EBAY_US',
    evidenceUrl: '',
    surfacedAt: '2026-08-22T00:00:00Z',
  };
}

test('carried deals re-earn their slot under current rules and the current book', async () => {
  const prev = {
    deals: [
      deal('a', 'ROLEX Warranty Paper Booklet GMT-Master 16750', 'rolex|16750', 'watches', 13107, 1621),
      deal('b', 'Rolex Day-Date 18238 18K Yellow Gold Watch 36mm', 'rolex|18238', 'watches', 35840, 15000),
      deal('c', 'Rolex Explorer II 16550 Steel Watch 40mm', 'rolex|16550', 'watches', 22929, 9010),
      deal('d', 'Rolex Submariner 1680 Steel Watch 40mm', 'rolex|1680', 'watches', 24320, 10000),
    ],
    huntNoBook: [],
    closing: [],
  };
  // today's book: 18238 re-priced DOWN (no longer deep), 16550 row unchanged,
  // 1680 row gone from the book
  const book = new Map<string, ValueBookRow>([
    ['rolex|16750', { k: 'rolex|16750', v: 'watches', med: 13107, lo: 9000, hi: 15000, n: 20, lastSale: '2026-09-01', trend: null, conf: 'medium' }],
    ['rolex|18238', { k: 'rolex|18238', v: 'watches', med: 17000, lo: 12000, hi: 22000, n: 40, lastSale: '2026-09-01', trend: null, conf: 'medium' }],
    ['rolex|16550', { k: 'rolex|16550', v: 'watches', med: 22929, lo: 15000, hi: 30000, n: 30, lastSale: '2026-09-01', trend: null, conf: 'high' }],
  ]);
  const client = {
    // every listing still "alive" on eBay at the same price
    getItems: async (ids: string[]) => ids.map((id) => {
      const d = prev.deals.find((x) => x.itemId === id)!;
      return listing(d.title, { itemId: id, price: d.itemPrice, shippingCost: 0 });
    }),
  } as unknown as EbayClient;
  const out = await carryForward(
    prev,
    {
      deals: [],
      huntDeals: [],
      huntClaimed: new Set(),
      recheck: (d, title) => {
        const why = watchesMatcher.rejectTitle?.(title);
        if (why) return { drop: `identity:${why}` };
        const row = book.get(d.key);
        return row ? { row } : { drop: 'book:row-gone' };
      },
    },
    { mode: 'live', client, now: NOW },
  );
  assert.deepEqual(out.deals.map((d) => d.itemId), ['c']);
  const c = out.deals[0];
  assert.equal(c.conf, 'high'); // re-stamped from today's row
  assert.equal(c.med, 22929);
});

test('without a recheck, carry keeps its legacy frozen-call behaviour', async () => {
  const prev = { deals: [deal('z', 'Rolex Explorer II 16550 Steel Watch 40mm', 'rolex|16550', 'watches', 22929, 9010)], huntNoBook: [], closing: [] };
  const client = { getItems: async () => [listing(prev.deals[0].title, { itemId: 'z', price: 9010 })] } as unknown as EbayClient;
  const out = await carryForward(prev, { deals: [], huntDeals: [], huntClaimed: new Set() }, { mode: 'live', client, now: NOW });
  assert.equal(out.deals.length, 1);
});
