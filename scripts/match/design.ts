/**
 * design.ts — the 'design' VerticalMatcher (best effort, abstain-heavy).
 *
 * Design had book keys and no matcher (same audit finding as watches), but the
 * pocket is smaller (144 keys) and the identity signal on eBay is weaker — no
 * slab, no reference aspect, just model codes and series names in prose titles.
 * So this matcher is deliberately the most abstain-heavy in the registry:
 * designer AND model key must BOTH resolve or identify() returns null. It has
 * no sweep slice yet; it identifies hunt-lane hits (and is ready the day a
 * slice + deeper book rows land).
 *
 * KEY FORMAT (source of truth: Ray emit-value-book.ts keyForLot, design branch):
 *   <designerSlug>|<modelKey>     e.g. "charles-eames|670", "george-nakashima|conoid"
 *     designerSlug — lectr's four design-market slugs (Ray constants.ts)
 *     modelKey     — Ray app/lib/comps.ts modelKey(), ported FAITHFULLY below
 *                    (three-rule ladder: alphanumeric code → "model N" → named
 *                    series word before a form noun). Keep in sync with lectr.
 */
import type {
  EbayListing,
  EbayQuery,
  IdentityKey,
  RiskSignals,
  ValueBookRow,
  Vertical,
  VerticalMatcher,
} from '../types';
import { conditionFlags } from '../lib/condition';

const VERTICAL: Vertical = 'design';

/** lectr's design-market makers (Ray constants.ts, market:'design'). */
const DESIGNERS: [RegExp, string][] = [
  [/\bnakashima\b/i, 'george-nakashima'],
  [/\beames\b/i, 'charles-eames'],
  [/\bprouv[eé]\b/i, 'jean-prouve'],
  [/\bjeanneret\b/i, 'pierre-jeanneret'],
];

// ── modelKey — FAITHFUL port of Ray app/lib/comps.ts (do not "improve") ─────
const MODEL_STOPWORDS = new Set([
  'a', 'an', 'the', 'pair', 'set', 'two', 'three', 'four', 'six', 'his', 'her',
  'walnut', 'teak', 'oak', 'rosewood', 'pine', 'maple', 'cherry', 'burl', 'laurel',
  'custom', 'rare', 'early', 'important', 'fine', 'exceptional', 'monumental',
  'large', 'small', 'long', 'low', 'high', 'tall', 'double', 'single', 'grand',
  'occasional', 'freeform', 'free-form', 'upholstered', 'illuminated', 'unique',
  'special', 'signed', 'vintage', 'original',
]);
const CODE_BLACKLIST = new Set(['no', 'ca', 'vol', 'lot', 'est', 'circa', 'in', 'of', 'at', 'to', 'by', 'as', 'for', 'and', 'the']);
const FORM_NOUNS =
  /(sofa|couch|settee|bench|daybed|stool|ottoman|chair|rocker|table|cabinet|chest|dresser|sideboard|credenza|desk|bed|headboard|lamp|sconce|chandelier|mirror|shelf|shelves|bookcase)/;

function modelKeyOf(title: string): string | null {
  const t = (title || '').toLowerCase();
  // 1 · alphanumeric model codes: lc2, lc-2, pk22, ch 24, pj-010100
  const code = t.match(/\b([a-z]{1,3})[-. ]?(\d{1,4})[a-z]?\b/);
  if (code && !CODE_BLACKLIST.has(code[1]) && !/^(19|20)\d\d$/.test(code[2])) {
    return `${code[1]}${code[2]}`;
  }
  // 2 · "model 123" / "model no. 45"
  const modelNo = t.match(/\bmodel\s+(?:no\.?\s*)?([a-z0-9-]{1,10})\b/);
  if (modelNo) return modelNo[1].replace(/-/g, '');
  // 3 · named series word immediately before the form noun
  const named = t.match(new RegExp('\\b([a-z][a-z-]{2,})\\s+' + FORM_NOUNS.source + 's?\\b'));
  if (named && !MODEL_STOPWORDS.has(named[1])) return named[1];
  return null;
}

/** Attribution hedges: "in the style of Eames", "after Prouvé", "Eames era" —
 *  the design market's reproduction problem. The designer's NAME appearing is
 *  not the designer's WORK; abstain when the title hedges. */
const ATTRIBUTION_HEDGE_RE =
  /\b(style of|in the style|after|manner of|attributed|inspired|era|type|reproduction|replica)\b/i;

export const designMatcher: VerticalMatcher = {
  vertical: VERTICAL,

  /** Sweep/hunt-fed — no per-key query plan (see watches.ts for the posture). */
  queriesFor(_book: ValueBookRow[]): EbayQuery[] {
    return [];
  },

  identify(listing: EbayListing): IdentityKey | null {
    const title = listing.title || '';
    if (ATTRIBUTION_HEDGE_RE.test(title)) return null;
    let designer: string | null = null;
    for (const [re, slug] of DESIGNERS) {
      if (re.test(title)) {
        designer = slug;
        break;
      }
    }
    if (!designer) return null;
    const mk = modelKeyOf(title);
    if (!mk) return null; // a maker without a model is a taste pool, not an identity
    return `${designer}|${mk}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const notes: string[] = [];
    if (ATTRIBUTION_HEDGE_RE.test(listing.title)) notes.push('attribution hedged in title');
    notes.push('design: attribution/reproduction is the risk — no slab exists');
    return {
      authenticityAnchor: 'raw', // no slab, no cert; provenance lives in the listing prose
      notes,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
