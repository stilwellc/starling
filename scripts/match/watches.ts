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

  identify(listing: EbayListing): IdentityKey | null {
    if (REPLICA_RE.test(listing.title)) return null;
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
