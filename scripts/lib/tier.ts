/**
 * tier.ts — the front-page tier rule (the editorial bar, Aug 2026).
 *
 * The value audit's finding: the closing lane delivers, while some BIN
 * front-page deals rest on thin evidence — an n=4 medium-conf vintage-raw
 * "63% under" is unseen condition, not mispricing. So the board splits into
 * two tiers, and only the DEFENSIBLE calls get front-page card weight:
 *
 *   featured      — (conf 'high' AND n ≥ 6) OR (risk grade A with a
 *                   machine-verified cert), depth 0.25–0.60. Beyond 0.60
 *                   without a verified cert reads as unseen condition or a
 *                   listing error, not mispricing — demoted, never hidden.
 *                   Ladder-derived pricing never features: a derived median
 *                   is a weaker claim than a settled one, whatever the
 *                   source row's n.
 *   worth-a-look  — everything else that passed the gates (thin books,
 *                   ladder pricing, n < 6, suspect depth). Still real,
 *                   still ranked, still shown — as tape rows with the
 *                   caveat spelled out.
 *
 * Rank is UNCHANGED within tiers — this is placement, not scoring. Pure and
 * dependency-free so both the pipeline (publish.ts stamps it) and the client
 * UI (fallback for pre-tier artifacts) share one rule.
 */
import type { Deal, DealTier } from '../types';

/** Sales floor for a featured call — n=4 medium was the audit's cautionary tale. */
export const FEATURED_MIN_N = 6;
/** The board gate's own floor; restated here so the tier rule stands alone. */
export const FEATURED_MIN_DEPTH = 0.25;
/** Beyond this depth without a verified cert = suspect, not a bargain. */
export const FEATURED_MAX_UNCERT_DEPTH = 0.6;

/** True when the risk model's on-record reasons carry a machine-verified cert
 *  (scoreAnchor emits "cert verified (PSA), cert #…" for 'cert-verified'). The
 *  Deal doesn't carry the raw anchor — the reasons ARE the published evidence. */
export function certVerified(deal: Deal): boolean {
  return deal.risk.reasons.some((r) => r.startsWith('cert verified'));
}

/** The tier call. See the header for the rationale; every branch demotes to
 *  'worth-a-look' — nothing is ever dropped here (the gates already ran). */
export function tierOf(deal: Deal): DealTier {
  // derived pricing never features, even off a deep high-conf source row
  if (deal.basis === 'ladder') return 'worth-a-look';
  const cert = certVerified(deal);
  const evidence =
    (deal.conf === 'high' && deal.n >= FEATURED_MIN_N) || (deal.risk.grade === 'A' && cert);
  if (!evidence) return 'worth-a-look';
  if (deal.depth < FEATURED_MIN_DEPTH) return 'worth-a-look';
  if (deal.depth > FEATURED_MAX_UNCERT_DEPTH && !cert) return 'worth-a-look';
  return 'featured';
}
