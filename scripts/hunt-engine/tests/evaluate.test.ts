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
