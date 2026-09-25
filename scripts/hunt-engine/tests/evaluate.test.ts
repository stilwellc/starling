import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../evaluate';
import { normalizeText, hasPhrase } from '../text';
import { hunt, listing } from './helpers';

const ev = (id: string, title: string, extra: Parameters<typeof listing>[0] extends infer P ? Partial<P & object> : never = {}) =>
  evaluate(hunt(id), listing({ title, ...extra }));

test('normalization is case- and punctuation-tolerant', () => {
  const t = normalizeText('GAME-WORN, Photo-Matched!! (Eagles)');
  assert.ok(hasPhrase(t, 'game worn'));
  assert.ok(hasPhrase(t, 'photo matched'));
  assert.ok(hasPhrase(t, 'EAGLES'));
  assert.ok(!hasPhrase(normalizeText('painting'), 'print'));
  assert.ok(hasPhrase(normalizeText('two prints'), 'print'));
});

test('art rejects prints, editions and merch', () => {
  assert.equal(ev('art-futura-painting', 'Futura 2000 screenprint signed').classification, 'reject');
  assert.equal(ev('art-futura-painting', 'Futura Limited Edition canvas').classification, 'reject');
  assert.equal(ev('art-haze-painting', 'Eric Haze T-Shirt vintage').classification, 'reject');
  assert.equal(ev('art-haze-painting', 'Eric Haze merch bundle').classification, 'reject');
  const ok = ev('art-haze-painting', 'Eric Haze Original Acrylic on Canvas Painting');
  assert.notEqual(ok.classification, 'reject');
  assert.ok(ok.reasons.includes('must:haze'));
});

test('misspelled Haze lane takes Hayes or "erik haze"', () => {
  assert.notEqual(ev('art-haze-painting-misspell', 'Eric Hayes graffiti painting on canvas').classification, 'reject');
  assert.notEqual(ev('art-haze-painting-misspell', 'Erik Haze spray paint canvas').classification, 'reject');
  assert.equal(ev('art-haze-painting-misspell', 'Eric Haze painting').classification, 'reject');
});

test('sports: game-used required, game worn accepted, issued rejected', () => {
  assert.notEqual(ev('sports-hurts-jersey', 'Jalen Hurts Game Worn Eagles Jersey MeiGray').classification, 'reject');
  assert.notEqual(ev('sports-hurts-jersey', 'Jalen Hurts game-used Eagles jersey').classification, 'reject');
  const noGu = ev('sports-hurts-jersey', 'Jalen Hurts Eagles Jersey Nike');
  assert.equal(noGu.classification, 'reject');
  assert.ok(noGu.reasons.includes('sports:not-game-used'));
  assert.equal(ev('sports-hurts-jersey', 'Jalen Hurts Game Issued Eagles Jersey').classification, 'reject');
});

test('sports: ordinary photo rejected, photo matched accepted', () => {
  const photo = ev('sports-ertz-jersey', 'Zach Ertz game used jersey with photo');
  assert.equal(photo.classification, 'reject');
  assert.ok(photo.reasons.includes('sports:photo-not-matched'));
  const pm = ev('sports-ertz-jersey', 'Zach Ertz Game Used Eagles Jersey Photo-Matched Resolution');
  assert.notEqual(pm.classification, 'reject');
  assert.ok(pm.reasons.includes('photo-matched'));
  // football list excludes "photo" — photo matched still passes
  assert.notEqual(ev('sports-sb52-football', 'Super Bowl LII game used football photo matched').classification, 'reject');
  assert.equal(ev('sports-sb52-football', 'Super Bowl 52 game used football photo').classification, 'reject');
});

test('sports: signed game-used accepted, signed replica rejected', () => {
  const signed = ev('sports-graham-jersey', 'Brandon Graham Signed Game Used Eagles Jersey JSA');
  assert.notEqual(signed.classification, 'reject');
  assert.ok(signed.reasons.includes('signed'));
  assert.equal(ev('sports-graham-jersey', 'Brandon Graham Signed Replica Eagles Jersey').classification, 'reject');
});

test('Foles lanes are isolated by team', () => {
  const eagles = 'Nick Foles Game Used Eagles Jersey';
  const bears = 'Nick Foles Game Used Bears Jersey';
  const jags = 'Nick Foles Game Used Jaguars Jersey';
  assert.notEqual(ev('sports-foles-eagles-jersey', eagles).classification, 'reject');
  assert.equal(ev('sports-foles-eagles-jersey', bears).classification, 'reject');
  assert.equal(ev('sports-foles-eagles-jersey', jags).classification, 'reject');
  assert.notEqual(ev('sports-foles-bears-jersey', bears).classification, 'reject');
  assert.equal(ev('sports-foles-bears-jersey', eagles).classification, 'reject');
  assert.notEqual(ev('sports-foles-jaguars-jersey', jags).classification, 'reject');
  assert.equal(ev('sports-foles-jaguars-jersey', bears).classification, 'reject');
});

test('Super Bowl aliases count as title evidence; game-used still required', () => {
  assert.notEqual(ev('sports-sb52-football', 'Superbowl LII Eagles game used football').classification, 'reject');
  assert.equal(ev('sports-sb52-football', 'Super Bowl LII official football').classification, 'reject');
  assert.ok(ev('sports-sb52-football', 'Super Bowl game used football').flags.includes('sb-number-unconfirmed'));
});

test('furniture rejects style, reproduction and replica', () => {
  assert.equal(ev('design-nakashima-seating', 'Nakashima style chair walnut').classification, 'reject');
  assert.equal(ev('design-nakashima-seating', 'George Nakashima reproduction conoid chair').classification, 'reject');
  assert.equal(ev('design-pileo-lamp', 'Pileo lamp replica').classification, 'reject');
  assert.notEqual(ev('design-nakashima-seating', 'George Nakashima Grass Seat Chair 1960').classification, 'reject');
});

test('R. Crumb cap is $2,000 all-in: at the cap is an under, a cent over is over', () => {
  const at = ev('art-crumb-drawing', 'Robert Crumb original drawing', { price: 1950, shipping: 50 });
  assert.equal(at.classification, 'under');
  assert.equal(at.allIn, 2000);
  assert.equal(at.underBy, 0);
  const over = ev('art-crumb-drawing', 'Robert Crumb original drawing', { price: 1950, shipping: 50.01 });
  assert.equal(over.classification, 'over');
  const under = ev('art-crumb-drawing', 'Robert Crumb original drawing', { price: 1500, shipping: 100 });
  assert.equal(under.underBy, 400);
  assert.equal(under.underPct, 0.2);
  assert.equal(under.taxExcluded, true);
});

test('missing shipping never becomes an under', () => {
  const e = ev('art-crumb-drawing', 'Robert Crumb original drawing', { price: 10, shipping: null });
  assert.equal(e.classification, 'watch');
  assert.equal(e.allIn, null);
  assert.ok(e.flags.includes('shipping-unknown'));
});

test('fixed-price says "under cap"; auctions say "under cap now"', () => {
  assert.equal(ev('art-crumb-drawing', 'Robert Crumb drawing', { price: 100 }).capWording, 'under cap');
  const a = ev('art-crumb-drawing', 'Robert Crumb drawing', { price: 100, buyingMode: 'AUCTION' });
  assert.equal(a.capWording, 'under cap now');
  assert.ok(a.flags.includes('auction-price-moves'));
});

// ── collection-level rules, from real titles in the first live run (2026-09-25) ──
test('sports: relic and swatch cards are not game-used jerseys', () => {
  for (const t of [
    'Jalen Hurts GAME USED JERSEY CARD #11/15 Donovan McNabb 2024 LEAF PHILADELPHIA',
    'Jalen Hurts Game-Used Swatch Jersey Fusion Philadelphia Eagles',
    '2022 Jersey Fusion Jalen Hurts Game Worn Pants Swatch Philadelphia Eagles',
    'Jalen Hurts 2022 Panini Contenders - 2025 Jersey Fusion Game Used Swatch Eagles',
  ]) assert.equal(ev('sports-hurts-jersey', t).classification, 'reject', t);
  for (const t of [
    'DESEAN JACKSON 2020 ABSOLUTE ABSOLUTE BURNERS EAGLES GAME WORN JERSEY PATCH /25!',
    '2019 Panini Playoff DeSean Jackson Game Day Game Worn Jersey ! Eagles',
    'DeSEAN JACKSON 2013 Momentum Materials Game-Used Jersey #65 107/199',
  ]) assert.equal(ev('sports-djackson-jersey', t).classification, 'reject', t);
  assert.notEqual(ev('sports-hurts-jersey', 'Jalen Hurts 2023 Game Worn Eagles Jersey Photo Matched Fanatics').classification, 'reject');
});

test('Super Bowl lane: another Super Bowl or a non-football object is out', () => {
  assert.equal(ev('sports-sb52-football', 'Authentic Super Bowl 55 LV Tampa Bay Kansas City B&W Game Used PLAY SHEETS BRADY').classification, 'reject');
  assert.equal(ev('sports-sb52-football', 'Super Bowl LII game used towel Eagles').classification, 'reject');
  assert.notEqual(ev('sports-sb52-football', 'Super Bowl LII Game Used Football Eagles Patriots').classification, 'reject');
});

test('art: publications, keyword stuffing and surname-only hits are out', () => {
  assert.equal(ev('art-crumb-drawing', 'The Sweeter Side of R. Crumb (2006, Robert Crumb) hardcover').classification, 'reject');
  assert.equal(ev('art-crumb-drawing', 'Robert Crumb Lot of 3 Vintage 1992 Postcards - Kitchen Sink Press').classification, 'reject');
  assert.equal(ev('art-crumb-drawing', 'R. Crumb Draws The Blues Paperback').classification, 'reject');
  assert.equal(ev('art-condo-drawing', 'GEORGE CONDO: Paintings and Drawings 1988 The Pace Gallery catalog').classification, 'reject');
  assert.equal(ev('art-futura-painting', 'Phobia Original Graffiti Art Barry McGee Futura 2000 Irak Cope2 Retna Doze Green').classification, 'reject');
  assert.equal(ev('art-futura-painting', 'James Top NYC Graffiti Art Dondi Futura 2000 Eric Haze Zephyr Revolt Revs').classification, 'reject');
  assert.equal(ev('art-saul-painting', 'Peter Gould "Better Call Saul" Creator AUTOGRAPH Signed 8x10 Photo').classification, 'reject');
  assert.equal(ev('art-saul-painting', "Peter's Song by Carol P. Saul (1992, Hardcover)").classification, 'reject');
  const real = ev('art-futura-painting', 'SIGNED Futura 2000 Hand Drawn Original Drawing Point Man blackbook pages nyc', { price: 990, shipping: 24 });
  assert.notEqual(real.classification, 'reject');
  assert.ok(real.reasons.includes('claims-original'));
});

test('art: a price far below the cap is flagged for review, not trusted', () => {
  const e = ev('art-condo-drawing', 'George Condo (Handmade) Drawing On old Paper Signed & Stamped', { price: 110, shipping: 10 });
  assert.notEqual(e.classification, 'reject');
  assert.ok(e.flags.includes('price-far-below-market'));
  assert.equal(e.review, 'review');
});

test('furniture: catalogs and books are not furniture', () => {
  assert.equal(ev('design-nakashima-seating', "Sotheby's 20th C. Art Design Deco Nouveau Tiffany Nakashima Auction Catalog 2002").classification, 'reject');
  assert.equal(ev('design-nakashima-seating', 'George Nakashima The Soul of a Tree Popular Edition Wood Furniture Chair').classification, 'reject');
  assert.notEqual(ev('design-nakashima-seating', '1949 George Nakashima for Knoll N19 Straight Chair in Solid Birch').classification, 'reject');
});

test('art: the title must show a medium or object from the brief scope', () => {
  assert.equal(ev('art-crumb-drawing', 'The Sweeter Side of R. Crumb').classification, 'reject');
  assert.equal(ev('art-crumb-drawing', 'R CRUMB DRAWS THE BLUES ~ A BRILLIANT GRAPHIC NOVEL!').classification, 'reject');
  assert.notEqual(ev('art-crumb-drawing', 'Robert Crumb Eat It Spot Illustration Page Original Art 1974', { price: 1500 }).classification, 'reject');
  assert.notEqual(ev('art-futura-atoms', 'FUTURA ATOMIC RINGS Large Size Canvas Art', { price: 2000 }).classification, 'reject');
});

test('furniture: design books naming other designers are out', () => {
  assert.equal(ev('design-nakashima-seating', 'Chairs Nelson George 1953 George Nakashima Ole Wanscher BBPR').classification, 'reject');
  assert.equal(ev('design-nakashima-seating', 'Modern furnishings for the Home 1952 Furniture chairs George Nakashima Eames').classification, 'reject');
});

test('same-seller repeats fold into one card', async () => {
  const { collapseDuplicates } = await import('../scan');
  const { evaluate } = await import('../evaluate');
  const mk = (id: string, price: number) => { const l = listing({ itemId: id, title: 'Robert Crumb original ink drawing', price, seller: { username: 'spam', feedbackPercentage: 99, feedbackScore: 50 } }); return { listing: l, evaluation: evaluate(hunt('art-crumb-drawing'), l) }; };
  const obs: import('../types').Observation[] = [mk('a', 150), mk('b', 120), mk('c', 130)];
  collapseDuplicates(obs);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].listing.itemId, 'b');
  assert.deepEqual(obs[0].similar, ['c', 'a']);
});

test('fake risk: Condo and Crumb without provenance are never low; the fake template and cheap copies are high', () => {
  const tpl = ev('art-condo-drawing', 'George Condo (Handmade) Drawing On old Paper Signed & Stamped', { price: 110, shipping: 10 });
  assert.equal(tpl.risk, 'high');
  assert.ok(tpl.riskReasons.some((r) => /fake-art listing template/.test(r)));
  const cheap = ev('art-crumb-drawing', 'Robert Crumb original ink drawing signed', { price: 300, shipping: 20 });
  assert.equal(cheap.risk, 'high', 'Crumb at 15% of cap is priced like a fake');
  const mid = ev('art-crumb-drawing', 'Robert Crumb original ink drawing signed', { price: 1600, shipping: 20 });
  assert.equal(mid.risk, 'medium');
  assert.ok(mid.riskReasons.some((r) => /heavily forged/.test(r)));
  const prov = ev('art-condo-drawing', 'George Condo original drawing on paper, provenance Skarstedt gallery label', { price: 8000, shipping: 50 });
  assert.equal(prov.risk, 'low');
  assert.equal(ev('art-futura-painting', 'SIGNED Futura 2000 Hand Drawn Original Drawing Point Man', { price: 990, shipping: 24 }).risk, 'low');
});

test('fake risk: folded same-seller copies of a "unique" work are high', async () => {
  const { collapseDuplicates } = await import('../scan');
  const { evaluate } = await import('../evaluate');
  const mk = (id: string, price: number) => { const l = listing({ itemId: id, title: 'Futura 2000 original spray painting on canvas', price, seller: { username: 'repeat', feedbackPercentage: 100, feedbackScore: 900 } }); return { listing: l, evaluation: evaluate(hunt('art-futura-painting'), l) }; };
  const obs: import('../types').Observation[] = [mk('a', 2000), mk('b', 2100)];
  assert.equal(obs[0].evaluation.risk, 'low');
  collapseDuplicates(obs);
  assert.equal(obs[0].evaluation.risk, 'high');
  assert.ok(obs[0].evaluation.riskReasons.some((r) => /2 copies of a “unique” work/.test(r)));
});
