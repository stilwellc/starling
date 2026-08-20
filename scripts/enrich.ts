/**
 * enrich.ts — Tier-2 detail + authenticity upgrade.
 *
 * A Tier-1 summary has no item specifics (localizedAspects), so identify() runs
 * on the title only — the audit measured cards pinning at 1.4% title-only,
 * which is exactly why enrichment matters. For listings that pin (or plausibly
 * pin: a watch brand with no title ref) we fetch full items via getItems
 * BATCHES — up to 20 ids per call, on getItems' OWN 5,000/day quota bucket,
 * separate from search — and re-run identify/risk on the real aspects. In
 * fixture mode listings arrive pre-enriched, so this is a passthrough.
 *
 * Cert verification (PSA) is an OPPORTUNISTIC upgrade, never a dependency: the
 * free tier's quota is uncertain in 2026 (PROPOSAL §5.5), so we back off on 429
 * and simply leave the anchor at 'slab-claimed' when we can't verify.
 */
import type { EbayListing, RiskSignals, AuthenticityAnchor } from './types';
import { GET_ITEMS_BATCH, type EbayClient } from './lib/ebay-client';

/** Enrich the listings that need it (live mode, not yet enriched), in getItems
 *  batches. `maxCalls` caps the getItems CALLS (each covers up to 20 listings)
 *  so a runaway shortlist can't blow the Tier-2 bucket. A listing whose batch
 *  fails — or that the response omits (no longer available) — keeps its
 *  summary: identify may still pin from the title. */
export async function enrich(
  listings: EbayListing[],
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number; maxCalls?: number },
): Promise<EbayListing[]> {
  if (opts.mode === 'fixture') return listings; // fixtures carry aspects already
  if (!opts.client) throw new Error('live enrich requires an EbayClient');
  const need = listings.filter((l) => !l.enriched);
  const maxCalls = opts.maxCalls ?? Math.ceil(need.length / GET_ITEMS_BATCH);
  const enrichedById = new Map<string, EbayListing>();
  for (let i = 0, calls = 0; i < need.length && calls < maxCalls; i += GET_ITEMS_BATCH, calls++) {
    const chunk = need.slice(i, i + GET_ITEMS_BATCH);
    try {
      const items = await opts.client.getItems(chunk.map((l) => l.itemId), opts.now);
      for (const it of items) enrichedById.set(it.itemId, it);
    } catch (e) {
      console.warn(`[enrich] getItems batch failed: ${(e as Error).message}`);
    }
  }
  return listings.map((l) => enrichedById.get(l.itemId) ?? l);
}

// ── PSA cert verification ────────────────────────────────────────────────────

const PSA_BASE = 'https://api.psacard.com/publicapi';

export interface CertVerdict {
  verified: boolean;
  subject?: string;
  grade?: string;
  raw?: unknown;
}

/**
 * Verify a PSA cert number and (optionally) that it matches an expected grade.
 * Opportunistic: any failure (no token, 429, network) resolves to
 * { verified: false } — the caller keeps 'slab-claimed'. cache is the caller's
 * permanent R2 store (cert facts don't change).
 */
export async function verifyPsaCert(
  certNumber: string,
  token: string | undefined,
  cache: Map<string, CertVerdict>,
): Promise<CertVerdict> {
  if (cache.has(certNumber)) return cache.get(certNumber)!;
  if (!token) return { verified: false };
  let verdict: CertVerdict = { verified: false };
  try {
    const res = await fetch(`${PSA_BASE}/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`, {
      headers: { Authorization: `bearer ${token}` },
    });
    if (res.ok) {
      const j = (await res.json()) as { PSACert?: { Subject?: string; CardGrade?: string } };
      const cert = j.PSACert;
      if (cert) verdict = { verified: true, subject: cert.Subject, grade: cert.CardGrade, raw: cert };
    }
    // 429 / 4xx → leave unverified, back off (caller throttles)
  } catch {
    /* opportunistic — swallow */
  }
  cache.set(certNumber, verdict);
  return verdict;
}

/** Promote a risk signal to cert-verified when PSA confirms the slab. */
export function applyCertVerdict(risk: RiskSignals, verdict: CertVerdict): RiskSignals {
  if (!verdict.verified) return risk;
  const anchor: AuthenticityAnchor = 'cert-verified';
  const notes = [...(risk.notes ?? []), `PSA cert verified${verdict.subject ? `: ${verdict.subject}` : ''}`];
  return { ...risk, authenticityAnchor: anchor, notes };
}
