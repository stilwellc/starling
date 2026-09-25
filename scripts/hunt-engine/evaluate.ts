/**
 * evaluate.ts — deterministic rules. Every candidate, kept or rejected, leaves
 * with machine-readable reasons and risk flags. No AI classification.
 *
 *   allIn   = itemPrice + shipping            (tax excluded, always labeled)
 *   underBy = maxAllIn − allIn
 *   underPct = underBy / maxAllIn
 *
 *   under  — every rule passes, a cap exists, known all-in ≤ cap
 *   over   — rules pass, cap exists, all-in > cap
 *   watch  — rules pass, but the hunt is watch-only or all-in is unknown
 *   reject — a title or category rule fails
 */
import {
  ARTIST_NAMES,
  ART_MEDIUM_EVIDENCE,
  OTHER_DESIGNERS,
  ART_NOT_UNIQUE,
  AUTHENTICITY_EVIDENCE,
  FAKE_TEMPLATE_PHRASES,
  FORGERY_PRONE_HUNTS,
  PROVENANCE_EVIDENCE,
  FURNITURE_NOT_OBJECT,
  GAME_USED_ALIASES,
  OTHER_ARTISTS,
  TRADING_CARD_SIGNALS,
  PHOTO_MATCH_ALIASES,
  SUPER_BOWL_52_ALIASES,
  type Hunt,
} from './hunts';
import { firstPhrase, hasPhrase, normalizeText } from './text';
import type { Evaluation, HuntListing, RiskLevel } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** first names that make a sports surname match unambiguous */
const FULL_NAME: Record<string, string> = {
  'sports-ertz-jersey': 'zach ertz',
  'sports-hurts-jersey': 'jalen hurts',
  'sports-smith-jersey': 'devonta smith',
  'sports-graham-jersey': 'brandon graham',
  'sports-djackson-jersey': 'desean jackson',
  'sports-foles-eagles-jersey': 'nick foles',
  'sports-foles-bears-jersey': 'nick foles',
  'sports-foles-jaguars-jersey': 'nick foles',
};
const TEAM: Record<string, string> = {
  'sports-ertz-jersey': 'eagles',
  'sports-hurts-jersey': 'eagles',
  'sports-smith-jersey': 'eagles',
  'sports-graham-jersey': 'eagles',
  'sports-djackson-jersey': 'eagles',
  'sports-foles-eagles-jersey': 'eagles',
  'sports-foles-bears-jersey': 'bears',
  'sports-foles-jaguars-jersey': 'jaguars',
};

export function authenticityEvidence(title: string): string[] {
  const t = normalizeText(title);
  return AUTHENTICITY_EVIDENCE.filter((e) => hasPhrase(t, e));
}

export function evaluate(hunt: Hunt, l: HuntListing): Evaluation {
  const t = normalizeText(l.title);
  const reasons: string[] = [];
  const rejects: string[] = [];
  const flags: string[] = [];
  let confidence = 0.95;

  // 1. titleMust — every outer entry required, nested strings are OR aliases
  for (const m of hunt.titleMust) {
    const alts = Array.isArray(m) ? m : [m];
    const hit = firstPhrase(t, alts);
    if (hit) reasons.push(`must:${hit}`);
    else rejects.push(`missing:${alts.join('|')}`);
  }

  // 2. exclusions (a photo-matched listing is the one allowed "photo")
  const photoMatched = firstPhrase(t, PHOTO_MATCH_ALIASES);
  for (const x of hunt.titleExcludes) {
    if (x === 'photo' && photoMatched) continue;
    if (hasPhrase(t, x)) rejects.push(`exclude:${x}`);
  }

  // 3. collection rules
  if (hunt.vertical === 'art') {
    const names = ARTIST_NAMES[hunt.id] ?? [];
    const name = firstPhrase(t, names);
    if (names.length && !name) rejects.push('art:artist-name-missing');
    for (const x of ART_NOT_UNIQUE) if (hasPhrase(t, x)) rejects.push(`art:not-unique:${x}`);
    const medium = ART_MEDIUM_EVIDENCE[hunt.section as 'Paintings' | 'Drawings'] ?? [];
    const med = firstPhrase(t, medium);
    if (medium.length && !med) rejects.push('art:medium-missing');
    else if (med) reasons.push(`medium:${med}`);
    const own = new Set(names.map((n) => normalizeText(n).trim()));
    const others = OTHER_ARTISTS.filter((a) => !own.has(normalizeText(a).trim()) && !names.some((n) => normalizeText(n).includes(normalizeText(a))) && hasPhrase(t, a));
    if (others.length >= 2) rejects.push(`art:keyword-stuffed:${others.slice(0, 3).join('+')}`);
    const claimsOriginal = hasPhrase(t, 'original') || hasPhrase(t, 'hand drawn') || hasPhrase(t, 'handmade') || hasPhrase(t, 'unique') || hasPhrase(t, 'one of a kind');
    if (claimsOriginal) reasons.push('claims-original');
    // publication forms: "Peter Saul: New Paintings…", "…by R. Crumb" with no original claim, "number 3"
    const lead = l.title.trim().toLowerCase();
    if (names.some((n) => new RegExp(`^\\W*${n.replace(/ /g, '[\\s.]+')}\\s*:`).test(lead))) rejects.push('art:publication-title');
    if (!claimsOriginal && names.some((n) => hasPhrase(t, `by ${n}`) || hasPhrase(t, `by ${n.split(' ').slice(-1)[0]}`))) rejects.push('art:authored-publication');
    if (/ number \d/.test(t) || / no \d+ /.test(t)) rejects.push('art:numbered-publication');
  }
  if (hunt.vertical === 'furniture') {
    for (const x of FURNITURE_NOT_OBJECT) if (hasPhrase(t, x)) rejects.push(`furniture:publication:${x}`);
    const designers = OTHER_DESIGNERS.filter((d) => hasPhrase(t, d));
    if (designers.length >= 2) rejects.push(`furniture:other-designers:${designers.slice(0, 3).join('+')}`);
  }
  if (hunt.vertical === 'sports') {
    for (const x of TRADING_CARD_SIGNALS) if (hasPhrase(t, x)) { rejects.push(`sports:trading-card:${x}`); break; }
    const surnames = ['mccoy', 'maclin', 'mcnabb', 'vick', 'westbrook', 'lynch', 'kelce', 'brown', 'goedert', 'wentz'];
    if (surnames.filter((n) => hasPhrase(t, n)).length >= 1 && FULL_NAME[hunt.id] && !FULL_NAME[hunt.id].endsWith(surnames.find((n) => hasPhrase(t, n))!)) rejects.push('sports:multi-player');
    if (/(^|[\s#(])\d{0,4}\s?\/\s?\d{1,4}(?![\d/])/.test(` ${l.title.toLowerCase()}`)) rejects.push('sports:serial-numbered');
    if (hunt.id !== 'sports-sb52-football' && !hasPhrase(t, 'jersey')) rejects.push('sports:object-not-jersey');
    if (hunt.id === 'sports-sb52-football') {
      if (!hasPhrase(t, 'football') && !hasPhrase(t, 'ball')) rejects.push('sports:object-not-football');
      const m = t.match(/ super ?bowl (\d{1,2}|[ivxl]{1,6}) /);
      if (m && m[1] !== '52' && m[1] !== 'lii') rejects.push(`sports:different-super-bowl:${m[1]}`);
    }
    const gu = firstPhrase(t, GAME_USED_ALIASES);
    if (gu) reasons.push(`game-used:${gu}`);
    else rejects.push('sports:not-game-used');
    if (hasPhrase(t, 'photo') && !photoMatched) rejects.push('sports:photo-not-matched');
    if (photoMatched) reasons.push('photo-matched');
    if (hasPhrase(t, 'signed') || hasPhrase(t, 'autographed')) reasons.push('signed');
    const full = FULL_NAME[hunt.id];
    if (full && !hasPhrase(t, full)) { flags.push('name-partial'); confidence -= 0.15; }
    const team = TEAM[hunt.id];
    if (team && !hasPhrase(t, team)) { flags.push('team-not-in-title'); confidence -= 0.1; }
    if (hunt.id === 'sports-sb52-football') {
      if (!firstPhrase(t, SUPER_BOWL_52_ALIASES)) { flags.push('sb-number-unconfirmed'); confidence -= 0.15; }
      if (!hasPhrase(t, 'football') && !hasPhrase(t, 'ball')) { flags.push('object-unconfirmed'); confidence -= 0.1; }
    }
    if (authenticityEvidence(l.title).length === 0) { flags.push('no-authentication-in-title'); confidence -= 0.1; }
  }

  // 4. buying mode and currency
  if (!hunt.buyingModes.includes(l.buyingMode)) rejects.push(`mode-not-hunted:${l.buyingMode}`);
  if (l.priceCurrency !== 'USD') rejects.push(`currency:${l.priceCurrency}`);

  // 5. listing risk
  if (l.buyingMode === 'AUCTION') { flags.push('auction-price-moves'); confidence -= 0.05; }
  const cond = (l.condition ?? '').toLowerCase();
  if (cond.includes('parts') || cond.includes('not working')) { flags.push('condition:for-parts'); confidence -= 0.2; }
  const fb = l.seller?.feedbackPercentage;
  const fs = l.seller?.feedbackScore;
  if ((fb != null && fb < 98) || (fs != null && fs < 10)) { flags.push('seller-low-feedback'); confidence -= 0.1; }
  if (l.shipping === null) flags.push('shipping-unknown');

  if (hunt.vertical === 'art' && hunt.maxAllIn && l.price < hunt.maxAllIn * 0.05) { flags.push('price-far-below-market'); confidence -= 0.35; }
  if (hunt.vertical === 'art' && FAKE_TEMPLATE_PHRASES.some((set) => set.every((p) => hasPhrase(t, p)))) { flags.push('fake-art-template'); confidence -= 0.45; }
  const allIn = l.shipping === null ? null : round2(l.price + l.shipping);
  const cap = hunt.maxAllIn;
  const base = {
    huntId: hunt.id,
    itemId: l.itemId,
    flags,
    confidence: Math.max(0.2, round2(confidence)),
    allIn,
    maxAllIn: cap,
    taxExcluded: true as const,
    ...riskOf(hunt, l, flags),
  };
  const r = riskOf(hunt, l, flags);
  const review: 'ok' | 'review' = base.confidence < 0.75 || r.risk === 'high' ? 'review' : 'ok';

  if (rejects.length) {
    return { ...base, classification: 'reject', reasons: [...rejects, ...reasons], review: 'review', underBy: null, underPct: null, capWording: 'rejected' };
  }
  if (cap === null) {
    return { ...base, classification: 'watch', reasons: [...reasons, 'watch-only'], review, underBy: null, underPct: null, capWording: 'watching — no cap' };
  }
  if (allIn === null) {
    return { ...base, classification: 'watch', reasons: [...reasons, 'all-in-unknown'], review, underBy: null, underPct: null, capWording: 'all-in unknown — shipping not listed' };
  }
  const underBy = round2(cap - allIn);
  const underPct = round2(underBy / cap);
  const auction = l.buyingMode === 'AUCTION';
  if (allIn <= cap) {
    return { ...base, classification: 'under', reasons: [...reasons, 'at-or-under-cap'], review, underBy, underPct, capWording: auction ? 'under cap now' : 'under cap' };
  }
  return { ...base, classification: 'over', reasons: [...reasons, 'over-cap'], review, underBy, underPct, capWording: auction ? 'over cap now' : 'over cap' };
}

/**
 * Fake / misrepresentation risk. Deterministic, from the title, price and flags.
 * Recomputed after same-seller folding (a seller with several copies of a
 * "unique" work is itself a fake signal).
 */
export function riskOf(hunt: Hunt, l: HuntListing, flags: string[]): { risk: RiskLevel; riskReasons: string[] } {
  const t = normalizeText(l.title);
  const high: string[] = [];
  const med: string[] = [];
  const cap = hunt.maxAllIn;
  if (hunt.vertical === 'art') {
    const provenance = PROVENANCE_EVIDENCE.some((p) => hasPhrase(t, p));
    if (flags.includes('fake-art-template')) high.push('matches a common fake-art listing template (“on old paper, signed & stamped”)');
    if (flags.includes('price-far-below-market')) high.push('priced far below what this artist sells for');
    const repeats = flags.find((f) => f.startsWith('same-seller-repeats:'));
    if (repeats) high.push(`seller has ${Number(repeats.split(':')[1]) + 1} copies of a “unique” work`);
    if (FORGERY_PRONE_HUNTS.includes(hunt.id) && !provenance) {
      if (cap && l.price < cap * 0.25) high.push(`${hunt.label.split(' — ')[0]} is heavily forged on eBay and this is priced like a fake`);
      else med.push(`${hunt.label.split(' — ')[0]} is heavily forged on eBay — no provenance in the listing`);
    }
    if (!provenance && hasPhrase(t, 'coa') && !high.length) med.push('only a generic COA — fakes routinely include one');
    if (l.location && !/\bUS\b|United States/i.test(l.location) && FORGERY_PRONE_HUNTS.includes(hunt.id)) med.push(`ships from ${l.location}`);
  }
  if (hunt.vertical === 'sports') {
    if (flags.includes('no-authentication-in-title')) med.push('no photo-match, team or third-party authentication named');
  }
  if (flags.includes('seller-low-feedback')) med.push('seller feedback is low');
  if (flags.includes('condition:for-parts')) med.push('listed for parts / not working');
  if (high.length) return { risk: 'high', riskReasons: [...high, ...med] };
  if (med.length) return { risk: 'medium', riskReasons: med };
  return { risk: 'low', riskReasons: [] };
}
