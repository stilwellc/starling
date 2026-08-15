/**
 * match/pokemon.ts — the 'pokemon' VerticalMatcher.
 *
 * Graded Pokémon carries the SAME strong identity lectr certifies for the sports
 * flagship: year + set + card number + edition + grade. The value-book key is
 *   <year>|<setPart>|<cardNo>|<edition>|<grade>
 * and is re-derived from the listing TITLE (aspects are a bonus enrichment path).
 *
 * pokemonKey() below is a faithful port of Ray's scripts/sub-markets.ts
 * (lines 310-329) — same PKMN_GRADE regex, same setPart strip/slice, same
 * edition ladder, same hard requirement that year/cardNo/grade all resolve.
 * If any of those three is missing we ABSTAIN (return null): a wrong pin is the
 * only real failure mode, so silence beats a guess.
 *
 * Difference from lectr's port: lectr gates on `l.artist === 'pokemon'` because
 * its corpus is multi-vertical. Starling routes by vertical upstream, so this
 * matcher's fixture/queries are pokemon-only by construction and there is no
 * artist field to check.
 */
import type {
  VerticalMatcher,
  ValueBookRow,
  EbayQuery,
  EbayListing,
  IdentityKey,
  RiskSignals,
  AuthenticityAnchor,
} from '../types';
import { aspect } from '../types';
import { conditionFlags } from '../lib/condition';

// ── The identity regex — ported verbatim from lectr (sub-markets.ts:315).
const PKMN_GRADE =
  /\b(PSA|BGS|CGC|SGC)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-?MT\+?|NM|EX-?MT|EX|VG)?\s*(10|[1-9](?:\.5)?)\b/i;

// Set-noise the setPart derivation strips before slicing (ported verbatim).
const SET_NOISE =
  /\b(pok[eé]mon|holo(?:foil)?|1st edition|shadowless|unlimited|reverse|japanese|english)\b/gi;

/** Slice the "words between year and #" down to the canonical setPart slug. */
function deriveSetPart(title: string, yr: string): string {
  return title
    .slice(title.indexOf(yr) + 4)
    .split('#')[0]
    .replace(SET_NOISE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
}

/** Grader company keyed off a grade token, e.g. "PSA10" → "PSA". */
function graderOf(grade: string | undefined): string | undefined {
  const m = grade?.match(/^([A-Z]+)/i);
  return m ? m[1].toUpperCase() : undefined;
}

interface Probe {
  yr?: string;
  setPart: string;
  no?: string;
  ed: 'unl' | '1st' | 'shadowless';
  grade?: string; // e.g. "PSA10"
  grader?: string; // e.g. "PSA"
  certNumber?: string;
}

/**
 * The single title-first, aspect-assisted read shared by identify() and
 * riskInputs(). Title is primary (this vertical's listings lean on titles);
 * aspects only fill a field the title left blank.
 */
function probe(l: EbayListing): Probe {
  const t = l.title || '';

  // ── TITLE (primary) ────────────────────────────────────────────────────
  let yr = (t.match(/\b(?:19|20)\d{2}\b/) || [])[0];
  let no = (t.match(/#([A-Za-z0-9]+)\b/) || [])[1];
  const gm = t.match(PKMN_GRADE);
  let grade = gm ? `${gm[1].toUpperCase()}${gm[2]}` : undefined;
  let grader = gm ? gm[1].toUpperCase() : undefined;

  // Edition ladder — 1st edition > shadowless > unlimited (lectr default).
  // No edition token → 'unl' (the vast majority of cards), matching lectr. We
  // still abstain overall if the set can't parse, so an ambiguous title with a
  // weak set read never produces a key.
  const ed: Probe['ed'] = /1st edition/i.test(t)
    ? '1st'
    : /shadowless/i.test(t)
      ? 'shadowless'
      : 'unl';

  let setPart = yr ? deriveSetPart(t, yr) : '';

  // ── ASPECTS (enrichment, only where the title came up thin) ─────────────
  const certNumber =
    aspect(l, 'Certification Number') ||
    aspect(l, 'Certification #') ||
    aspect(l, 'Cert Number') ||
    aspect(l, 'Cert #') ||
    undefined;

  if (!grade) {
    const gradeAspect = aspect(l, 'Grade');
    const graderAspect =
      aspect(l, 'Professional Grader') ||
      aspect(l, 'Grading Company') ||
      aspect(l, 'Grading Service');
    if (gradeAspect) {
      const am = gradeAspect.match(PKMN_GRADE);
      if (am) {
        grade = `${am[1].toUpperCase()}${am[2]}`;
        grader = am[1].toUpperCase();
      } else {
        const num = (gradeAspect.match(/\b(10|[1-9](?:\.5)?)\b/) || [])[1];
        if (num && graderAspect) {
          grade = `${graderAspect.toUpperCase()}${num}`;
          grader = graderAspect.toUpperCase();
        }
      }
    }
  }
  if (!grader) grader = graderOf(grade);

  if (!no) {
    const cn = aspect(l, 'Card Number') || aspect(l, 'Card No') || aspect(l, 'Number');
    no = (cn?.match(/([A-Za-z0-9]+)/) || [])[1];
  }

  if (!yr) {
    const ya = aspect(l, 'Year Manufactured') || aspect(l, 'Year');
    yr = (ya?.match(/\b(?:19|20)\d{2}\b/) || [])[0];
  }

  if (!setPart) {
    const setAspect = aspect(l, 'Set') || aspect(l, 'Set Name');
    if (setAspect && yr) {
      // Reuse the same strip/slice by prefixing a fake year+'#' frame.
      setPart = deriveSetPart(`${yr} ${setAspect} #`, yr);
    }
  }

  return { yr, setPart, no, ed, grade, grader, certNumber };
}

export const pokemonMatcher: VerticalMatcher = {
  vertical: 'pokemon',

  queriesFor(book: ValueBookRow[]): EbayQuery[] {
    return book
      .filter((r) => r.v === 'pokemon')
      .map((r) => {
        const [year, setPart, cardNo, edition, grade] = r.k.split('|');
        const setWords = setPart.replace(/-/g, ' ');
        const gm = grade.match(/^([A-Za-z]+)([0-9.]+)$/);
        const gradeText = gm ? `${gm[1]} ${gm[2]}` : grade;
        const editionText =
          edition === '1st' ? '1st Edition' : edition === 'shadowless' ? 'Shadowless' : '';
        const q = `${year} Pokemon ${setWords} #${cardNo} ${editionText} ${gradeText}`
          .replace(/\s+/g, ' ')
          .trim();
        return {
          key: r.k,
          q,
          // 183454 = "CCG Individual Cards" (Trading Card Singles). Placeholder:
          // TODO(P0) resolve the exact US leaf via the eBay Taxonomy API before
          // going live — buyingOptions filters reject non-leaf category ids.
          categoryIds: ['183454'],
          priceMin: Math.round(r.lo * 0.5),
          priceMax: Math.round(r.hi * 1.15),
        } satisfies EbayQuery;
      });
  },

  identify(listing: EbayListing): IdentityKey | null {
    const { yr, setPart, no, ed, grade } = probe(listing);
    // Hard requirement (faithful to lectr): year, cardNo, grade, and a non-empty
    // set slug must ALL resolve. Anything less → abstain rather than mis-pin.
    if (!yr || !no || !grade || !setPart) return null;
    return `${yr}|${setPart}|${no}|${ed}|${grade}`;
  },

  riskInputs(listing: EbayListing): RiskSignals {
    const { grader, certNumber } = probe(listing);
    // A detected grading company = a claimed slab (B-grade anchor). enrich.ts can
    // promote this to 'cert-verified' (A) once the captured cert number clears
    // the PSA/BGS/CGC lookup. No grader → no authentication anchor (raw).
    const authenticityAnchor: AuthenticityAnchor = grader ? 'slab-claimed' : 'raw';
    const notes: string[] = [];
    if (grader) notes.push(certNumber ? `${grader} cert ${certNumber}` : `${grader} slab, no cert #`);
    return {
      authenticityAnchor,
      grader,
      certNumber,
      notes: notes.length ? notes : undefined,
      conditionFlags: conditionFlags(listing.title),
    };
  },
};
