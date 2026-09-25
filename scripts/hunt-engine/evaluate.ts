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
  AUTHENTICITY_EVIDENCE,
  GAME_USED_ALIASES,
  PHOTO_MATCH_ALIASES,
  SUPER_BOWL_52_ALIASES,
  type Hunt,
} from './hunts';
import { firstPhrase, hasPhrase, normalizeText } from './text';
import type { Evaluation, HuntListing } from './types';

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
  if (hunt.vertical === 'sports') {
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
  };
  const review: 'ok' | 'review' = base.confidence < 0.75 ? 'review' : 'ok';

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
