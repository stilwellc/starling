/**
 * watches.ts — the 'watches' VerticalMatcher (the sweep rebuild's new vertical).
 *
 * The audit's sharpest finding: the book carried 1,278 watch keys and NOTHING
 * ever polled them, because no matcher existed. Watches are sweep-fed —
 * queriesFor() returns [] on purpose: the sweep engine (scripts/sweep.ts) pulls
 * category 31387 newly-listed and bulk-identifies here, so there is no per-key
 * query plan to compile.
 *
 * KEY FORMAT (source of truth: Ray app/lib/identity.ts numericWatchRef):
 *   <brandSlug>|<refLowercaseNoSpaces>     e.g. "rolex|16610", "patek-philippe|3940"
 *     brandSlug — the five maker slugs lectr's corpus carries (constants.ts):
 *                 rolex · patek-philippe · audemars-piguet · omega · cartier
 *     ref       — String(reference).toLowerCase().replace(/\s+/g,'') and it must
 *                 contain a digit. From the "Reference Number" item-specific
 *                 first, else a title regex (4-6 digits + optional letter tail).
 *
 * MATERIAL is deliberately NOT part of the key: the book rows are per-ref, so a
 * same-ref different-material listing still pins the ref's row. But material is
 * the price axis WITHIN a reference (a 3940 exists in three golds and platinum
 * at very different money), so watchMaterialCoarse (ported from Ray identity.ts)
 * always rides along as a riskInput note — priced in openly, never hidden.
 */
import { aspect } from '../types';
import type {
  AuthenticityAnchor,
  EbayListing,
  EbayQuery,
  IdentityKey,
  RiskSignals,
  ValueBookRow,
  Vertical,
  VerticalMatcher,
} from '../types';
import { conditionFlags } from '../lib/condition';

const VERTICAL: Vertical = 'watches';

/** The five maker slugs the book carries (Ray constants.ts, market:'watches').
 *  Longest-phrase first so "patek philippe" resolves before a bare "patek". */
const WATCH_BRANDS: [RegExp, string][] = [
  [/\bpatek\s*philippe\b|\bpatek\b/i, 'patek-philippe'],
  [/\baudemars\s*piguet\b/i, 'audemars-piguet'],
  [/\brolex\b/i, 'rolex'],
  [/\bomega\b/i, 'omega'],
  [/\bcartier\b/i, 'cartier'],
];

/** Fake/homage guard — a replica must never be keyed against the genuine book.
 *  (condition.ts catches "replica" at the gate too; abstaining HERE means no
 *  comp is ever drawn, same posture as the autographs reproduction guard.) */
const REPLICA_RE = /\b(replica|homage|fake|counterfeit|style of|inspired by)\b/i;

// ─────────────────────────────────────────────────────────────────────────────
// Parts / accessories / modified-watch guard (Oct 2026 audit)
//
// The book prices a REFERENCE — a whole, original watch. The live board was
// 196/200 watches and a large share were not watches at all: dials ("16518
// 16523 16528 DIAL DIAL"), bezels "for Rolex Daytona 6263", end links, hands
// ("Org. Zeiger"), cal. 3055 MOVEMENTS keyed as ref 3055, warranty booklets,
// empty boxes, Sant Blanc / "custom" modded pieces. Each pinned the ref's row
// and read 60–90% "under book". A part is never the reference: ABSTAIN.
// Bias is deliberate — a false abstain costs one listing, a false call costs
// the board's credibility.
// ─────────────────────────────────────────────────────────────────────────────

/** Explicit part / accessory / modification phrasing — fires on any title. */
const WATCH_PART_RES: [RegExp, string][] = [
  [/\b(?:for|fits?|compatible\s+with)\s+(?:a\s+)?(?:rolex|patek|omega|cartier|audemars|ap\b|daytona|gmt|submariner|sub\b|day-?date|datejust|explorer|sea-?dweller|milgauss|speedmaster|nautilus|royal\s+oak|president|\d{4,6})/i, 'part for another watch'],
  [/\b(?:fits|compatible)\b/i, 'compatibility listing'],
  [/\b(?:dial\s+only|service\s+dial|nos\s+dial|dial\s*(?:\+|&|and)\s*hands)\b/i, 'dial'],
  [/\bhands\b|\bhands?\s*set\b|\bzeiger\b/i, 'hands'],
  [/\bend\s*-?\s*links?\b|\bendlinks?\b/i, 'end links'],
  [/\b(?:bezel\s+)?insert\b/i, 'bezel insert'],
  [/\bmovement\b/i, 'movement'],
  [/\bcase\s*-?\s*back\b|\bcase\s+only\b|\bwatch\s+case\b|\bcase\s+no\s+bezel\b|\bcase$/i, 'case'],
  [/\bbooklet\b|\bwarranty\s+(?:paper|booklet|blank|card\s+only)\b|\bguarantee\b|\bpapers?\s+only\b/i, 'papers'],
  [/\bbox\s+only\b|\bempty\s+box\b|\bbox\s+with\s+kit\b|\bbox\s+(?:full\s+set\s+)?with\s+warranty\s+blank\b/i, 'box'],
  [/\b(?:for\s+)?parts\b|\bspare\b|\breplacement\b|\baftermarket\b|\bredial(?:ed)?\b|\bfranken\b|\bconversion\b|\bcustom(?:i[sz]ed)?\b|\bsant\s+blanc\b/i, 'modified / parts'],
  [/(?<!(?:extra|spare|additional|\d)\s*)\blinks?\b/i, 'link'],
  [/\bunauthenticated\b|\bnot\s+authentic\b/i, 'unauthenticated'],
];

/** Whole-watch evidence: a part title rarely carries any of these. */
const WHOLE_WATCH_RE =
  /\b(?:watch|wristwatch|timepiece|\d{2}(?:\.\d)?\s?mm|automatic|auto|self[- ]?winding|manual|hand[- ]?wind(?:ing)?|men'?s|mens|ladies|women'?s|unisex|serviced|overhauled|full\s+set|head\s+only|no\s+papers?|papers|b\s?&\s?p|jubilee|oyster|president)\b/i;

/** A component noun with NO whole-watch evidence anywhere in the title reads
 *  as the component itself ("Patek Philippe 5396G RARE Mint Blue Dial"). */
const COMPONENT_RE = /\b(?:dial|bezel|bracelet|crystal|crown|clasp|buckle|strap)\b/i;

/** Three+ distinct reference-shaped numbers = a compatibility list, the
 *  signature of a part ("116503 116528 116518 116508 BLUE DIAL"). */
function distinctRefs(title: string): number {
  const re = new RegExp(TITLE_REF_RE_SRC, 'gi');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const c = m[1].toLowerCase();
    if (/^(19|20)\d{2}$/.test(c)) continue;
    seen.add(c.replace(/[a-z]+$/, ''));
  }
  return seen.size;
}

/** Why this title is a part / accessory / modified watch, or null for a whole
 *  watch. Exported for tests and the carry re-check. */
export function watchPartReason(title: string): string | null {
  for (const [re, why] of WATCH_PART_RES) if (re.test(title)) return why;
  if (distinctRefs(title) >= 3) return 'compatibility list';
  // a caliber number with no whole-watch evidence is the movement for sale
  if (/\bcal(?:iber|ibre)?\.?\s*\d{3,4}\b/i.test(title) && !WHOLE_WATCH_RE.test(title)) return 'movement';
  if (COMPONENT_RE.test(title) && !WHOLE_WATCH_RE.test(title)) return 'component without whole-watch evidence';
  return null;
}

/** Brand from the "Brand" item-specific first, else the title. Exported for the
 *  sweep engine's enrichment shortlist (brand-hit-no-ref listings are worth a
 *  getItems call: the Reference Number aspect often pins what the title can't). */
export function watchBrandOf(l: EbayListing): string | null {
  const hay = aspect(l, 'Brand') ?? l.title;
  for (const [re, slug] of WATCH_BRANDS) if (re.test(hay)) return slug;
  return null;
}

/** numericWatchRef's normalization (Ray identity.ts): lowercase, strip spaces,
 *  must contain a digit. Applied to the aspect verbatim. */
function normRef(raw: string): string | null {
  const r = raw.toLowerCase().replace(/\s+/g, '');
  return /\d/.test(r) ? r : null;
}

/**
 * Title-side reference candidates: 4-6 digits + optional letter tail
 * ("16610", "116610ln", "15202st") or a slash variant ("5711/1a"). Filters:
 *   - a bare 4-digit 19xx/20xx is a YEAR, not a reference
 *   - case sizes never match (they're 2 digits + "mm")
 * First surviving candidate wins — eBay watch titles lead with the reference;
 * calibers/bracelet numbers trail it.
 */
const TITLE_REF_RE = /\b(\d{4,6}(?:[a-z]{1,4})?(?:\/\d{1,4}[a-z]?)?)\b/gi;
const TITLE_REF_RE_SRC = TITLE_REF_RE.source;

function refFromTitle(title: string): string | null {
  const re = new RegExp(TITLE_REF_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const cand = m[1].toLowerCase();
    if (/^(19|20)\d{2}$/.test(cand)) continue; // a year, not a ref
    return cand;
  }
  return null;
}

function resolveRef(l: EbayListing): string | null {
  const a = aspect(l, 'Reference Number');
  if (a && a.trim()) {
    const r = normRef(a);
    if (r) return r;
  }
  return refFromTitle(l.title);
}

/** Coarse case material — ported from Ray identity.ts watchMaterialCoarse
 *  (title+medium there; title + condition + the material item-specifics here,
 *  the same signal on the eBay surface). null = unknown. */
export function watchMaterialCoarse(l: EbayListing): string | null {
  const t = [l.title, l.condition, aspect(l, 'Case Material'), aspect(l, 'Band Material')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/\bplatinum\b/.test(t)) return 'platinum';
  if (/two[- ]tone|steel\s*(?:and|&|\/)\s*gold|gold\s*(?:and|&|\/)\s*steel/.test(t)) return 'two-tone';
  if (/\b(?:yellow|rose|pink|white)\s+gold\b|\b18k\b|\b14k\b|\bgold\b/.test(t)) return 'gold';
  if (/stainless|\bsteel\b/.test(t)) return 'steel';
  if (/\btitanium\b/.test(t)) return 'titanium';
  return null;
}

/** Box/papers language — the watch world's authentication anchor ('papers'). */
const PAPERS_RE =
  /box\s*(?:and|&|\+|,)?\s*papers|full\s+set|\bpapers\b|warranty\s+card|archive\s+extract|certificate\s+of\s+origin/i;

export const watchesMatcher: VerticalMatcher = {
  vertical: VERTICAL,

  /** Sweep-fed: the wide net (category 31387, newly listed) replaces per-key
   *  queries entirely. Returning [] keeps the contract honest — there is no
   *  query plan to starve or rotate. */
  queriesFor(_book: ValueBookRow[]): EbayQuery[] {
    return [];
  },

  rejectTitle(title: string): string | null {
    if (REPLICA_RE.test(title)) return 'replica';
    return watchPartReason(title);
  },

  identify(listing: EbayListing): IdentityKey | null {
    if (REPLICA_RE.test(listing.title)) return null;
    if (watchPartReason(listing.title)) return null; // a part is never the reference
    const brand = watchBrandOf(listing);
    if (!brand) return null;
    const ref = resolveRef(listing);
    if (!ref) return null; // brand without a reference is a model-line pool, not an identity
    return `${brand}|${ref}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const hay = [listing.title, listing.condition, ...listing.aspects.map((a) => a.value)]
      .filter(Boolean)
      .join(' ');
    const hasPapers = PAPERS_RE.test(hay);
    const authenticityAnchor: AuthenticityAnchor = hasPapers ? 'papers' : 'raw';

    const notes: string[] = [];
    const material = watchMaterialCoarse(listing);
    // Material is the intra-reference price axis — surfaced every time so a
    // gold 3940 against a mostly-steel pool is a visible caveat, never a
    // silent mis-comp. The key stays per-ref (book rows are per-ref).
    if (material) notes.push(`material: ${material}`);
    else notes.push('material unknown — ref pool spans materials');
    if (hasPapers) notes.push('box/papers language present (unverified)');
    notes.push('watch: condition/service state is unpriceable from a listing');

    return {
      authenticityAnchor,
      notes,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
