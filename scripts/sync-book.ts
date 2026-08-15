/**
 * sync-book.ts — hook into lectr's value book.
 *
 * THIS IS THE ENTIRE "DB integration." Starling holds no corpus.
 *
 * The value book is lectr's crown jewel — the whole distilled price knowledge in
 * one file. It is NOT published publicly. lectr writes value-book.json.gz to its
 * PRIVATE R2 bucket; Starling's build fetches it with a read-only, single-object
 * scoped token (never shipped to the browser). The only lectr value data that
 * ever reaches the public is board.json, and that carries book numbers for just
 * the handful of currently-surfaced deals — the irreducible minimum a deal card
 * needs to show its own evidence. The full book stays private, on both sides.
 *
 *   live:    R2 GET  <bucket>/<key>  via the Cloudflare API (bearer token)
 *   fixture: fixtures/value-book.sample.json   (offline stand-in)
 *
 * NOTE (lectr-side dependency): value-book.json.gz does NOT exist in the Ray
 * repo yet — it is ~1 day of net-new work in scripts/build-market.ts, emitting
 * into PRIVATE R2 (e.g. lectr-data/latest/value-book.json.gz), NOT the public
 * static export. Until it lands, live mode fails closed and the pipeline runs on
 * the fixture book. See PROPOSAL §3.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ValueBook, ValueBookRow, Vertical } from './types';

// Private R2 coordinates — all from the environment (this is a public repo, so
// nothing account-identifying is hardcoded). LECTR_R2_ACCOUNT_ID falls back to
// the CLOUDFLARE_ACCOUNT_ID secret; LECTR_R2_TOKEN is a read-only token scoped
// to the value-book object. Live mode fails closed if account/token are unset.
// NB: use || not ?? — an unset GitHub secret is an empty STRING, not undefined,
// and ?? wouldn't fall through it.
const R2_ACCOUNT_ID = process.env.LECTR_R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const R2_BUCKET = process.env.LECTR_R2_BUCKET || 'lectr-data';
const R2_BOOK_KEY = process.env.LECTR_R2_BOOK_KEY || 'latest/value-book.json.gz';
// Prefer a dedicated read-only token; fall back to the Cloudflare token Starling
// already holds (same account owns lectr-data), so the real book can be read
// with no new secret when that token has R2 read.
const R2_TOKEN = process.env.LECTR_R2_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

const FIXTURE_PATH = join(process.cwd(), 'fixtures', 'value-book.sample.json');

/** Max age of the book before we refuse to trust it (2 lectr nightlies). */
const STALE_MS = 48 * 60 * 60 * 1000;

export interface SyncedBook {
  book: ValueBook;
  byVertical: Map<Vertical, ValueBookRow[]>;
  byKey: Map<string, ValueBookRow>;
  source: 'fixture' | 'live';
  stale: boolean;
}

function index(book: ValueBook): Pick<SyncedBook, 'byVertical' | 'byKey'> {
  const byVertical = new Map<Vertical, ValueBookRow[]>();
  const byKey = new Map<string, ValueBookRow>();
  for (const row of book.rows) {
    byKey.set(row.k, row);
    const arr = byVertical.get(row.v) ?? [];
    arr.push(row);
    byVertical.set(row.v, arr);
  }
  return { byVertical, byKey };
}

function loadFixtureBook(): ValueBook {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ValueBook;
}

async function loadLiveBook(now: number): Promise<{ book: ValueBook; stale: boolean }> {
  if (!R2_TOKEN) {
    throw new Error(
      'LECTR_R2_TOKEN not set — the value book is private (R2), not a public URL. ' +
        'Provide a read-only token scoped to the book object, or run fixture mode.',
    );
  }
  if (!R2_ACCOUNT_ID) {
    throw new Error(
      'No R2 account id — set LECTR_R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID (kept out of source on purpose).',
    );
  }
  // Private R2 read via the Cloudflare API (same account/endpoint family as
  // data-store.sh). The book is never exposed publicly; this token is read-only,
  // scoped to the single object, and used only inside the build.
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}` +
    `/r2/buckets/${R2_BUCKET}/objects/${encodeURIComponent(R2_BOOK_KEY)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${R2_TOKEN}` } });
  if (!res.ok) {
    throw new Error(
      `value book R2 GET ${res.status} (${R2_BUCKET}/${R2_BOOK_KEY}) — ` +
        `has lectr emitted it to private R2 yet, and is the token scoped to read it?`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const json = R2_BOOK_KEY.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const book = JSON.parse(json) as ValueBook;

  // Freshness from the book's own build stamp (no public meta dependency).
  const age = now - Date.parse(book.builtAt);
  const stale = !Number.isFinite(age) || age > STALE_MS;
  return { book, stale };
}

/**
 * Load and index the value book. `now` is injected (the run timestamp) so this
 * module never reads the wall clock at import. In fixture mode staleness is not
 * enforced (the sample stamp is fixed).
 */
export async function syncBook(mode: 'fixture' | 'live', now: number): Promise<SyncedBook> {
  if (mode === 'fixture') {
    const book = loadFixtureBook();
    return { book, ...index(book), source: 'fixture', stale: false };
  }
  const { book, stale } = await loadLiveBook(now);
  if (stale) {
    console.warn(
      `[sync-book] value book is STALE (builtAt ${book.builtAt}). Proceeding but ` +
        `flagging the board — a stale book must never silently drive deals.`,
    );
  }
  return { book, ...index(book), source: 'live', stale };
}
