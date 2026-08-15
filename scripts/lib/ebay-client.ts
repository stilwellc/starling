/**
 * ebay-client.ts — the live eBay Browse client (STARLING_MODE=live).
 *
 * Verified against the official Browse API (Aug 2026). Two tiers:
 *   Tier 1  GET /buy/browse/v1/item_summary/search   (cheap sweep, no aspects)
 *   Tier 2  GET /buy/browse/v1/item/{itemId}         (full localizedAspects)
 * Auth is the client-credentials grant (application token, ~2h). EPN affiliate
 * links come back as itemAffiliateWebUrl when the campaign header is sent.
 *
 * This file is NOT exercised in fixture mode. It exists so the switch to live is
 * a config change, not a rewrite — the long pole is eBay's keyset approval
 * (PROPOSAL §14), not this code.
 */
import type { EbayListing, EbayQuery } from '../types';
import type { EbaySearchResponse, EbayRawItem } from './ebay-types';
import { normalizeSummary, normalizeItem } from './normalize';

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BASE = 'https://api.ebay.com/buy/browse/v1';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

export interface EbayClientOpts {
  clientId: string;
  clientSecret: string;
  marketplaceId?: string; // EBAY_US | EBAY_GB | EBAY_DE
  epnCampaignId?: string;
  /** fixed reference zip so summary shipping costs resolve (US) */
  buyerZip?: string;
  /** counts every HTTP call against the daily quota ledger */
  onCall?: () => void;
}

export class EbayClient {
  private token: string | null = null;
  private tokenExpiry = 0; // epoch ms; injected via response, never Date.now at import
  constructor(private opts: EbayClientOpts) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const ctxParts: string[] = [];
    if (this.opts.epnCampaignId) ctxParts.push(`affiliateCampaignId=${this.opts.epnCampaignId}`);
    if (this.opts.buyerZip)
      ctxParts.push(`contextualLocation=country%3DUS%2Czip%3D${this.opts.buyerZip}`);
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'X-EBAY-C-MARKETPLACE-ID': this.opts.marketplaceId ?? 'EBAY_US',
      ...extra,
    };
    if (ctxParts.length) h['X-EBAY-C-ENDUSERCTX'] = ctxParts.join(',');
    return h;
  }

  private async ensureToken(now: number): Promise<void> {
    if (this.token && now < this.tokenExpiry - 60_000) return;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    });
    if (!res.ok) throw new Error(`eBay OAuth failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = j.access_token;
    this.tokenExpiry = now + j.expires_in * 1000;
  }

  /** Tier 1 — one page of a compiled query. now is injected by the caller. */
  async search(query: EbayQuery, now: number, limit = 50): Promise<EbayListing[]> {
    await this.ensureToken(now);
    const filters = ['buyingOptions:{FIXED_PRICE}'];
    if (query.priceMin != null || query.priceMax != null) {
      const lo = query.priceMin != null ? Math.floor(query.priceMin) : '';
      const hi = query.priceMax != null ? Math.ceil(query.priceMax) : '';
      filters.push(`price:[${lo}..${hi}]`, 'priceCurrency:USD');
    }
    const params = new URLSearchParams({
      q: query.q,
      limit: String(limit),
      filter: filters.join(','),
    });
    if (query.categoryIds?.length) params.set('category_ids', query.categoryIds.join(','));
    if (query.aspectFilter) params.set('aspect_filter', query.aspectFilter);
    this.opts.onCall?.();
    const res = await fetch(`${BASE}/item_summary/search?${params}`, { headers: this.headers() });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`Browse search ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbaySearchResponse;
    return (j.itemSummaries ?? []).map((s) => normalizeSummary(s, this.opts.marketplaceId));
  }

  /** Tier 2 — full item detail incl. localizedAspects. */
  async getItem(itemId: string, now: number): Promise<EbayListing> {
    await this.ensureToken(now);
    this.opts.onCall?.();
    const res = await fetch(`${BASE}/item/${encodeURIComponent(itemId)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getItem ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbayRawItem;
    return normalizeItem(j, this.opts.marketplaceId);
  }

  /** COMPACT re-check — price/availability only, for the receipts loop. Returns
   *  null when the listing is gone (no longer publicly available → ALA says
   *  delete it from the board). */
  async recheck(itemId: string, now: number): Promise<{ price?: number; available: boolean } | null> {
    await this.ensureToken(now);
    this.opts.onCall?.();
    const res = await fetch(
      `${BASE}/item/${encodeURIComponent(itemId)}?fieldgroups=COMPACT`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`recheck ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbayRawItem & { estimatedAvailabilities?: unknown[] };
    return { price: j.price ? Number(j.price.value) : undefined, available: true };
  }
}
