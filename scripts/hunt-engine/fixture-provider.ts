/**
 * fixture-provider.ts — recorded Browse payloads for tests and the explicitly
 * selected local fixture mode (STARLING_DATA_MODE=fixture). Never constructed
 * in live mode, never a fallback. Every listing it yields is stamped FIXTURE
 * in the run's mode so the dashboard labels it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hunt } from './hunts';
import { normalizeDetails, normalizeSummary, ProviderPageError, type HuntProvider, type ItemDetails, type SearchResult } from './provider';
import type { ProviderHealth } from './types';

export const FIXTURE_PATH = join(process.cwd(), 'fixtures', 'hunt-engine', 'browse-search.json');

/** fixture file shape: { [huntId]: { itemSummaries: [...] } | { error: "..." } } */
export class FixtureProvider implements HuntProvider {
  readonly kind = 'fixture' as const;
  private calls = 0;
  private data: Record<string, any>;
  constructor(data?: Record<string, any>) {
    if (data) this.data = data;
    else if (existsSync(FIXTURE_PATH)) this.data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    else this.data = {};
  }
  /** fixture file may carry `details: { [itemId]: <raw getItem> }` at the top level */
  async getItem(itemId: string): Promise<ItemDetails | null> {
    const raw = this.data.details?.[itemId];
    return raw ? normalizeDetails(raw) : null;
  }
  health(): ProviderHealth { return { status: 'fixture', calls: this.calls, rateLimit: null, message: 'fixture data — not live eBay inventory' }; }
  async search(hunt: Hunt, now: Date): Promise<SearchResult> {
    this.calls++;
    const entry = this.data[hunt.id];
    if (entry?.error) throw new ProviderPageError(String(entry.error));
    const items: any[] = entry?.itemSummaries ?? [];
    const fetchedAt = now.toISOString();
    return {
      listings: items.map((i) => normalizeSummary(i, fetchedAt)).filter((l): l is NonNullable<typeof l> => l !== null),
      pages: 1,
      returned: items.length,
      partialError: null,
      raw: [{ offset: 0, total: items.length, itemSummaries: items }],
    };
  }
}
