/**
 * enrich.ts — Tier-2 detail + authenticity upgrade.
 *
 * A Tier-1 summary has no item specifics (localizedAspects), so identify() runs
 * on the title only. For listings that pin (or plausibly pin) a key, we fetch
 * the full item (getItem) to get the aspects — grader, cert #, reference,
 * signer — and re-run identify/risk on the real data. In fixture mode listings
 * arrive pre-enriched, so this is a passthrough.
 *
 * Cert verification (PSA) is an OPPORTUNISTIC upgrade, never a dependency: the
 * free tier's quota is uncertain in 2026 (PROPOSAL §5.5), so we back off on 429
 * and simply leave the anchor at 'slab-claimed' when we can't verify.
 */
import type { EbayListing, RiskSignals, AuthenticityAnchor } from './types';
import type { EbayClient } from './lib/ebay-client';

/** Enrich the listings that need it (live mode, not yet enriched). Bounded by a
 *  cap so a runaway shortlist can't blow the Tier-2 budget. */
export async function enrich(
  listings: EbayListing[],
  opts: { mode: 'fixture' | 'live'; client?: EbayClient; now: number; cap?: number },
): Promise<EbayListing[]> {
  if (opts.mode === 'fixture') return listings; // fixtures carry aspects already
  if (!opts.client) throw new Error('live enrich requires an EbayClient');
  const cap = opts.cap ?? listings.length;
  const out: EbayListing[] = [];
  let used = 0;
  for (const l of listings) {
    if (l.enriched || used >= cap) {
      out.push(l);
      continue;
    }
    try {
      out.push(await opts.client.getItem(l.itemId, opts.now));
      used++;
    } catch (e) {
      console.warn(`[enrich] getItem ${l.itemId} failed: ${(e as Error).message}`);
      out.push(l); // keep the summary; identify may still pin from title
    }
  }
  return out;
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
