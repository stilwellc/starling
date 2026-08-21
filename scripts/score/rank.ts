/**
 * score/rank.ts — board ranking (PROPOSAL §8, dollar-edge weighted Aug 20 2026).
 *
 *   depth      = 1 − allIn/med                    // close-board.ts:127, buy-side
 *   edgeUsd    = med − allIn                      // the DOLLARS on the table
 *   confW      = { high: 1.0, medium: 0.6 }
 *   riskW      = { A: 1.0, B: 0.85, C: 0.6, D: 0.3 }
 *   freshBoost = 1.15 if listed < 24h else 1.0     // fresh deals get sniped; surface fast
 *   evW        = ageW(lastSale) × velW(n12)   // living-evidence weight, see below
 *   rank       = edgeUsd × depth × confW × riskW × evW × freshBoost
 *
 * WHY THE DOLLAR TERM LEADS (Collin, Aug 20 2026): "90% return on a $10 item
 * is 9 bucks — that's not deep value." Percent-only ranking let $15-edge
 * trinkets outrank a watch sitting $600 under book. The edge term carries the
 * money; depth stays as the margin-of-safety multiplier between similar-edge
 * deals (a 50%-under $600 edge beats a 27%-under $600 edge — the deeper one
 * has more room to be wrong). Ranks are only compared to each other, so the
 * unit change is free.
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

/** Confidence multiplier — a medium-conf book row is worth 0.6 of a high one.
 *  'thin' (n=3 pools, Aug 2026) ranks at 0.35: it only reaches the board at
 *  depth ≥ 0.40 (gate.ts THIN_MIN_DEPTH) and should still sit below an equal-
 *  depth medium row — a shallow pool is a weaker claim, priced in openly. */
const CONF_W: Record<Confidence, number> = {
  high: 1.0,
  medium: 0.6,
  thin: 0.35,
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
// evidenceWeightOf — how ALIVE is the book row behind the call (Aug 20 2026)
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_MS = 86_400_000 * 30.44;

/**
 * The dud diagnosis (Collin): deals were surfacing on rows whose whole sale
 * history is years old — the med prices a dead market and the "edge" is
 * fiction. Two orthogonal reads, multiplied:
 *
 *   ageW — recency of the LATEST sale:  ≤6mo 1.0 · ≤12mo 0.85 · ≤24mo 0.55
 *          (>24mo never reaches ranking — gate.ts STALE_BOOK_MS cuts it)
 *   velW — sales VELOCITY, n12 = trailing-12mo count: 0→0.7 rising 0.075/sale
 *          to 1.0 at n12 ≥ 4. n12 absent (book emitted pre-Aug-20) → neutral
 *          1.0 — unknown is not zero.
 *
 * A $600-edge call on a market with four sales this year should bury the same
 * edge resting on one sale from 2024 — that's the whole point.
 */
export function evidenceWeightOf(lastSale: string, n12: number | undefined, now: Date): number {
  const t = Date.parse(lastSale);
  const months = Number.isNaN(t) ? Infinity : (now.getTime() - t) / MONTH_MS;
  const ageW = months <= 6 ? 1.0 : months <= 12 ? 0.85 : 0.55;
  const velW = n12 === undefined ? 1.0 : Math.min(1, 0.7 + 0.075 * n12);
  return ageW * velW;
}

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
 * rank = edgeUsd × depth × confW × riskW × freshBoost. Higher is better. No
 * vertical term.
 * `now` defaults to the wall clock only as a last resort — the pipeline injects
 * the run timestamp so a whole board ranks against one consistent moment.
 */
export function rankOf(
  edgeUsd: number,
  depth: number,
  conf: Confidence,
  grade: RiskGrade,
  evidenceW: number,
  listedAt?: string,
  now: Date = new Date()
): number {
  return edgeUsd * depth * CONF_W[conf] * RISK_W[grade] * evidenceW * freshBoostOf(listedAt, now);
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
    candidate.row.med - allIn,
    depth,
    candidate.row.conf,
    risk.grade,
    evidenceWeightOf(candidate.row.lastSale, candidate.row.n12, now),
    candidate.listing.itemCreationDate,
    now
  );
  return { depth, rank };
}
