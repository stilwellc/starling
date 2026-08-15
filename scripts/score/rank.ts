/**
 * score/rank.ts — board ranking (PROPOSAL §8).
 *
 *   depth      = 1 − allIn/med                    // close-board.ts:127, buy-side
 *   confW      = { high: 1.0, medium: 0.6 }
 *   riskW      = { A: 1.0, B: 0.85, C: 0.6, D: 0.3 }
 *   freshBoost = 1.15 if listed < 24h else 1.0     // fresh deals get sniped; surface fast
 *   rank       = depth × confW × riskW × freshBoost
 *
 * NO VERTICAL TERM (PROPOSAL §2, the anti-cards-trap): ranking is honest. Cards
 * get no penalty and no boost — if a card deal earns the top slot it gets it.
 * The only cards guard lives in the scheduler's call budget, never here.
 *
 * Constants live here so the rationale travels with the numbers. `now` is always
 * injectable — the pipeline passes the run timestamp; we NEVER read the wall
 * clock at module load.
 */

import type { Confidence, RiskGrade, Candidate, RiskResult } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Ranking weight constants (PROPOSAL §8)
// ─────────────────────────────────────────────────────────────────────────────

/** Confidence multiplier — a medium-conf book row is worth 0.6 of a high one. */
const CONF_W: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.6,
};

/** Risk multiplier — a riskier grade discounts the deal, never hides it. */
const RISK_W: Record<RiskGrade, number> = {
  A: 1.0,
  B: 0.85,
  C: 0.6,
  D: 0.3,
};

/** Freshness: newly listed deals get sniped, so surface them faster. */
const FRESH_BOOST = 1.15;
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// ─────────────────────────────────────────────────────────────────────────────
// depthOf — buy-side depth (PROPOSAL §8)
// ─────────────────────────────────────────────────────────────────────────────

/** depth = 1 − allIn/med. Positive = listed under the book. */
export function depthOf(allIn: number, med: number): number {
  return 1 - allIn / med;
}

// ─────────────────────────────────────────────────────────────────────────────
// freshBoostOf — the 24h window multiplier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1.15 if `listedAt` is within 24h of `now`, else 1.0. Missing/unparseable
 * listedAt → no boost (we only boost what we can prove is fresh).
 */
function freshBoostOf(listedAt: string | undefined, now: Date): number {
  if (!listedAt) return 1.0;
  const t = Date.parse(listedAt);
  if (Number.isNaN(t)) return 1.0;
  const age = now.getTime() - t;
  return age >= 0 && age < FRESH_WINDOW_MS ? FRESH_BOOST : 1.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// rankOf — the composite score (PROPOSAL §8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * rank = depth × confW × riskW × freshBoost. Higher is better. No vertical term.
 * `now` defaults to the wall clock only as a last resort — the pipeline injects
 * the run timestamp so a whole board ranks against one consistent moment.
 */
export function rankOf(
  depth: number,
  conf: Confidence,
  grade: RiskGrade,
  listedAt?: string,
  now: Date = new Date()
): number {
  return depth * CONF_W[conf] * RISK_W[grade] * freshBoostOf(listedAt, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// computeRank — convenience that ties depth + rank to a Candidate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute both depth and rank for a pinned Candidate given its all-in price.
 * Uses candidate.row.med / .conf and candidate.listing.itemCreationDate.
 */
export function computeRank(
  candidate: Candidate,
  risk: RiskResult,
  allIn: number,
  now: Date = new Date()
): { depth: number; rank: number } {
  const depth = depthOf(allIn, candidate.row.med);
  const rank = rankOf(
    depth,
    candidate.row.conf,
    risk.grade,
    candidate.listing.itemCreationDate,
    now
  );
  return { depth, rank };
}
