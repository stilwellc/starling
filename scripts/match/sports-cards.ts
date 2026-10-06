/**
 * sports-cards.ts — the 'sports-cards' VerticalMatcher.
 *
 * Pins an eBay Buy-It-Now listing to an exact lectr value-book key and abstains
 * otherwise. Cards are the most competitive vertical (comps are easy for
 * everyone), so this matcher is deliberately precise: a wrong match is the only
 * real failure mode, so every required axis must be present or identify()
 * returns null. The anti-cards-trap budget guard lives in the scheduler, NOT
 * here — this file's only job is honest, exact identity.
 *
 * KEY FORMAT (source of truth: Ray repo scripts/sub-markets.ts:230-237 cardKey):
 *   <playerSlug>|<year>|<set>|<cardNo>|<grade>
 *     playerSlug — slug() of the athlete name (lib/slug.ts)
 *     year       — 4-digit season year
 *     set        — setName.toLowerCase().replace(/\s+/g,' ').trim()  (NOT slugged)
 *     cardNo     — the card number, verbatim
 *     grade      — `${gradeCompany}${gradeNum}` (e.g. "PSA6") or "raw"
 *   e.g. "mickey-mantle|1952|topps|311|PSA6"
 * The optional "/serial" parallel suffix is out of scope for v1 (see cardKey).
 */

import {
  aspect,
  type AuthenticityAnchor,
  type EbayListing,
  type EbayQuery,
  type IdentityKey,
  type RiskSignals,
  type RowConflictReason,
  type ValueBookRow,
  type VerticalMatcher,
} from '../types';
import { slug } from '../lib/slug';
import { conditionFlags } from '../lib/condition';

// ─────────────────────────────────────────────────────────────────────────────
// Aspect lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** First non-empty aspect value across a list of candidate aspect names. */
function firstAspect(l: EbayListing, names: string[]): string | undefined {
  for (const n of names) {
    const v = aspect(l, n);
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

const PLAYER_ASPECTS = ['Player/Athlete', 'Player', 'Athlete', 'Subject'];
const YEAR_ASPECTS = ['Season', 'Year', 'Set Year', 'Year Manufactured', 'Card Year'];
const SET_ASPECTS = ['Set', 'Set Name', 'Product'];
const CARDNO_ASPECTS = ['Card Number', 'Card #', 'Card No', 'Card No.', 'Number'];
const GRADER_ASPECTS = ['Professional Grader', 'Grade Company', 'Grader', 'Grading Company'];
const GRADE_ASPECTS = ['Grade', 'Grade Number', 'Card Grade', 'Numerical Grade'];
const CERT_ASPECTS = ['Certification Number', 'Cert Number', 'Cert #', 'Certification #'];

// ─────────────────────────────────────────────────────────────────────────────
// Set canonicalization
//
// lectr canonicalizes setName upstream before building the key (e.g. hockey's
// "O-Pee-Chee" becomes "opc"). Starling can't see that upstream step, so a SMALL
// alias map bridges the common eBay phrasings to the book's set token. This is
// canonicalization, never identity guessing — anything not in the map just gets
// lowercased-and-single-spaced exactly like cardKey does.
// ─────────────────────────────────────────────────────────────────────────────

const SET_ALIAS: Record<string, string> = {
  'o-pee-chee': 'opc',
  'opc': 'opc',
  'o pee chee': 'opc',
};

function canonSet(raw: string): string {
  const base = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return SET_ALIAS[base] ?? base;
}

/** Multi-word terms first so "topps chrome" beats "topps" when both could match. */
const SET_TERMS = [
  'topps chrome',
  'bowman chrome',
  'upper deck',
  'o-pee-chee',
  'panini prizm',
  'topps',
  'bowman',
  'fleer',
  'opc',
  'prizm',
  'donruss',
  'score',
  'select',
  'panini',
].sort((a, b) => b.length - a.length);

interface SetHit {
  raw: string;
  end: number;
}

/** Find the longest known set term in a title; returns its raw text + end index. */
function findSetInTitle(title: string): SetHit | undefined {
  const lower = title.toLowerCase();
  for (const term of SET_TERMS) {
    const idx = lower.indexOf(term);
    if (idx >= 0) return { raw: title.slice(idx, idx + term.length), end: idx + term.length };
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade parsing
// ─────────────────────────────────────────────────────────────────────────────

const GRADERS: [RegExp, string][] = [
  [/\b(psa|professional sports authenticator)\b/i, 'PSA'],
  [/\b(bgs|bvg|beckett)\b/i, 'BGS'],
  [/\b(sgc)\b/i, 'SGC'],
  [/\b(cgc)\b/i, 'CGC'],
];

/** Map any grader phrasing to its short code, or undefined. */
function normGrader(s: string | undefined): string | undefined {
  if (!s) return undefined;
  for (const [re, code] of GRADERS) if (re.test(s)) return code;
  return undefined;
}

/** Extract a numeric card grade token (10, 9, 8.5, …) from a string. */
function parseGradeNum(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/\b(10|[1-9](?:\.5)?)\b/);
  return m ? m[1] : undefined;
}

/** Grader + grade number pulled straight from a title, e.g. "PSA 9". */
function titleGrade(title: string): { co: string; num: string } | undefined {
  const m = title.match(/\b(PSA|BGS|BVG|SGC|CGC)\s*(10|[1-9](?:\.5)?)\b/i);
  if (!m) return undefined;
  return { co: normGrader(m[1])!, num: m[2] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extractors — aspects first, title as fallback (never guess)
// ─────────────────────────────────────────────────────────────────────────────

function extractPlayer(l: EbayListing): string | undefined {
  const a = firstAspect(l, PLAYER_ASPECTS);
  if (a) return slug(a);
  // Title fallback: the name sits between the set term and the "#cardNo".
  const setHit = findSetInTitle(l.title);
  const hash = l.title.search(/#\s?[A-Za-z0-9]+/);
  if (!setHit || hash < 0 || hash <= setHit.end) return undefined;
  let seg = l.title.slice(setHit.end, hash);
  seg = seg
    .replace(/\b(19|20)\d{2}(?:-\d{2})?\b/g, ' ')
    .replace(/\b(PSA|BGS|BVG|SGC|CGC)\s*\d+(?:\.5)?\b/gi, ' ')
    .replace(
      /\b(rookie|rc|hof|hall of fame|auto(?:graph)?|refractor|prizm|insert|sp|ssp|gem|mint|mt|nm|card|the)\b/gi,
      ' ',
    )
    .trim();
  const s = slug(seg);
  // Require at least first-last so we never pin identity on a single stray token.
  if (!s || s.split('-').length < 2) return undefined;
  return s;
}

function extractYear(l: EbayListing): string | undefined {
  const a = firstAspect(l, YEAR_ASPECTS);
  const m = (a ?? l.title).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : undefined;
}

function extractSet(l: EbayListing): string | undefined {
  const a = firstAspect(l, SET_ASPECTS);
  if (a) return canonSet(a);
  const hit = findSetInTitle(l.title);
  return hit ? canonSet(hit.raw) : undefined;
}

function extractCardNo(l: EbayListing): string | undefined {
  const a = firstAspect(l, CARDNO_ASPECTS);
  if (a) {
    const m = a.match(/#?\s*([A-Za-z0-9]+)/);
    if (m) return m[1];
  }
  const t = l.title.match(/#\s?([A-Za-z0-9]+)/);
  return t ? t[1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade-identity guards (Oct 2026 audit)
//
// The board's #1 card was "1968 Topps Nolan Ryan #177 … PSA 9 (OC)" keyed PSA9
// and read 70% under the clean PSA 9 median — an (OC) qualifier is a different,
// far cheaper item (lectr's own extractor says so: extract/prompt.ts). And
// "Bill Russell … SGC 50 VG/EX" / "… TGA 2.5" keyed as RAW because the grader
// or the old SGC 100-point number didn't parse — a slab is never "raw".
// A grade we can't read exactly is an identity we can't pin: ABSTAIN.
// ─────────────────────────────────────────────────────────────────────────────

/** PSA/BGS/SGC qualifiers (lectr extract/schema.ts QUALIFIERS), written next
 *  to the grade: "PSA 9 (OC)", "PSA 8 OC", "PSA 7 MK", "PSA 8 Off-Center". */
const QUALIFIER_RE =
  /\b(?:PSA|BGS|BVG|SGC|CGC)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-?MT\+?|NM|EX-?MT|EX|VG-?EX|VG|GOOD|FR|PR)?\s*(?:10|[1-9](?:\.5)?)\s*\(?\s*(?:OC|MK|ST|PD|MC|OF)\b(?!\.)\)?|\boff[- ]?cent(?:er|re)d?\b|\(\s*(?:OC|MK|ST|PD|MC|OF)\s*\)/i;

/** Slab graders this matcher can't key (lectr's book keys PSA/BGS/SGC/CGC and
 *  rarely CSG/HGA) plus authentic-only / altered slabs. */
const UNKEYED_SLAB_RE =
  /\b(?:TGA|GMA|KSA|ISA|MNT|AGS|PGI|PGS|HGA|CSG|TAG|RCG|SCG|GAI|BCCG|FCG|PRO\s*GRADE)\b|\b(?:PSA|BGS|SGC|CGC)\s*(?:AUTH(?:ENTIC)?|A\b|ALTERED|N\d)|\bSGC\s*(?:[2-9]\d|100)\b/i;

export function hasGradeQualifier(title: string): boolean {
  return QUALIFIER_RE.test(title);
}

/** Why this card listing's grade identity can't be pinned, or null. */
export function cardGradeAbstainReason(title: string): string | null {
  if (QUALIFIER_RE.test(title)) return 'grade qualifier';
  if (UNKEYED_SLAB_RE.test(title)) return 'unkeyable slab';
  return null;
}

/** "PSA6"-style token, "raw" when nothing suggests a slab, or null when a
 *  grader is named but no exact number parses (abstain — never call it raw). */
function extractGrade(l: EbayListing): string | null {
  const graderField = firstAspect(l, GRADER_ASPECTS);
  const gradeField = firstAspect(l, GRADE_ASPECTS);
  // The grade aspect itself sometimes carries the grader ("Grade: PSA 10").
  const co = normGrader(graderField) ?? normGrader(gradeField) ?? titleGrade(l.title)?.co;
  if (!co) return 'raw';
  const num =
    parseGradeNum(gradeField) ?? parseGradeNum(graderField) ?? titleGrade(l.title)?.num;
  // grader named but no parsable number: it's a slab of SOME grade — keying it
  // "raw" would price it against the raw pool. Abstain.
  if (!num) return null;
  return `${co}${num}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant purity (book v2, Oct 2026)
//
// The book key carries no parallel/autograph axis, so lectr now holds each
// card row to ONE variant signature and stamps it on the row (`variant`).
// A signed or parallel listing pinned to a base-card key (or the reverse) is a
// different card at different money: ABSTAIN. The signature below is ported
// from lectr app/lib/cards.ts parseCard (VARIANT_TOKENS + TEAM_MASK + the
// autograph-grade regexes) and the emitter's cardBookId: sorted tokens, 'sp'
// dropped, `|ag:<grade>` appended when an autograph grade is read.
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_MASK_RE =
  /\b(red sox|white sox|blue jays|red wings|green bay|golden state|golden knights|blue devils|crimson tide|orange bowl|black knights|silver bullets|gold rush|browns|reds|blues|golden bears|redskins|green wave|royals)\b/gi;
const VARIANT_TOKENS: [RegExp, string][] = [
  [/\b(?:autograph(?:ed)?|signed|auto)\b/i, 'auto'],
  [/\b(?:patch|jersey|relic|swatch|memorabilia)\b/i, 'relic'],
  [/\b(?:super)fractor\b/i, 'superfractor'],
  [/\b(?:x-?fractor|refractor)\b/i, 'refractor'],
  [/\bprinting plate\b/i, 'plate'],
  [/\b(?:1\/1|one of one)\b/i, '1of1'],
  [/\b(?:variation|var\.|image variation|photo variation)\b/i, 'var'],
  [/\berror\b/i, 'error'],
  [/\bdie[- ]?cut\b/i, 'diecut'],
  [/\bholo(?:foil|gram)?\b/i, 'holo'],
  [/\b(?:shimmer|mojo|wave|cracked ice|atomic|camo|tie[- ]dye|neon|disco|hyper|pulsar|la[sz]er|snakeskin|zebra|tiger|scope|velocity|lucky envelopes?|fast break|choice|no huddle|sparkle|glitter)\b/i, 'pattern'],
  [/\b(?:silver|gold|red|blue|green|orange|purple|pink|black|bronze|platinum|yellow|teal|aqua|emerald|ruby|sapphire)\b/i, 'color'],
];
// lectr's player read (cards.ts AFTER_NO_PLAYER + trimNameRun): the
// capitalized run right after #CARDNO, cut at descriptor words — masked so a
// surname like "Blue" / "Gold" never reads as a parallel.
const NAME_TOKEN = String.raw`[A-Z][A-Za-z.'’À-ɏ-]*`;
const AFTER_NO_PLAYER = new RegExp(
  String.raw`#[A-Za-z0-9/.-]+\s+((?:${NAME_TOKEN}|de|van|von|der|jr\.?|sr\.?|II|III)(?:\s+(?:${NAME_TOKEN}|de|van|von|der|Jr\.?|Sr\.?|II|III)){1,3})`,
);
const NAME_STOP = /^(Rookie|Signed|Card|Patch|Autograph(?:ed)?|Auto|Jersey|Relic|Logo|Game|Match|Photo|Player|Team|Tour|Practice|Fight|Warm|Dual|Triple|On|RC|And|With|Refractor|Prizm|Insert|Parallel|Case|Hit|Exchange|Redemption|SP|SSP|Worn|Used|Issued|Debut|Career|Final|Championship|World|Series|Super|Season|Professional|Model|Style|Era|Circa|HR|RBI|Mini|Decal|Single|Full|Store|Salesman|Advertising|Presentational?)$/i;
function playerRunAfterNo(title: string): string | null {
  const m = title.replace(/\([^)]*\)/g, ' ').match(AFTER_NO_PLAYER);
  if (!m) return null;
  const kept: string[] = [];
  for (const w of m[1].trim().split(/\s+/)) {
    if (NAME_STOP.test(w) || NAME_STOP.test(w.split('-')[0])) break;
    // stricter than lectr on purpose: past the first two (name) words a
    // variant word ends the run — "Mike Trout Gold Refractor" keeps its Gold
    // (lectr would mask it). Over-reading a variant only ever abstains.
    if (kept.length >= 2 && VARIANT_TOKENS.some(([re]) => re.test(w))) break;
    kept.push(w);
  }
  return kept.length >= 2 ? kept.join(' ') : null;
}

const AUTO_GRADE_RE = /\b(?:PSA\s*\/\s*DNA|auto(?:graph)?(?:\s+grade)?)\b[^0-9,;()]{0,20}?(\d{1,2}(?:\.5)?)(?![\d.])/i;
const AUTO_AUTH_RE = /\b(?:PSA\s*\/\s*DNA|auto(?:graph)?)\s*[-:]?\s*(?:authentic|auth)\b/i;

export interface CardVariant {
  /** sorted parallel tokens, 'auto' and 'sp' excluded */
  parallel: string[];
  /** signed (an 'auto' token or an autograph grade) */
  auto: boolean;
  /** autograph grade ('10', 'A' = authentic) or null */
  autoGrade: string | null;
}

function parseVariantSignature(sig: string): CardVariant {
  const parts = sig.split('|');
  const ag = parts.find((p) => p.startsWith('ag:'));
  const toks = (parts.find((p) => p && !p.startsWith('ag:')) ?? '').split('+').filter(Boolean);
  return {
    parallel: toks.filter((t) => t !== 'auto' && t !== 'sp').sort(),
    auto: toks.includes('auto') || !!ag,
    autoGrade: ag ? ag.slice(3) : null,
  };
}

/** The listing's variant read the way lectr reads a sale: the title (player
 *  name + colour-word team names masked; note lectr's quirk, kept on purpose,
 *  that "Auto PSA 9" reads autograph grade 9 — the book pooled it that way) plus eBay's own Parallel/Variety
 *  and Autographed item-specifics when present. */
export function cardVariantOf(l: EbayListing): CardVariant {
  let t = l.title;
  const autoGradeM = t.match(AUTO_GRADE_RE);
  const autoGrade = autoGradeM ? autoGradeM[1] : AUTO_AUTH_RE.test(t) ? 'A' : null;
  const par = firstAspect(l, ['Parallel/Variety', 'Parallel', 'Variety']);
  if (par && !/^(none|n\/a|no|base|base set)$/i.test(par)) t += ` ${par}`;
  let vt = t.replace(TEAM_MASK_RE, ' ');
  const run = playerRunAfterNo(l.title);
  if (run) vt = vt.split(run).join(' ');
  const player = extractPlayer(l);
  if (player) {
    const parts = player.split('-').filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (parts.length) vt = vt.replace(new RegExp(`\\b${parts.join('[^a-z0-9]+')}\\b`, 'gi'), ' ');
  }
  const toks: string[] = [];
  for (const [re, tok] of VARIANT_TOKENS) if (re.test(vt) && !toks.includes(tok)) toks.push(tok);
  const signedAspect = aspect(l, 'Autographed');
  const auto = toks.includes('auto') || autoGrade != null || /^yes\b/i.test(signedAspect ?? '');
  return {
    parallel: toks.filter((x) => x !== 'auto').sort(),
    auto,
    autoGrade,
  };
}

/** A listing whose autograph / parallel status differs from the row's
 *  variant signature is not the row's card. `row.variant === undefined` =
 *  an old book (no axis) → no check. */
export function cardVariantConflict(l: EbayListing, row: ValueBookRow): RowConflictReason | null {
  if (row.variant === undefined) return null;
  const want = parseVariantSignature(row.variant);
  const got = cardVariantOf(l);
  if (want.auto !== got.auto) return 'auto-mismatch';
  if (want.auto && want.autoGrade !== got.autoGrade) return 'auto-mismatch';
  if (want.parallel.join('+') !== got.parallel.join('+')) return 'parallel-mismatch';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The matcher
// ─────────────────────────────────────────────────────────────────────────────

export const sportsCardsMatcher: VerticalMatcher = {
  vertical: 'sports-cards',

  queriesFor(book: ValueBookRow[]): EbayQuery[] {
    return book
      .filter((r) => r.v === 'sports-cards')
      .map((row) => {
        const [playerSlug, year, set, cardNo, grade] = row.k.split('|');
        const player = playerSlug.replace(/-/g, ' ');
        const q = [player, year, set, `#${cardNo}`, grade === 'raw' ? '' : grade]
          .filter(Boolean)
          .join(' ');
        return {
          key: row.k,
          q,
          // 261328 = Sports Trading Cards. Placeholder leaf id — the real leaf
          // (Basketball/Baseball/Hockey Cards, etc.) is resolved per-key via the
          // eBay Taxonomy API at P0; buyingOptions filtering fails on non-leaf ids.
          categoryIds: ['261328'],
          priceMin: Math.round(row.lo * 0.5),
          priceMax: Math.round(row.hi * 1.15),
        };
      });
  },

  rejectTitle(title: string): string | null {
    return cardGradeAbstainReason(title);
  },

  rowConflict: cardVariantConflict,

  identify(listing: EbayListing): IdentityKey | null {
    const player = extractPlayer(listing);
    const year = extractYear(listing);
    const set = extractSet(listing);
    const cardNo = extractCardNo(listing);
    // ABSTAIN when any identity axis is missing — a wrong match is the failure mode.
    if (!player || !year || !set || !cardNo) return null;
    if (cardGradeAbstainReason(listing.title)) return null;
    const qual = firstAspect(listing, ['Grade Qualifier', 'Qualifier']);
    if (qual && !/^(none|n\/a|no)$/i.test(qual.trim())) return null;
    const grade = extractGrade(listing);
    if (!grade) return null;
    return `${player}|${year}|${set}|${cardNo}|${grade}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const graderRaw = firstAspect(listing, GRADER_ASPECTS);
    const gradeField = firstAspect(listing, GRADE_ASPECTS);
    const grader =
      normGrader(graderRaw) ?? normGrader(gradeField) ?? titleGrade(listing.title)?.co;
    const certNumber = firstAspect(listing, CERT_ASPECTS);

    // 'cert-verified' is NEVER set here — that happens in enrich.ts after the PSA
    // API confirms the cert. Here: a claimed slab (grader + cert number both
    // present) is 'slab-claimed'; anything else is 'raw'. grader + certNumber are
    // captured for that later verification step regardless.
    const authenticityAnchor: AuthenticityAnchor =
      grader && certNumber ? 'slab-claimed' : 'raw';

    const notes: string[] = [];
    if (grader && !certNumber) notes.push('grader claimed without a certification number');

    return {
      authenticityAnchor,
      grader,
      certNumber,
      notes: notes.length ? notes : undefined,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
