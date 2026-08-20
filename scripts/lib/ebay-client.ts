/**
 * ebay-client.ts — the live eBay Browse client (STARLING_MODE=live).
 *
 * Verified against the official Browse API (Aug 2026). Two tiers, TWO QUOTAS:
 *   Tier 1  GET /buy/browse/v1/item_summary/search   (search bucket, 5,000/day)
 *           - search():    compiled per-query poll (the hunt lane)
 *           - sweepPage(): one page of a category sweep (sweep.ts's primitive)
 *   Tier 2  GET /buy/browse/v1/item?item_ids=…       (getItems BATCH, ≤20 ids
 *           per call — its OWN separate 5,000/day bucket; enrichment and the
 *           receipts re-check loop both ride it, never the search quota)
 * Auth is the client-credentials grant (application token, ~2h). EPN affiliate
 * links come back as itemAffiliateWebUrl when the campaign header is sent.
 *
 * `calls` ledgers every HTTP call per bucket — run-board publishes it in
 * board.stats so quota spend is on the record, not vibes.
 *
 * This file is NOT exercised in fixture mode. It exists so the switch to live is
 * a config change, not a rewrite — the long pole is eBay's keyset approval
 * (PROPOSAL §14), not this code.
 */
import type { EbayListing, EbayQuery } from '../types';
import type { EbaySearchResponse, EbayRawItem } from './ebay-types';
import { normalizeSummary, normalizeItem } from './normalize';

/** getItems hard batch limit (API rule). */
export const GET_ITEMS_BATCH = 20;

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
  /** per-bucket call ledger — search and getItems are separate daily quotas */
  readonly calls = { search: 0, getItems: 0 };
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
    this.calls.search++;
    const res = await fetch(`${BASE}/item_summary/search?${params}`, { headers: this.headers() });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`Browse search ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbaySearchResponse;
    return (j.itemSummaries ?? []).map((s) => normalizeSummary(s, this.opts.marketplaceId));
  }

  /**
   * Tier 1 — one page of a CATEGORY SWEEP (sweep.ts's only primitive).
   * ONE category id per call (API rule: mixed-id filtering silently degrades),
   * sort=newlyListed, limit up to 200, raw filter strings from the slice
   * (`price:[…]` REQUIRES `priceCurrency:USD` alongside — the slice tables in
   * sweep.ts carry them paired). Throws on non-OK so the caller can probe the
   * error-1697 sort+filter incompatibility and fall back gracefully.
   */
  async sweepPage(
    opts: { categoryId: string; filters: string[]; offset?: number; limit?: number; sort?: string },
    now: number,
  ): Promise<EbayListing[]> {
    await this.ensureToken(now);
    const params = new URLSearchParams({
      category_ids: opts.categoryId, // exactly one — never joined
      sort: opts.sort ?? 'newlyListed',
      limit: String(opts.limit ?? 200),
      offset: String(opts.offset ?? 0),
      filter: opts.filters.join(','),
    });
    this.opts.onCall?.();
    this.calls.search++;
    const res = await fetch(`${BASE}/item_summary/search?${params}`, { headers: this.headers() });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`Browse sweep ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbaySearchResponse;
    return (j.itemSummaries ?? []).map((s) => normalizeSummary(s, this.opts.marketplaceId));
  }

  /** Tier 2 — full item detail incl. localizedAspects (single). Prefer
   *  getItems() batches; this survives for one-off needs. */
  async getItem(itemId: string, now: number): Promise<EbayListing> {
    await this.ensureToken(now);
    this.opts.onCall?.();
    this.calls.getItems++;
    const res = await fetch(`${BASE}/item/${encodeURIComponent(itemId)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getItem ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as EbayRawItem;
    return normalizeItem(j, this.opts.marketplaceId);
  }

  /**
   * Tier 2 BATCH — up to 20 full items in ONE call, on getItems' OWN 5,000/day
   * quota bucket (separate from search). This is how enrichment and the
   * receipts re-check loop scale: 20× the coverage per quota unit. Items no
   * longer publicly available are simply ABSENT from the response (the ALA
   * take-down signal) — callers read absence, not errors.
   */
  async getItems(itemIds: string[], now: number): Promise<EbayListing[]> {
    if (itemIds.length === 0) return [];
    if (itemIds.length > GET_ITEMS_BATCH) {
      throw new Error(`getItems batch is ${itemIds.length} ids — the API caps at ${GET_ITEMS_BATCH}; chunk upstream`);
    }
    await this.ensureToken(now);
    const ids = itemIds.map(encodeURIComponent).join(',');
    this.opts.onCall?.();
    this.calls.getItems++;
    const res = await fetch(`${BASE}/item?item_ids=${ids}`, { headers: this.headers() });
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`getItems ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { items?: EbayRawItem[] };
    return (j.items ?? []).map((it) => normalizeItem(it, this.opts.marketplaceId));
  }
}
