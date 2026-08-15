/**
 * score/risk.ts — the risk model (PROPOSAL §7).
 *
 * "No hard gating (sole exception: the >90% depth cap, which lives in gate.ts).
 *  Grade A–D, always explained on the card."
 *
 * Score = weighted signals, 0..100:
 *   • authenticity anchor   (0–40)
 *   • seller                (0–30)
 *   • listing quality       (0–20)
 *   • per-vertical prior     (0–10)
 * Thresholds: A ≥80, B ≥60, C ≥40, else D.
 *
 * The no-black-box rule: every grade ships with reasons[] the card renders.
 *
 * ALL weights are constants below so they can be TUNED AGAINST RECEIPTS later
 * (PROPOSAL §7: "tuned later against receipts, not vibes"). Do not scatter
 * magic numbers into the logic — add/adjust a constant here.
 */

import type {
  EbayListing,
  RiskSignals,
  RiskResult,
  RiskGrade,
  Vertical,
  AuthenticityAnchor,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Weight constants — the reviewed knobs (PROPOSAL §7)
// ─────────────────────────────────────────────────────────────────────────────

/** Grade thresholds on the 0..100 score. */
const THRESHOLDS = { A: 80, B: 60, C: 40 } as const;

/** Authenticity anchor points (0–40). Machine-verified cert is the gold. */
const ANCHOR_POINTS: Record<AuthenticityAnchor, number> = {
  'cert-verified': 40, // grader API confirmed the cert — A-grade evidence
  'slab-claimed': 25, // slab/cert asserted but unverified
  papers: 25, // watch papers / LOA named
  raw: 5, // no authentication anchor
};

/**
 * Seller sub-score (0–30). Split across the axes the Browse summary gives us:
 * feedback %, feedback volume, and account type. Account age is folded in
 * only "if available" — the EbayListing.seller shape carries no age today,
 * so that axis contributes 0 until eBay/enrich surfaces it.
 */
const SELLER = {
  // feedbackPercentage → up to 15
  pct: [
    { min: 99.5, pts: 15 },
    { min: 98, pts: 12 }, // §7 A-bar: ≥98%
    { min: 95, pts: 8 },
    { min: 90, pts: 4 },
  ] as { min: number; pts: number }[],
  pctMax: 15,
  // feedbackScore (rating volume) → up to 10
  vol: [
    { min: 1000, pts: 10 },
    { min: 100, pts: 8 }, // §7 A-bar: ≥100 ratings
    { min: 10, pts: 4 },
    { min: 1, pts: 2 },
  ] as { min: number; pts: number }[],
  volMax: 10,
  // accountType → up to 5
  business: 5, // registered business seller
  individual: 2,
} as const;

/**
 * Listing-quality sub-score (0–20). Rewards a complete, photographed listing;
 * condition-qualifier hits (from the shared gate's hasConditionFlag) SUBTRACT —
 * a "cracked"/"as-is"/"trimmed" flag is a real risk, priced in openly.
 */
const QUALITY = {
  // aspect completeness → up to 14 (getItem localizedAspects is where the gold is)
  aspects: [
    { min: 6, pts: 14 },
    { min: 3, pts: 9 },
    { min: 1, pts: 4 },
  ] as { min: number; pts: number }[],
  aspectsMax: 14,
  image: 6, // a real photo present (not just stock/none)
  conditionFlagPenalty: 8, // per condition-qualifier hit, subtracted
  max: 20,
} as const;

/**
 * Per-vertical fake-rate prior (0–10). Slabbed cards/pokemon carry the LOWEST
 * fake prior (a graded slab is hard to counterfeit convincingly) → most points.
 * Watches / art / autographs carry HIGHER priors → fewer points. Priced in, not
 * hidden (PROPOSAL §7 / §2).
 */
const VERTICAL_PRIOR: Record<Vertical, number> = {
  'sports-cards': 10, // slabbed: low fake prior
  pokemon: 10, // slabbed: low fake prior
  design: 5, // model-code identity, middling
  'art-editions': 4, // higher fake/misattribution prior
  watches: 4, // higher fake prior (franken/replica refs)
  autographs: 4, // higher fake prior (forgery)
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-scorers — each returns { pts, reasons }
// ─────────────────────────────────────────────────────────────────────────────

function scoreAnchor(signals: RiskSignals): { pts: number; reasons: string[] } {
  const pts = ANCHOR_POINTS[signals.authenticityAnchor];
  const reasons: string[] = [];
  switch (signals.authenticityAnchor) {
    case 'cert-verified':
      reasons.push(
        `cert verified${signals.grader ? ` (${signals.grader})` : ''}${
          signals.certNumber ? `, cert #${signals.certNumber}` : ''
        }`
      );
      break;
    case 'slab-claimed':
      reasons.push(
        `slab claimed${signals.grader ? ` (${signals.grader})` : ''}${
          signals.certNumber ? `, cert #${signals.certNumber} unverified` : ', unverified'
        }`
      );
      break;
    case 'papers':
      reasons.push('papers / LOA named (unverified)');
      break;
    case 'raw':
      reasons.push('raw, no authenticity anchor');
      break;
  }
  return { pts, reasons };
}

function scoreSeller(listing: EbayListing): { pts: number; reasons: string[] } {
  const s = listing.seller;
  const reasons: string[] = [];
  let pts = 0;

  // feedback %
  if (typeof s.feedbackPercentage === 'number') {
    const band = SELLER.pct.find((b) => s.feedbackPercentage! >= b.min);
    pts += band?.pts ?? 0;
    if (s.feedbackPercentage >= 98) reasons.push(`seller ${s.feedbackPercentage}% feedback`);
    else if (s.feedbackPercentage < 95)
      reasons.push(`low seller feedback ${s.feedbackPercentage}%`);
  } else {
    reasons.push('seller feedback % unknown');
  }

  // feedback volume
  if (typeof s.feedbackScore === 'number') {
    const band = SELLER.vol.find((b) => s.feedbackScore! >= b.min);
    pts += band?.pts ?? 0;
    if (s.feedbackScore < 10) reasons.push(`new seller (${s.feedbackScore} ratings)`);
    else if (s.feedbackScore >= 100) reasons.push(`established seller (${s.feedbackScore} ratings)`);
  } else {
    reasons.push('seller rating count unknown');
  }

  // account type (age folded in here "if available" — no age field today)
  const at = (listing.seller.accountType ?? '').toUpperCase();
  if (at === 'BUSINESS') {
    pts += SELLER.business;
    reasons.push('registered business seller');
  } else if (at === 'INDIVIDUAL') {
    pts += SELLER.individual;
  }

  return { pts, reasons };
}

function scoreQuality(
  listing: EbayListing,
  signals: RiskSignals
): { pts: number; reasons: string[] } {
  const reasons: string[] = [];
  let pts = 0;

  // aspect completeness
  const nAspects = listing.aspects.length;
  const band = QUALITY.aspects.find((b) => nAspects >= b.min);
  pts += band?.pts ?? 0;
  if (nAspects === 0) reasons.push('sparse listing, no item specifics');
  else if (nAspects >= 6) reasons.push('complete item specifics');
  if (!listing.enriched) reasons.push('not yet enriched (aspects provisional)');

  // image present
  if (listing.imageUrl) {
    pts += QUALITY.image;
  } else {
    reasons.push('no photo / stock image');
  }

  // condition-qualifier hits subtract
  for (const flag of signals.conditionFlags) {
    pts -= QUALITY.conditionFlagPenalty;
    reasons.push(`condition flag: ${flag}`);
  }

  // clamp into [0, max]
  pts = Math.max(0, Math.min(QUALITY.max, pts));
  return { pts, reasons };
}

function scorePrior(vertical: Vertical): { pts: number; reasons: string[] } {
  const pts = VERTICAL_PRIOR[vertical];
  const reasons: string[] = [];
  if (pts >= 10) reasons.push(`${vertical}: low fake-rate prior`);
  else if (pts <= 4) reasons.push(`${vertical}: elevated fake-rate prior`);
  return { pts, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreRisk — the public entry
// ─────────────────────────────────────────────────────────────────────────────

function gradeOf(score: number): RiskGrade {
  if (score >= THRESHOLDS.A) return 'A';
  if (score >= THRESHOLDS.B) return 'B';
  if (score >= THRESHOLDS.C) return 'C';
  return 'D';
}

/**
 * Score a listing's risk from its authenticity/seller/quality/vertical signals.
 * Returns a 0..100 score, an A–D grade, and human-readable reasons — the
 * no-black-box rule (PROPOSAL §7).
 */
export function scoreRisk(
  listing: EbayListing,
  signals: RiskSignals,
  vertical: Vertical
): RiskResult {
  const anchor = scoreAnchor(signals);
  const seller = scoreSeller(listing);
  const quality = scoreQuality(listing, signals);
  const prior = scorePrior(vertical);

  const score = Math.max(
    0,
    Math.min(100, anchor.pts + seller.pts + quality.pts + prior.pts)
  );
  const grade = gradeOf(score);

  const reasons = [
    ...anchor.reasons,
    ...seller.reasons,
    ...quality.reasons,
    ...prior.reasons,
  ];

  return { grade, score, reasons };
}
