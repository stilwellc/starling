import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNTS, HUNT_LIST_META, ART_EXCLUDES, SPORTS_EXCLUDES, FOOTBALL_EXCLUDES, MANUAL_RESEARCH_BRIEF } from '../hunts';

// [id, query, titleMust, maxAllIn, section, scope] — the brief, pinned. Changing hunts.ts must change this table on purpose.
const PINNED: Array<[string, string, Array<string | string[]>, number | null, string, string]> = [
  ['art-haze-painting', 'eric haze painting', ['haze'], 5000, 'Paintings', 'canvas/board — acrylic, oil, spray'],
  ['art-haze-painting-misspell', 'erik haze painting', [['hayes', 'erik haze']], 5000, 'Paintings', 'canvas/board — acrylic, oil, spray'],
  ['art-futura-painting', 'futura 2000 painting', ['futura'], 15000, 'Paintings', 'canvas/board — acrylic, oil, spray'],
  ['art-futura-atoms', 'futura atoms canvas', ['futura'], 15000, 'Paintings', 'canvas/board — acrylic, oil, spray'],
  ['art-saul-painting', 'peter saul painting', ['saul'], 8000, 'Paintings', 'canvas/board — acrylic, oil, spray'],
  ['art-haze-drawing', 'eric haze drawing', ['haze'], 8000, 'Drawings', 'works on paper — marker, ink, pencil, pastel, crayon, gouache'],
  ['art-condo-drawing', 'george condo drawing', ['condo'], 10000, 'Drawings', 'works on paper — marker, ink, pencil, pastel, crayon, gouache'],
  ['art-saul-drawing', 'peter saul drawing', ['saul'], 2000, 'Drawings', 'works on paper — marker, ink, pencil, pastel, crayon, gouache'],
  ['art-crumb-drawing', 'robert crumb drawing', ['crumb'], 2000, 'Drawings', 'works on paper — marker, ink, pencil, pastel, crayon, gouache'],
  ['sports-ertz-jersey', 'zach ertz game used eagles jersey', ['ertz'], 3000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-hurts-jersey', 'jalen hurts game used eagles jersey', ['hurts'], 8000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-smith-jersey', 'devonta smith game used eagles jersey', ['smith'], 4000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-graham-jersey', 'brandon graham game used eagles jersey', ['graham'], 4000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-djackson-jersey', 'desean jackson game used eagles jersey', ['jackson'], 4000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-foles-eagles-jersey', 'nick foles game used eagles jersey', ['foles'], 4000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-foles-bears-jersey', 'nick foles game used bears jersey', ['foles'], 1500, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-foles-jaguars-jersey', 'nick foles game used jaguars jersey', ['foles'], 1500, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['sports-sb52-football', 'super bowl 52 game used football', [['super bowl', 'superbowl']], 6000, 'Game-used', 'True game-used only. Never game-issued, never replicas.'],
  ['design-pileo-lamp', 'pileo floor lamp artemide', ['pileo'], 300, 'Lighting', 'Artemide, Gae Aulenti'],
  ['design-sintesi-lamp', 'sintesi desk lamp vintage', ['sintesi'], 200, 'Lighting', 'Vintage desk lamp'],
  ['design-beaubourg-armchair', 'beaubourg armchair cadestin laurent', ['beaubourg'], 500, 'Seating', 'Michel Cadestin & Georges Laurent'],
  ['design-nakashima-seating', 'nakashima chair', ['nakashima'], 3000, 'Seating', 'All chairs and seating'],
];

const LAMP_X = ['shade only', 'parts', 'repair', 'bulb', 'reproduction', 'replica'];
const EXCLUDES: Record<string, string[]> = {
  'sports-foles-eagles-jersey': [...SPORTS_EXCLUDES, 'bears', 'jaguars'],
  'sports-foles-bears-jersey': [...SPORTS_EXCLUDES, 'eagles', 'jaguars'],
  'sports-foles-jaguars-jersey': [...SPORTS_EXCLUDES, 'eagles', 'bears'],
  'sports-sb52-football': FOOTBALL_EXCLUDES,
  'design-pileo-lamp': LAMP_X,
  'design-sintesi-lamp': LAMP_X,
  'design-beaubourg-armchair': ['style', 'reproduction', 'replica', 'inspired'],
  'design-nakashima-seating': ['style', 'reproduction', 'replica', 'inspired', 'book', 'magazine', 'poster', 'print'],
};

test('exactly 22 active hunts, in the pinned order', () => {
  assert.equal(HUNTS.filter((h) => h.active).length, 22);
  assert.deepEqual(HUNTS.map((h) => h.id), PINNED.map((p) => p[0]));
  assert.deepEqual(HUNTS.map((h) => h.priority), PINNED.map((_, i) => i + 1));
});

test('queries, title rules, caps, sections and scopes match the brief exactly', () => {
  for (const [id, q, must, cap, section, scope] of PINNED) {
    const h = HUNTS.find((x) => x.id === id)!;
    assert.equal(h.query, q, `${id} query`);
    assert.deepEqual(h.titleMust, must, `${id} titleMust`);
    assert.equal(h.maxAllIn, cap, `${id} cap`);
    assert.equal(h.section, section, `${id} section`);
    assert.equal(h.scope, scope, `${id} scope`);
    assert.equal(h.currency, 'USD');
    assert.deepEqual([...h.buyingModes], ['FIXED_PRICE', 'AUCTION']);
    const x = EXCLUDES[id] ?? (id.startsWith('art-') ? ART_EXCLUDES : SPORTS_EXCLUDES);
    assert.deepEqual(h.titleExcludes, x, `${id} exclusions`);
  }
});

test('the standard exclusion lists are the brief verbatim', () => {
  assert.deepEqual(ART_EXCLUDES, ['print', 'poster', 'lithograph', 'serigraph', 'screenprint', 'giclee', 'edition', 't-shirt', 'tshirt', 'merch', 'book', 'magazine', 'sticker']);
  assert.deepEqual(SPORTS_EXCLUDES, ['issued', 'replica', 'game style', 'game-style', 'facsimile', 'reprint', 'youth', 'toddler', 'mini', 'plaque', '8x10', 'coin', 'trading card', 'funko']);
  assert.deepEqual(FOOTBALL_EXCLUDES, ['replica', 'commemorative', 'facsimile', 'reprint', 'mini', 'photo', 'plaque', 'coin', 'trading card', 'funko', 'program', 'ticket']);
});

test('collection meta keeps the empty furniture subsection and cap semantics', () => {
  assert.deepEqual([...HUNT_LIST_META.sections.furniture.emptySubsections], ['Storage / Tables']);
  assert.match(HUNT_LIST_META.alertRule, /all-in: price plus shipping/);
  assert.equal(MANUAL_RESEARCH_BRIEF.externalSources.length, 22);
  assert.equal(MANUAL_RESEARCH_BRIEF.resultFields.length, 9);
});
