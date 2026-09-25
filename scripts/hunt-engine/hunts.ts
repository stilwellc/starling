/**
 * hunts.ts — THE HUNT LIST. This checked-in file is Starling's runtime source of
 * truth for the acquisition hunts (no Notion, no sync, no snapshot, no remote
 * fallback). It carries the whole brief, not just queries and caps: section
 * scopes, matching rules, exclusions, manual-research tactics, external sources,
 * the research result shape, the empty furniture subsection, and cap semantics.
 *
 * Editing rules: queries, titleMust, titleExcludes, scopes and maxes are pinned
 * by parity tests (tests/parity.test.ts) — a change here must change the test in
 * the same commit, on purpose.
 */

export type HuntVertical = 'art' | 'sports' | 'furniture';
export type BuyingMode = 'FIXED_PRICE' | 'AUCTION';

export type Hunt = {
  id: string;
  label: string;
  active: boolean;
  vertical: HuntVertical;
  section: string;
  scope: string;
  query: string;
  /** each outer entry is required; a nested array is a set of OR aliases */
  titleMust: Array<string | string[]>;
  titleExcludes: string[];
  /** all-in USD (item price + shipping, tax excluded); null = watch-only, no cap */
  maxAllIn: number | null;
  currency: 'USD';
  buyingModes: ReadonlyArray<BuyingMode>;
  priority: number;
  notes?: string[];
};

export type ManualResearchBrief = {
  tactics: string[];
  externalSources: string[];
  resultFields: string[];
  flags: string[];
};

export const HUNT_LIST_META = {
  title: 'The Hunt List',
  sourceOfTruth: 'This checked-in configuration is the source of truth for the hunt list.',
  alertRule:
    'Report anything listed at or under its max (an under). Blank means watching, with no cap. Maxes are all-in: price plus shipping.',
  sections: {
    art: {
      heading: 'ART',
      scope: 'Unique works only — no prints, editions, posters, or merch.',
      paintings: 'Paintings: canvas/board — acrylic, oil, spray.',
      drawings: 'Drawings: works on paper — marker, ink, pencil, pastel, crayon, gouache.',
    },
    sports: {
      heading: 'SPORTS — game-used',
      scope: 'True game-used only. Never game-issued, never replicas.',
      signedRule: 'Signed game-used is fine — only signed replicas are out.',
      photoRule: 'Photo is excluded except photo matched; photomatching is authenticity proof.',
    },
    furniture: {
      heading: 'FURNITURE',
      subsections: ['Lighting', 'Seating', 'Storage / Tables'],
      emptySubsections: ['Storage / Tables'],
    },
  },
} as const;

const BOTH = ['FIXED_PRICE', 'AUCTION'] as const;
export const ART_EXCLUDES = ['print', 'poster', 'lithograph', 'serigraph', 'screenprint', 'giclee', 'edition', 't-shirt', 'tshirt', 'merch', 'book', 'magazine', 'sticker'];
export const SPORTS_EXCLUDES = ['issued', 'replica', 'game style', 'game-style', 'facsimile', 'reprint', 'youth', 'toddler', 'mini', 'plaque', '8x10', 'coin', 'trading card', 'funko'];
export const FOOTBALL_EXCLUDES = ['replica', 'commemorative', 'facsimile', 'reprint', 'mini', 'photo', 'plaque', 'coin', 'trading card', 'funko', 'program', 'ticket'];

export const HUNTS: Hunt[] = [
  { id: 'art-haze-painting', label: 'Eric Haze — painting', active: true, vertical: 'art', section: 'Paintings', scope: 'canvas/board — acrylic, oil, spray', query: 'eric haze painting', titleMust: ['haze'], titleExcludes: ART_EXCLUDES, maxAllIn: 5000, currency: 'USD', buyingModes: BOTH, priority: 1 },
  { id: 'art-haze-painting-misspell', label: 'Eric Haze — painting (misspelled)', active: true, vertical: 'art', section: 'Paintings', scope: 'canvas/board — acrylic, oil, spray', query: 'erik haze painting', titleMust: [['hayes', 'erik haze']], titleExcludes: ART_EXCLUDES, maxAllIn: 5000, currency: 'USD', buyingModes: BOTH, priority: 2 },
  { id: 'art-futura-painting', label: 'Futura 2000 — painting', active: true, vertical: 'art', section: 'Paintings', scope: 'canvas/board — acrylic, oil, spray', query: 'futura 2000 painting', titleMust: ['futura'], titleExcludes: ART_EXCLUDES, maxAllIn: 15000, currency: 'USD', buyingModes: BOTH, priority: 3 },
  { id: 'art-futura-atoms', label: 'Futura 2000 — Atoms canvases', active: true, vertical: 'art', section: 'Paintings', scope: 'canvas/board — acrylic, oil, spray', query: 'futura atoms canvas', titleMust: ['futura'], titleExcludes: ART_EXCLUDES, maxAllIn: 15000, currency: 'USD', buyingModes: BOTH, priority: 4 },
  { id: 'art-saul-painting', label: 'Peter Saul — painting', active: true, vertical: 'art', section: 'Paintings', scope: 'canvas/board — acrylic, oil, spray', query: 'peter saul painting', titleMust: ['saul'], titleExcludes: ART_EXCLUDES, maxAllIn: 8000, currency: 'USD', buyingModes: BOTH, priority: 5 },
  { id: 'art-haze-drawing', label: 'Eric Haze — drawing', active: true, vertical: 'art', section: 'Drawings', scope: 'works on paper — marker, ink, pencil, pastel, crayon, gouache', query: 'eric haze drawing', titleMust: ['haze'], titleExcludes: ART_EXCLUDES, maxAllIn: 8000, currency: 'USD', buyingModes: BOTH, priority: 6 },
  { id: 'art-condo-drawing', label: 'George Condo — drawing', active: true, vertical: 'art', section: 'Drawings', scope: 'works on paper — marker, ink, pencil, pastel, crayon, gouache', query: 'george condo drawing', titleMust: ['condo'], titleExcludes: ART_EXCLUDES, maxAllIn: 10000, currency: 'USD', buyingModes: BOTH, priority: 7 },
  { id: 'art-saul-drawing', label: 'Peter Saul — drawing', active: true, vertical: 'art', section: 'Drawings', scope: 'works on paper — marker, ink, pencil, pastel, crayon, gouache', query: 'peter saul drawing', titleMust: ['saul'], titleExcludes: ART_EXCLUDES, maxAllIn: 2000, currency: 'USD', buyingModes: BOTH, priority: 8 },
  { id: 'art-crumb-drawing', label: 'Robert Crumb — drawing', active: true, vertical: 'art', section: 'Drawings', scope: 'works on paper — marker, ink, pencil, pastel, crayon, gouache', query: 'robert crumb drawing', titleMust: ['crumb'], titleExcludes: ART_EXCLUDES, maxAllIn: 2000, currency: 'USD', buyingModes: BOTH, priority: 9 },

  { id: 'sports-ertz-jersey', label: 'Zach Ertz — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'zach ertz game used eagles jersey', titleMust: ['ertz'], titleExcludes: SPORTS_EXCLUDES, maxAllIn: 3000, currency: 'USD', buyingModes: BOTH, priority: 10 },
  { id: 'sports-hurts-jersey', label: 'Jalen Hurts — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'jalen hurts game used eagles jersey', titleMust: ['hurts'], titleExcludes: SPORTS_EXCLUDES, maxAllIn: 8000, currency: 'USD', buyingModes: BOTH, priority: 11 },
  { id: 'sports-smith-jersey', label: 'DeVonta Smith — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'devonta smith game used eagles jersey', titleMust: ['smith'], titleExcludes: SPORTS_EXCLUDES, maxAllIn: 4000, currency: 'USD', buyingModes: BOTH, priority: 12 },
  { id: 'sports-graham-jersey', label: 'Brandon Graham — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'brandon graham game used eagles jersey', titleMust: ['graham'], titleExcludes: SPORTS_EXCLUDES, maxAllIn: 4000, currency: 'USD', buyingModes: BOTH, priority: 13 },
  { id: 'sports-djackson-jersey', label: 'DeSean Jackson — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'desean jackson game used eagles jersey', titleMust: ['jackson'], titleExcludes: SPORTS_EXCLUDES, maxAllIn: 4000, currency: 'USD', buyingModes: BOTH, priority: 14 },
  { id: 'sports-foles-eagles-jersey', label: 'Nick Foles — game-used Eagles jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'nick foles game used eagles jersey', titleMust: ['foles'], titleExcludes: [...SPORTS_EXCLUDES, 'bears', 'jaguars'], maxAllIn: 4000, currency: 'USD', buyingModes: BOTH, priority: 15 },
  { id: 'sports-foles-bears-jersey', label: 'Nick Foles — game-used Bears jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'nick foles game used bears jersey', titleMust: ['foles'], titleExcludes: [...SPORTS_EXCLUDES, 'eagles', 'jaguars'], maxAllIn: 1500, currency: 'USD', buyingModes: BOTH, priority: 16 },
  { id: 'sports-foles-jaguars-jersey', label: 'Nick Foles — game-used Jaguars jersey', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'nick foles game used jaguars jersey', titleMust: ['foles'], titleExcludes: [...SPORTS_EXCLUDES, 'eagles', 'bears'], maxAllIn: 1500, currency: 'USD', buyingModes: BOTH, priority: 17 },
  { id: 'sports-sb52-football', label: 'Super Bowl LII — game-used football', active: true, vertical: 'sports', section: 'Game-used', scope: HUNT_LIST_META.sections.sports.scope, query: 'super bowl 52 game used football', titleMust: [['super bowl', 'superbowl']], titleExcludes: FOOTBALL_EXCLUDES, maxAllIn: 6000, currency: 'USD', buyingModes: BOTH, priority: 18, notes: ['Also exclude replica, commemorative, program, and ticket.'] },

  { id: 'design-pileo-lamp', label: 'Pileo floor lamp', active: true, vertical: 'furniture', section: 'Lighting', scope: 'Artemide, Gae Aulenti', query: 'pileo floor lamp artemide', titleMust: ['pileo'], titleExcludes: ['shade only', 'parts', 'repair', 'bulb', 'reproduction', 'replica'], maxAllIn: 300, currency: 'USD', buyingModes: BOTH, priority: 19, notes: ['Artemide', 'Gae Aulenti'] },
  { id: 'design-sintesi-lamp', label: 'Sintesi desk lamp — vintage', active: true, vertical: 'furniture', section: 'Lighting', scope: 'Vintage desk lamp', query: 'sintesi desk lamp vintage', titleMust: ['sintesi'], titleExcludes: ['shade only', 'parts', 'repair', 'bulb', 'reproduction', 'replica'], maxAllIn: 200, currency: 'USD', buyingModes: BOTH, priority: 20 },
  { id: 'design-beaubourg-armchair', label: 'Beaubourg armchair', active: true, vertical: 'furniture', section: 'Seating', scope: 'Michel Cadestin & Georges Laurent', query: 'beaubourg armchair cadestin laurent', titleMust: ['beaubourg'], titleExcludes: ['style', 'reproduction', 'replica', 'inspired'], maxAllIn: 500, currency: 'USD', buyingModes: BOTH, priority: 21, notes: ['Michel Cadestin & Georges Laurent'] },
  { id: 'design-nakashima-seating', label: 'George Nakashima — chairs & seating (all)', active: true, vertical: 'furniture', section: 'Seating', scope: 'All chairs and seating', query: 'nakashima chair', titleMust: ['nakashima'], titleExcludes: ['style', 'reproduction', 'replica', 'inspired', 'book', 'magazine', 'poster', 'print'], maxAllIn: 3000, currency: 'USD', buyingModes: BOTH, priority: 22 },
];

export const MANUAL_RESEARCH_BRIEF: ManualResearchBrief = {
  tactics: [
    'Vague-seller-wording tactics cannot be automated queries; run these manually.',
    'graffiti art canvas signed',
    '1980s NYC street art painting',
    'estate find abstract spray paint',
    'Misspellings: Futura2000, Futura 2k, Eric Hayes.',
    'Estate/consignment listings where the seller does not know the artist.',
    'Instagram dealers: #futura2000, #georgecondo, #petersaul.',
    'Gallery closures and benefit auctions.',
  ],
  externalSources: [
    'Phillips', "Sotheby's", "Christie's", 'Bonhams', 'Swann', 'Heritage', 'Rago',
    'LiveAuctioneers', 'Invaluable', 'Bidsquare',
    'Wright', 'Hindman', 'Doyle', 'Stair Galleries',
    'Artcurial', 'Drouot', 'Piasa (Paris)',
    'Yahoo Auctions Japan / Mercari JP via Buyee',
    'Artnet Price Database', 'Artprice', 'MutualArt', 'askART',
  ],
  resultFields: [
    'title', 'year', 'medium', 'dimensions', 'venue', 'sale date',
    'estimate', 'hammer or sold price', 'link',
  ],
  flags: ['provenance', 'COA', 'signature', 'unique vs. print/multiple'],
};

/** Human-readable notes for the Hunt page / brief endpoint — the brief's meaning, verbatim in substance. */
export const HUNT_NOTES = {
  art: 'Unique works only — no prints, editions, posters, or merch. Standard exclusions on every art entry are print, poster, lithograph, serigraph, screenprint, giclee, edition, t-shirt, merch, book, magazine, and sticker.',
  paintings: 'Canvas/board; acrylic, oil, or spray.',
  drawings: 'Works on paper; marker, ink, pencil, pastel, crayon, or gouache.',
  sports: 'True game-used only. Never game-issued and never replicas. Standard exclusions are issued, replica, game style, facsimile, reprint, youth, toddler, mini, plaque, 8x10, coin, trading card, and Funko. Photo is excluded except photo matched; photomatching is authenticity proof. Signed game-used is fine; signed replicas are out.',
  furniture: 'Grouped as Lighting and Seating. Storage / Tables is an intentionally empty subsection — empty on purpose, not lost configuration.',
  researchShape: 'Research results record title, year, medium, dimensions, venue, sale date, estimate versus hammer/sold price, and link. Flag provenance, COA, signature, and unique versus print/multiple.',
  priceMax: 'Report anything listed at or under its max. A blank cap means watching with no cap. Every max is all-in: price plus shipping. Tax is excluded.',
} as const;

/** The collection-level true-game-used rule (sports), applied to every sports hunt on top of its own titleMust. */
export const GAME_USED_ALIASES = ['game used', 'game worn', 'gameused', 'gameworn'];
export const PHOTO_MATCH_ALIASES = ['photo matched', 'photomatched', 'photo match', 'photomatch'];
export const SUPER_BOWL_52_ALIASES = ['super bowl 52', 'super bowl lii', 'superbowl 52', 'superbowl lii', 'sb 52', 'sb lii', 'sblii'];
/** Evidence that meaningfully strengthens authenticity — a new appearance is a material alert change. */
export const AUTHENTICITY_EVIDENCE = [
  'photo matched', 'photomatched', 'photo match', 'photomatch', 'meigray', 'resolution photomatching',
  'coa', 'loa', 'psa dna', 'psa', 'jsa', 'beckett', 'bas', 'fanatics', 'mears', 'provenance', 'nfl auction', 'authenticated',
];
