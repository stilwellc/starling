/**
 * store.ts — where evidence lives. One interface, three backends: R2 over the
 * Cloudflare REST API (production, same API data-store.sh uses), a directory
 * (local fixture mode), memory (tests). Every write is a whole-object PUT, so
 * promoting manifests/latest.json is a single atomic swap.
 *
 * Layout (all under the `hunt/` prefix in bucket starling-data):
 *   runs/{runId}/summary.json            immutable run record
 *   runs/{runId}/raw/ebay/{huntId}.json  raw Browse pages, as returned
 *   runs/{runId}/evaluations/{huntId}.json  every candidate, kept or rejected, with reasons
 *   listings/ebay/{itemId}.json          latest normalized listing
 *   manifests/{runId}.json               immutable promoted manifest
 *   manifests/latest.json                pointer (full copy), swapped last
 *   alerts/ledger.json                   dedupe + alert queue
 *   public/dashboard.json                the published view model
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ObjectStore {
  readonly kind: 'r2' | 'file' | 'memory';
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
}

export const PREFIX = 'hunt/';

export class MemoryStore implements ObjectStore {
  readonly kind = 'memory' as const;
  objects = new Map<string, string>();
  writes: string[] = [];
  failOn: ((key: string) => boolean) | null = null;
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, body: string) {
    if (this.failOn?.(key)) throw new Error(`simulated write failure: ${key}`);
    this.objects.set(key, body);
    this.writes.push(key);
  }
}

export class FileStore implements ObjectStore {
  readonly kind = 'file' as const;
  constructor(private root: string) {}
  async get(key: string) {
    const p = join(this.root, key);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  async put(key: string, body: string) {
    const p = join(this.root, key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}

export class R2RestStore implements ObjectStore {
  readonly kind = 'r2' as const;
  private base: string;
  constructor(private cfg: { accountId: string; token: string; bucket: string; fetchImpl?: typeof fetch }) {
    this.base = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/r2/buckets/${cfg.bucket}/objects/`;
  }
  private url(key: string) { return this.base + encodeURIComponent(key); }
  async get(key: string): Promise<string | null> {
    const f = this.cfg.fetchImpl ?? fetch;
    const res = await f(this.url(key), { headers: { Authorization: `Bearer ${this.cfg.token}` } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${key} → HTTP ${res.status}`);
    return await res.text();
  }
  async put(key: string, body: string): Promise<void> {
    const f = this.cfg.fetchImpl ?? fetch;
    let last = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await f(this.url(key), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    throw new Error(`R2 PUT ${key} failed (${last})`);
  }
}

export async function getJson<T>(store: ObjectStore, key: string): Promise<T | null> {
  const s = await store.get(PREFIX + key);
  if (s == null) return null;
  try { return JSON.parse(s) as T; } catch { throw new Error(`stored object ${key} is not valid JSON`); }
}
export async function putJson(store: ObjectStore, key: string, value: unknown): Promise<void> {
  await store.put(PREFIX + key, JSON.stringify(value, null, 1));
}
