/**
 * autographs.ts — the VerticalMatcher for the 'autographs' vertical.
 *
 * lectr's largest NON-CARD corpus: RR Auction's 252K-lot 30-year sold archive is
 * mostly autographs, so the book is deep here and the comps are opaque — precision
 * of IDENTITY is the whole edge. But autographs are also the highest-forgery
 * pocket of the market: the failure mode is a confident match on the WRONG signer
 * or a REPRINT/AUTOPEN priced like the real hand. So identify() abstains hard, and
 * the risk model always carries the authentication axis.
 *
 * THE KEY: `<signerSlug>|<format>` where format ∈ als|tls|ans|aqs|ds|ls|check|sp|book.
 *   - format comes from a FAITHFUL port of lectr's autographFormatOf
 *     (Ray: app/lib/identity.ts lines 74-91). Order matters (ALS/TLS before the
 *     generic "letter signed") and the classic abbreviations are matched
 *     case-sensitively so "als"/"ds"/"ls"/"sp" inside ordinary words never fire.
 *   - signerSlug = slug() of the SIGNER's name, taken from the "Signed By"
 *     item-specific first, else extracted from the leading proper-noun phrase of
 *     the title (the run of name tokens before the first format/authentication
 *     word). ABSTAIN when the signer cannot be isolated OR the format is null —
 *     a wrong signer/format is worse than no match.
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

const VERTICAL: Vertical = 'autographs';

/**
 * autographFormatOf — FAITHFUL port of lectr's canon (Ray identity.ts 74-91).
 * RR mostly spells formats out; the abbreviations are matched case-sensitively so
 * "als"/"ds" inside ordinary words never fire. Order matters: ALS/TLS before the
 * generic "letter signed". Do not reorder or lowercase the abbreviation tests.
 */
function autographFormatOf(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title;
  if (/autograph(?:ed)? letter,? signed/i.test(t) || /\bALS\b/.test(t)) return 'als';
  if (/typed letter,? signed/i.test(t) || /\bTLS\b/.test(t)) return 'tls';
  if (/autograph(?:ed)? note,? signed/i.test(t) || /\bANS\b/.test(t)) return 'ans';
  if (/autograph(?:ed)? (?:quotation|quote|manuscript),? signed/i.test(t) || /\b(?:AQS|AMS|AMQS)\b/.test(t)) return 'aqs';
  if (/document,? signed|signed document/i.test(t) || /\bDS\b/.test(t)) return 'ds';
  if (/letter,? signed|signed letter/i.test(t) || /\bLS\b/.test(t)) return 'ls';
  if (/signed (?:check|bank check)|check,? signed/i.test(t)) return 'check';
  if (/signed (?:photo(?:graph)?|portrait)|photo(?:graph)?,? signed/i.test(t) || /\bSP\b/.test(t)) return 'sp';
  if (/signed book|book,? signed|signed (?:first|1st) edition/i.test(t)) return 'book';
  return null;
}

/** Format token → searchable phrase for queriesFor (the reverse of the canon). */
const FORMAT_PHRASE: Record<string, string> = {
  als: 'autograph letter signed',
  tls: 'typed letter signed',
  ans: 'autograph note signed',
  aqs: 'autograph quotation signed',
  ds: 'document signed',
  ls: 'letter signed',
  check: 'signed check',
  sp: 'signed photo',
  book: 'signed book',
};

/**
 * REPRODUCTION guard — a reprint / autopen / secretarial / facsimile is NOT a real
 * autograph and must never be keyed against the hand-signed book. (condition.ts
 * catches "reprint"/"replica" too, but autopen/secretarial/facsimile/preprint live
 * here so identify() itself abstains before any comp is drawn.)
 */
const REPRODUCTION_RE = /\b(reprint|re-print|reproduction|facsimile|fascimile|autopen|auto-pen|secretarial|pre-?print|photocopy|restrike|re-?strike)\b/i;

/**
 * Cut words: the first token that ends the signer's name — every format word, its
 * abbreviation, and the authentication/qualifier vocabulary that follows a name in
 * an eBay autograph title. Collection of name tokens stops at the first of these.
 */
const CUT_WORDS = new Set([
  // format vocabulary
  'signed', 'autograph', 'autographed', 'autographs', 'signature', 'autographe',
  'typed', 'handwritten', 'handwrote', 'letter', 'letters', 'document', 'documents',
  'note', 'notes', 'photo', 'photos', 'photograph', 'photographs', 'portrait',
  'quotation', 'quote', 'manuscript', 'check', 'cheque', 'book', 'card', 'index',
  'als', 'tls', 'ans', 'aqs', 'ams', 'amqs', 'ds', 'ls', 'sp', 'inscribed',
  'inscription', 'cut', 'album', 'page', 'first', '1st', 'edition',
  // authentication / qualifier vocabulary
  'psa', 'dna', 'jsa', 'beckett', 'bas', 'coa', 'loa', 'authentic', 'authenticated',
  'authentication', 'certified', 'certificate', 'certification', 'original',
  'vintage', 'rare', 'reprint', 'reproduction', 'facsimile', 'autopen',
]);

/** Lowercase particles allowed INSIDE a name once a name token has started. */
const NAME_PARTICLES = new Set([
  'de', 'van', 'von', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le',
  'el', 'bin', 'al', 'st', 'st.', 'mac', 'mc',
]);

/** True when a token is a capitalized name part (allows initials like "F." and
 *  hyphenated / apostrophized surnames). */
function isNameToken(tok: string): boolean {
  return /^[A-Z][A-Za-z'’.\-]*$/.test(tok);
}

/**
 * Extract the signer from the leading proper-noun phrase of the title: the run of
 * capitalized name tokens (plus interior particles) before the first cut word.
 * Requires ≥2 tokens so a lone leading word ("Vintage", "Historic") can't pass as
 * a signer — abstention is correct when the name can't be confidently isolated.
 */
function extractSignerFromTitle(title: string): string | null {
  const tokens = title.trim().split(/\s+/);
  const name: string[] = [];
  for (const tok of tokens) {
    const low = tok.toLowerCase().replace(/[.,]+$/, '');
    if (CUT_WORDS.has(low)) break;
    if (isNameToken(tok)) {
      name.push(tok);
      continue;
    }
    if (name.length > 0 && NAME_PARTICLES.has(low)) {
      name.push(tok);
      continue;
    }
    break; // a non-name token before any format word → name run has ended
  }
  // Drop a trailing particle ("... van") so it never dangles into the slug.
  while (name.length && NAME_PARTICLES.has(name[name.length - 1].toLowerCase().replace(/[.,]+$/, ''))) {
    name.pop();
  }
  if (name.length < 2) return null;
  return name.join(' ').replace(/[.,]+$/, '').trim();
}

/** Strip generational suffixes so the key matches lectr's book canon — the book
 *  canonicalizes "Martin Luther King, Jr." → martin-luther-king; we must too,
 *  or Jr./Sr. signers silently never join. */
function stripSuffix(name: string): string {
  return name
    .replace(/,?\s+(jr|sr|ii|iii|iv)\.?\s*$/i, '')
    .replace(/[.,]+\s*$/, '')
    .trim();
}

/** Resolve the signer: the "Signed By" item-specific first, else the title. */
export function resolveSigner(l: EbayListing): string | null {
  const fromAspect = aspect(l, 'Signed By') ?? aspect(l, 'Signed by') ?? aspect(l, 'Autographed By');
  if (fromAspect && fromAspect.trim() && !CUT_WORDS.has(fromAspect.trim().toLowerCase())) {
    return stripSuffix(fromAspect.trim());
  }
  const t = extractSignerFromTitle(l.title);
  return t ? stripSuffix(t) : null;
}

/** Everything the guards read: title + condition + item-specific VALUES.
 *  Aspect NAMES are deliberately excluded — eBay's standard "Original/
 *  Reproduction" specific carries the word "Reproduction" in its NAME on every
 *  listing (value "Original"), which would otherwise trip the reproduction guard
 *  on every genuine autograph. The dedicated Original/Reproduction VALUE check in
 *  identify() handles real reproductions. */
function haystackOf(l: EbayListing): string {
  return [l.title, l.condition, ...l.aspects.map((a) => a.value)]
    .filter(Boolean)
    .join(' ');
}

/** Title + condition + aspect VALUES only — used by the reproduction guard so the
 *  "Original/Reproduction" field NAME can't itself trip the reprint regex. */
function reproText(l: EbayListing): string {
  return [l.title, l.condition, ...l.aspects.map((a) => a.value)]
    .filter(Boolean)
    .join(' ');
}

/** Authenticators eBay autograph sellers name, longest/most-specific first so the
 *  captured label reads cleanly ("PSA/DNA", not "PSA"). */
const AUTHENTICATORS: { re: RegExp; name: string }[] = [
  { re: /psa\s*\/?\s*dna/i, name: 'PSA/DNA' },
  { re: /\bjsa\b|james spence/i, name: 'JSA' },
  { re: /beckett|\bbas\b/i, name: 'Beckett (BAS)' },
  { re: /\bpsa\b/i, name: 'PSA' },
  { re: /\bsgc\b/i, name: 'SGC' },
  { re: /roger epperson|\brea\b/i, name: 'Roger Epperson (REA)' },
];

const AUTH_LANGUAGE_RE =
  /\b(coa|c\.o\.a\.|loa|l\.o\.a\.|certificate of authenticity|letter of authenticity|authenticat\w*|certified)\b/i;

export const autographsMatcher: import('../types').VerticalMatcher = {
  vertical: VERTICAL,

  queriesFor(book: ValueBookRow[]): EbayQuery[] {
    return book
      .filter((r) => r.v === VERTICAL)
      .map((r) => {
        const [entitySlug = '', format = ''] = r.k.split('|');
        // de-slugify the signer: the key is the only place the name lives here.
        const entity = entitySlug.replace(/-/g, ' ').trim();
        const phrase = FORMAT_PHRASE[format] ?? 'signed';
        const q = `${entity} ${phrase}`.replace(/\s+/g, ' ').trim();
        return {
          key: r.k,
          q,
          // "14429" = Collectibles > Autographs > Original. Placeholder — the real
          // leaf ids get Taxonomy-resolved at P0 (see PROPOSAL §6).
          categoryIds: ['14429'],
          // buy-side band: reach well under the floor for the deep deals, and don't
          // chase anything much over the top of the conformal band.
          priceMin: Math.round(r.lo * 0.5),
          priceMax: Math.round(r.hi * 1.15),
        };
      });
  },

  identify(listing: EbayListing): IdentityKey | null {
    // Guard FIRST: a reprint / autopen / secretarial / facsimile is not a real
    // autograph — abstain before any comp is drawn.
    if (REPRODUCTION_RE.test(reproText(listing))) return null;
    const repro = aspect(listing, 'Original/Reproduction') ?? aspect(listing, 'Type');
    if (repro && /reproduction|reprint|facsimile|copy/i.test(repro)) return null;

    // Format from the canon — abstain if the title doesn't spell out a format.
    const format = autographFormatOf(listing.title);
    if (!format) return null;

    // Signer from the "Signed By" aspect, else the leading name phrase of the title.
    const signer = resolveSigner(listing);
    if (!signer) return null;

    const signerSlug = slug(signer);
    if (!signerSlug) return null;

    return `${signerSlug}|${format}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const haystack = haystackOf(listing);
    const notes: string[] = [];

    // Authentication is the single axis that separates a real autograph from a
    // forgery. A named LOA/COA/authenticator is the only real anchor here — there
    // is no slab. Everything else is raw.
    const authAspect =
      aspect(listing, 'Authentication') ??
      aspect(listing, 'Certification') ??
      aspect(listing, 'Authentication & Grading');
    const hasAuthLanguage = !!authAspect || AUTH_LANGUAGE_RE.test(haystack);

    let grader: string | undefined;
    for (const a of AUTHENTICATORS) {
      if (a.re.test(haystack)) {
        grader = a.name;
        break;
      }
    }

    const authenticityAnchor: AuthenticityAnchor =
      hasAuthLanguage || grader ? 'papers' : 'raw';

    if (grader) notes.push(`authenticator: ${grader}`);
    else if (hasAuthLanguage) notes.push('authentication named (unattributed)');

    if (REPRODUCTION_RE.test(reproText(listing))) notes.push('reprint/autopen/facsimile language present');

    // The autograph fake prior is high regardless of any anchor — scoreRisk applies
    // the per-vertical prior, but the reason must always be on the card.
    notes.push('autograph: authentication is the risk');
    if (authenticityAnchor === 'raw') notes.push('no LOA/COA/authenticator named — treat as unauthenticated');

    return {
      authenticityAnchor,
      grader,
      notes,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
