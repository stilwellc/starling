/**
 * art-editions.ts — the VerticalMatcher for the 'art-editions' vertical.
 *
 * HIGH-EDGE vertical: comps are opaque (few competitors can price editions), so
 * identity PRECISION is the whole game. We only ever pin a listing to a book row
 * when it is unmistakably ONE print/multiple from a numbered edition pool — a
 * unique original (an oil, a unique drawing) must NEVER enter this key, because
 * an original and its edition trade in different universes of money.
 *
 * editionIdentityKey + isEditionLot are ported faithfully from lectr's source of
 * truth (Ray: app/lib/identity.ts lines 53-72). Two deviations, both forced by
 * the eBay surface rather than the algorithm:
 *   1. lectr's AuctionLot.artist is already a slug; here the artist arrives as a
 *      display string from the "Artist" item-specific (or the title), so we
 *      slug() it — exactly the slug() every other matcher uses (lib/slug.ts).
 *   2. lectr's identity key joins the normalized title with spaces; the exported
 *      value-book key is slugged ("yayoi-kusama|pumpkin-yellow"), so the final
 *      normalized title is slug()'d to hyphens. The >=8 length gate still runs on
 *      the space-collapsed form, identically to lectr.
 *
 * isEditionLot's evidence axis, again forced by the surface: lectr reads formKey
 * + medium (structured fields); eBay scatters the same signal across the
 * "Type" / "Medium" / "Print Surface" / "Format" item-specifics plus the title
 * and condition string, so we fold all of them into the gate text.
 */
import { slug } from '../lib/slug';
import { conditionFlags } from '../lib/condition';
import { aspect } from '../types';
import type {
  EbayListing,
  EbayQuery,
  IdentityKey,
  RiskSignals,
  ValueBookRow,
  Vertical,
  AuthenticityAnchor,
} from '../types';

const VERTICAL: Vertical = 'art-editions';

/** Ported from lectr identity.ts isEditionLot() — the print/multiple gate. Only
 *  edition-structured lots may be keyed; anything else ABSTAINS. */
const EDITION_RE = /print|multiple|edition|poster|lithograph|screenprint|etching/;

/** Ported from lectr identity.ts editionIdentityKey() token strip. */
const EDITION_TOKEN_RE = /\b(ap|pp|hc|tp|ed\.?|edition|numbered|signed)\b/g;
const EDITION_NUMBERING_RE = /\b\d+\s*\/\s*\d+\b/g;
const PAREN_DATE_RE = /\([^)]*\d{4}[^)]*\)/g;

/** COA / certificate / authenticity language, in title or any item-specific. */
const COA_RE = /\b(coa|c\.o\.a\.|certificate of authenticity|certificate|authenticit)\w*/i;
const SIGNED_RE = /\bsigned\b/i;
const NUMBERED_RE = /\bnumbered\b|\b\d+\s*\/\s*\d+\b/i;

/** Split a listing title on a spaced dash / colon into [artist, ...rest]. Used
 *  only in the item-specifics-missing fallback path. */
function dashSplit(title: string): string[] {
  return title.split(/\s+[-–—:]\s+/);
}

/**
 * editionIdentityKey — faithful port of lectr's normalized edition title, then
 * slugged to the value-book key shape. Returns the normalized title token string
 * or null when it is shorter than 8 chars (too generic to pin).
 */
function normalizeEditionTitle(title: string): string | null {
  const t = title
    .toLowerCase()
    .replace(EDITION_NUMBERING_RE, '')
    .replace(EDITION_TOKEN_RE, '')
    .replace(PAREN_DATE_RE, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 8 ? t : null;
}

/** The gate text lectr reads from formKey+medium, gathered here from the eBay
 *  item-specifics that carry the same signal, plus title + condition. */
function editionGateText(l: EbayListing): string {
  return [
    aspect(l, 'Type'),
    aspect(l, 'Medium'),
    aspect(l, 'Print Surface'),
    aspect(l, 'Format'),
    l.title,
    l.condition,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Faithful port of isEditionLot over the gathered gate text. */
function isEditionLot(l: EbayListing): boolean {
  return EDITION_RE.test(editionGateText(l));
}

/** Resolve the artist display string: "Artist" item-specific, else the leading
 *  title tokens before a spaced dash. Returns null when neither is present — a
 *  keyless listing must abstain rather than guess. */
function resolveArtist(l: EbayListing): string | null {
  const fromAspect = aspect(l, 'Artist');
  if (fromAspect && fromAspect.trim()) return fromAspect.trim();
  const parts = dashSplit(l.title);
  if (parts.length > 1 && parts[0].trim()) return parts[0].trim();
  return null;
}

/** Resolve the artwork title string: "Title" / "Print Name" item-specific, else
 *  the listing title with a leading "Artist - " stripped when the artist was
 *  itself recovered from that dash (so the medium/artist words don't pollute the
 *  normalized key). */
function resolveTitle(l: EbayListing, usedTitleForArtist: boolean): string {
  const fromAspect = aspect(l, 'Title') ?? aspect(l, 'Print Name');
  if (fromAspect && fromAspect.trim()) return fromAspect.trim();
  if (usedTitleForArtist) {
    const parts = dashSplit(l.title);
    if (parts.length > 1) return parts.slice(1).join(' ').trim();
  }
  return l.title;
}

export const artEditionsMatcher: import('../types').VerticalMatcher = {
  vertical: VERTICAL,

  queriesFor(book: ValueBookRow[]): EbayQuery[] {
    return book
      .filter((r) => r.v === VERTICAL)
      .map((r) => {
        const [artistSlug = '', titleSlug = ''] = r.k.split('|');
        // de-slugify: the key is the only place these strings live, so we rehydrate
        // the artist name and the surviving title words for a free-text query.
        const artist = artistSlug.replace(/-/g, ' ').trim();
        const titleWords = titleSlug.replace(/-/g, ' ').trim();
        const q = `${artist} ${titleWords}`.replace(/\s+/g, ' ').trim();
        return {
          key: r.k,
          q,
          // "360" = Art > Art Prints (leaf). Placeholder — the real leaf ids for
          // each edition sub-market get Taxonomy-resolved at P0 (see PROPOSAL §6).
          categoryIds: ['360'],
          // buy-side band: reach well under the floor for the deep deals, and don't
          // chase anything much over the top of the conformal band.
          priceMin: Math.round(r.lo * 0.5),
          priceMax: Math.round(r.hi * 1.15),
        };
      });
  },

  identify(listing: EbayListing): IdentityKey | null {
    // Gate FIRST: if this is not clearly an edition (print/multiple/poster/…),
    // abstain. A unique original must never receive an edition key.
    if (!isEditionLot(listing)) return null;

    const artist = resolveArtist(listing);
    if (!artist) return null;

    const usedTitleForArtist = !aspect(listing, 'Artist');
    const titleRaw = resolveTitle(listing, usedTitleForArtist);

    const normTitle = normalizeEditionTitle(titleRaw);
    if (!normTitle) return null; // <8 chars → too generic to pin

    return `${slug(artist)}|${slug(normTitle)}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const haystack = [
      listing.title,
      ...listing.aspects.map((a) => `${a.name} ${a.value}`),
    ].join(' ');

    const hasCoa = COA_RE.test(haystack);
    // Art has no slab; the only real authentication anchor is a certificate /
    // LOA (edition papers). Everything else is raw.
    const authenticityAnchor: AuthenticityAnchor = hasCoa ? 'papers' : 'raw';

    const notes: string[] = [];
    if (SIGNED_RE.test(haystack)) notes.push('signed');
    if (NUMBERED_RE.test(haystack)) notes.push('numbered');
    if (hasCoa) notes.push('COA / certificate named');
    // Art carries a higher fake prior than a graded card — flag it every time.
    notes.push('art: verify edition & COA');

    return {
      authenticityAnchor,
      notes,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
