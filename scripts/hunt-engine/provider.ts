/**
 * provider.ts — the official eBay Browse API, server-side only.
 *
 * OAuth client-credentials token minted here and cached in memory until 60s
 * before expiry. Search is paginated per hunt (PAGE_SIZE × MAX_PAGES). Errors
 * are typed so the scan can react precisely:
 *   401/403 → ProviderAuthError: the provider fails, live work stops
 *   429     → ProviderRateLimitError: every remaining call this run is skipped
 *   timeout / 5xx / malformed page → ProviderPageError: that hunt is partial
 * Credentials never appear in thrown messages, logs, or returned objects.
 * There is no fixture fallback in this file — a fixture provider is a separate,
 * explicitly selected class (fixture-provider.ts).
 */
import type { Hunt } from './hunts';
import type { HuntListing, ProviderHealth } from './types';

/** results per search page (Browse max is 200; 100 keeps pages small and the budget predictable) */
export const PAGE_SIZE = 100;
/** pages per search on a full sweep (up to 1,000 listings each). Results come newest first;
 *  delta scans stop at the first page that reaches listings older than the last search. Hunts
 *  are paid first each tick; the deal board budgets from whatever this leaves. */
export const MAX_PAGES = 10;
export const REQUEST_TIMEOUT_MS = 20_000;
/** Per-run search ceiling: past this, searches get their FIRST page only (marked partial), so a run
 *  costs at most CALL_CEILING + one page per distinct search (pinned + recall) — three hunt runs
 *  fit a 625-call board window. */
export const CALL_CEILING = 140;

export class ProviderAuthError extends Error { constructor(msg: string) { super(msg); this.name = 'ProviderAuthError'; } }
export class ProviderRateLimitError extends Error {
  constructor(msg: string, public rateLimit: ProviderHealth['rateLimit']) { super(msg); this.name = 'ProviderRateLimitError'; }
}
export class ProviderPageError extends Error { constructor(msg: string) { super(msg); this.name = 'ProviderPageError'; } }
export class ProviderConfigError extends Error { constructor(msg: string) { super(msg); this.name = 'ProviderConfigError'; } }

export interface SearchResult {
  listings: HuntListing[];
  pages: number;
  returned: number;
  /** set when some pages succeeded and a later one failed */
  partialError: string | null;
  raw: unknown[];
}

/** eBay item details (Browse getItem): item specifics + description. */
export interface ItemDetails {
  aspects: Record<string, string>;
  description: string; // plain text, truncated
  imageUrl: string | null;
}

/** per-call search options */
export interface SearchOptions {
  /** a recall query instead of the hunt's pinned query */
  query?: string;
  /** delta scan: newest first, stop paging at the first listing created before this instant */
  since?: string | null;
}

export interface HuntProvider {
  readonly kind: 'ebay' | 'fixture';
  search(hunt: Hunt, now: Date, opts?: SearchOptions): Promise<SearchResult>;
  /** item details; null when the item is gone or the lookup failed (never throws for one bad item) */
  getItem?(itemId: string, now: Date): Promise<ItemDetails | null>;
  health(): ProviderHealth;
}

/** html → plain text (for rules; never rendered as HTML) */
export function plainText(html: string, max = 4000): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, max);
}

export function normalizeDetails(raw: any): ItemDetails {
  const aspects: Record<string, string> = {};
  for (const a of Array.isArray(raw?.localizedAspects) ? raw.localizedAspects : []) {
    if (typeof a?.name === 'string' && a.value != null) aspects[a.name] = String(a.value).slice(0, 200);
  }
  const desc = typeof raw?.description === 'string' ? raw.description : typeof raw?.shortDescription === 'string' ? raw.shortDescription : '';
  return { aspects, description: plainText(desc), imageUrl: raw?.image?.imageUrl ?? null };
}

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  env: 'production' | 'sandbox';
  marketplaceId: string;
  buyerZip?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  callCeiling?: number;
}

const HOSTS = {
  production: { oauth: 'https://api.ebay.com/identity/v1/oauth2/token', browse: 'https://api.ebay.com/buy/browse/v1' },
  sandbox: { oauth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token', browse: 'https://api.sandbox.ebay.com/buy/browse/v1' },
} as const;
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

/** strip anything that could be a credential out of a message before it travels */
export function redact(msg: string, secrets: Array<string | undefined>): string {
  let out = msg;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/v\^1\.1#[^\s"']+/g, '[redacted-token]')
    .slice(0, 400);
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** raw Browse itemSummary → HuntListing (null when a required field is missing) */
export function normalizeSummary(raw: any, fetchedAt: string): HuntListing | null {
  if (!raw || typeof raw !== 'object') return null;
  const itemId = typeof raw.itemId === 'string' ? raw.itemId : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  const url = typeof raw.itemWebUrl === 'string' ? raw.itemWebUrl : null;
  const opts: string[] = Array.isArray(raw.buyingOptions) ? raw.buyingOptions : [];
  const buyingMode = opts.includes('AUCTION') ? 'AUCTION' : opts.includes('FIXED_PRICE') ? 'FIXED_PRICE' : null;
  const priceObj = buyingMode === 'AUCTION' ? raw.currentBidPrice ?? raw.price : raw.price ?? raw.currentBidPrice;
  const price = num(priceObj?.value);
  if (!itemId || !title || !url || !buyingMode || price === null) return null;
  const shipOpts: any[] = Array.isArray(raw.shippingOptions) ? raw.shippingOptions : [];
  const costs = shipOpts.map((s) => num(s?.shippingCost?.value)).filter((n): n is number => n !== null);
  const shipping = costs.length ? Math.min(...costs) : null;
  const loc = raw.itemLocation;
  const location = loc ? [loc.city, loc.stateOrProvince, loc.country].filter(Boolean).join(', ') || null : null;
  return {
    provider: 'ebay',
    itemId,
    title,
    url,
    imageUrl: raw.image?.imageUrl ?? raw.thumbnailImages?.[0]?.imageUrl ?? null,
    price,
    priceCurrency: String(priceObj?.currency ?? 'USD'),
    shipping,
    buyingMode,
    endsAt: typeof raw.itemEndDate === 'string' ? raw.itemEndDate : null,
    listedAt: typeof raw.itemCreationDate === 'string' ? raw.itemCreationDate : null,
    bidCount: num(raw.bidCount),
    condition: typeof raw.condition === 'string' ? raw.condition : null,
    seller: raw.seller
      ? { username: raw.seller.username ?? null, feedbackPercentage: num(raw.seller.feedbackPercentage), feedbackScore: num(raw.seller.feedbackScore) }
      : null,
    location,
    fetchedAt,
  };
}

export class EbayBrowseProvider implements HuntProvider {
  readonly kind = 'ebay' as const;
  private token: { value: string; expiresAt: number } | null = null;
  private calls = 0;
  private stopped: ProviderHealth['status'] | null = null;
  private rateLimit: ProviderHealth['rateLimit'] = null;
  private lastMessage: string | null = null;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(private cfg: EbayConfig) {
    if (!cfg.clientId || !cfg.clientSecret) throw new ProviderConfigError('eBay credentials missing (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)');
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  private secrets() { return [this.cfg.clientId, this.cfg.clientSecret, this.token?.value]; }
  private clean(msg: string) { return redact(msg, this.secrets()); }

  health(): ProviderHealth {
    return {
      status: this.stopped ?? (this.lastMessage ? 'degraded' : 'ok'),
      calls: this.calls,
      rateLimit: this.rateLimit,
      message: this.lastMessage,
    };
  }

  private async timed(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new ProviderPageError(`timeout after ${this.timeoutMs}ms`);
      throw new ProviderPageError(this.clean(`network error: ${e?.message ?? e}`));
    } finally {
      clearTimeout(t);
    }
  }

  /** mint once, reuse until 60s before expiry */
  async ensureToken(now = Date.now()): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.timed(HOSTS[this.cfg.env].oauth, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    });
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      this.stopped = 'auth-failed';
      throw new ProviderAuthError(`eBay OAuth rejected the application credentials (HTTP ${res.status})`);
    }
    if (!res.ok) throw new ProviderPageError(`eBay OAuth HTTP ${res.status}`);
    let body: any;
    try { body = await res.json(); } catch { throw new ProviderPageError('eBay OAuth returned malformed JSON'); }
    if (typeof body?.access_token !== 'string') throw new ProviderPageError('eBay OAuth response had no access_token');
    this.token = { value: body.access_token, expiresAt: now + (Number(body.expires_in) || 7200) * 1000 };
    return this.token.value;
  }

  private rateHeaders(res: Response): ProviderHealth['rateLimit'] {
    const h = (k: string) => res.headers.get(k);
    return {
      limit: h('x-ratelimit-limit') ?? h('x-ebay-c-ratelimit-limit'),
      remaining: h('x-ratelimit-remaining') ?? h('x-ebay-c-ratelimit-remaining'),
      reset: h('x-ratelimit-reset') ?? h('x-ebay-c-ratelimit-reset'),
      retryAfter: h('retry-after'),
    };
  }

  private detailCalls = 0;
  private detailsStopped = false;
  detailHealth() { return { calls: this.detailCalls, stopped: this.detailsStopped }; }

  /** singular getItem (batch getItems is limited-release for this keyset). A 429 stops details only. */
  async getItem(itemId: string, now: Date): Promise<ItemDetails | null> {
    if (this.stopped || this.detailsStopped) return null;
    let token: string;
    try { token = await this.ensureToken(now.getTime()); } catch { return null; }
    this.detailCalls++;
    let res: Response;
    try {
      res = await this.timed(`${HOSTS[this.cfg.env].browse}/item/${encodeURIComponent(itemId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': this.cfg.marketplaceId,
          'X-EBAY-C-ENDUSERCTX': `contextualLocation=country%3DUS%2Czip%3D${encodeURIComponent(this.cfg.buyerZip ?? '10001')}`,
        },
      });
    } catch { return null; }
    if (res.status === 429) { this.detailsStopped = true; return null; }
    if (res.status === 401 || res.status === 403) { this.detailsStopped = true; return null; }
    if (!res.ok) return null;
    try { return normalizeDetails(await res.json()); } catch { return null; }
  }

  async search(hunt: Hunt, now: Date, opts: SearchOptions = {}): Promise<SearchResult> {
    if (this.stopped === 'auth-failed') throw new ProviderAuthError('provider stopped after an authentication failure');
    if (this.stopped === 'rate-limited') throw new ProviderRateLimitError('provider stopped after a 429 this run', this.rateLimit);
    const fetchedAt = now.toISOString();
    const listings: HuntListing[] = [];
    const raw: unknown[] = [];
    let pages = 0;
    let returned = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0 && this.calls >= (this.cfg.callCeiling ?? CALL_CEILING)) {
        return { listings, pages, returned, partialError: `run call ceiling (${this.cfg.callCeiling ?? CALL_CEILING}) reached — first page only`, raw };
      }
      const token = await this.ensureToken(now.getTime());
      // newest first: a brand-new listing is always on page 1, and delta scans stop early
      const params = new URLSearchParams({
        q: opts.query ?? hunt.query,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        sort: 'newlyListed',
        filter: `buyingOptions:{${hunt.buyingModes.join('|')}}`,
      });
      let res: Response;
      try {
        this.calls++;
        res = await this.timed(`${HOSTS[this.cfg.env].browse}/item_summary/search?${params}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': this.cfg.marketplaceId,
            'X-EBAY-C-ENDUSERCTX': `contextualLocation=country%3DUS%2Czip%3D${encodeURIComponent(this.cfg.buyerZip ?? '10001')}`,
          },
        });
      } catch (e: any) {
        const msg = this.clean(e?.message ?? String(e));
        this.lastMessage = msg;
        if (pages > 0) return { listings, pages, returned, partialError: msg, raw };
        throw e instanceof ProviderPageError ? new ProviderPageError(msg) : e;
      }
      if (res.status === 401 || res.status === 403) {
        this.stopped = 'auth-failed';
        this.lastMessage = `Browse search HTTP ${res.status}`;
        throw new ProviderAuthError(`eBay Browse rejected the token (HTTP ${res.status})`);
      }
      if (res.status === 429) {
        this.stopped = 'rate-limited';
        this.rateLimit = this.rateHeaders(res);
        this.lastMessage = 'Browse search HTTP 429';
        throw new ProviderRateLimitError('eBay rate limit hit (HTTP 429) — remaining calls skipped this run', this.rateLimit);
      }
      if (res.status === 204) break;
      if (!res.ok) {
        const msg = `Browse search HTTP ${res.status}`;
        this.lastMessage = msg;
        if (pages > 0) return { listings, pages, returned, partialError: msg, raw };
        throw new ProviderPageError(msg);
      }
      let body: any;
      try { body = await res.json(); } catch {
        const msg = 'Browse search returned malformed JSON';
        this.lastMessage = msg;
        if (pages > 0) return { listings, pages, returned, partialError: msg, raw };
        throw new ProviderPageError(msg);
      }
      if (body == null || typeof body !== 'object' || (body.itemSummaries != null && !Array.isArray(body.itemSummaries))) {
        const msg = 'Browse search payload had an unexpected shape';
        this.lastMessage = msg;
        if (pages > 0) return { listings, pages, returned, partialError: msg, raw };
        throw new ProviderPageError(msg);
      }
      pages++;
      const items: any[] = body.itemSummaries ?? [];
      returned += items.length;
      raw.push({ offset: page * PAGE_SIZE, total: body.total ?? null, itemSummaries: items });
      for (const it of items) {
        const l = normalizeSummary(it, fetchedAt);
        if (l) listings.push(l);
      }
      const total = Number(body.total ?? 0);
      if (items.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) break;
      // delta: results are newest-first, so once a page reaches listings older than `since` we're done
      if (opts.since) {
        const oldest = items[items.length - 1]?.itemCreationDate;
        if (typeof oldest === 'string' && Date.parse(oldest) < Date.parse(opts.since)) break;
      }
    }
    const kept = opts.since ? listings.filter((l) => !l.listedAt || Date.parse(l.listedAt) >= Date.parse(opts.since!)) : listings;
    return { listings: kept, pages, returned, partialError: null, raw };
  }
}
