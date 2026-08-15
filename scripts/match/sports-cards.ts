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

/** "PSA6"-style token, or "raw" when no grader can be identified. */
function extractGrade(l: EbayListing): string {
  const graderField = firstAspect(l, GRADER_ASPECTS);
  const gradeField = firstAspect(l, GRADE_ASPECTS);
  // The grade aspect itself sometimes carries the grader ("Grade: PSA 10").
  const co = normGrader(graderField) ?? normGrader(gradeField) ?? titleGrade(l.title)?.co;
  if (!co) return 'raw';
  const num =
    parseGradeNum(gradeField) ?? parseGradeNum(graderField) ?? titleGrade(l.title)?.num;
  if (!num) return 'raw'; // grader named but no parsable number → do not fabricate one
  return `${co}${num}`;
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

  identify(listing: EbayListing): IdentityKey | null {
    const player = extractPlayer(listing);
    const year = extractYear(listing);
    const set = extractSet(listing);
    const cardNo = extractCardNo(listing);
    // ABSTAIN when any identity axis is missing — a wrong match is the failure mode.
    if (!player || !year || !set || !cardNo) return null;
    const grade = extractGrade(listing);
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
