/**
 * context.ts — the context tier: lectr's rollup evidence for hits with no exact
 * book row (the hunt fix, Aug 2026).
 *
 * A hit with no book key shouldn't read "no book value" when lectr HAS nearby
 * evidence one level up the identity ladder — a signer across formats, a player
 * × object slug, a curated natural-history/early-tech class. lectr emits those
 * rollups as book.context (emit-value-book.ts, schema-additive); this module
 * matches a listing to one.
 *
 * A context row is NEVER a priced call: no depth, no rank, no gate override.
 * It annotates ("Charles Schulz signed material — 41 sales, $150–$2.4K") and it
 * qualifies sweep leads (allIn ≤ 0.5× context med → board.leads) — always
 * labeled by kind so the caption stays honest.
 *
 * CLASS_CANON is a CROSS-REPO CONTRACT, ported VERBATIM from lectr
 * (Ray: scripts/emit-value-book.ts). The ids are the context keys; keep both
 * sides byte-identical or class rollups silently never match.
 */
import { slug } from './lib/slug';
import { resolveSigner } from './match/autographs';
import type { ContextRow, DealContext, EbayListing } from './types';

// ── CLASS_CANON — VERBATIM from Ray scripts/emit-value-book.ts ───────────────
export const CLASS_CANON: [string, RegExp][] = [
  ['trex-tooth', /\b(?:t[- ]?rex|tyrannosaur\w*)\b.*\btooth|\btooth\b.*\b(?:t[- ]?rex|tyrannosaur\w*)\b/i],
  ['megalodon-tooth', /\bmegalodon\b/i],
  ['mosasaur-tooth', /\bmosasaur\w*\b/i],
  ['raptor-claw', /\braptor\b.*\bclaw|\bclaw\b.*\braptor\b/i],
  ['ammonite', /\bammonite\b/i],
  ['trilobite', /\btrilobite\b/i],
  ['dinosaur-egg', /\bdinosaur\b.*\begg|\begg\b.*\bdinosaur\b/i],
  ['meteorite', /\bmeteorite\b/i],
  ['apple-1', /\bapple[- ]?(?:1|one)\b/i],
  ['apple-ii', /\bapple[- ]?(?:2|ii)\b/i],
  ['macintosh-vintage', /\bmacintosh\b|\bmac\b.*\b(?:128k|512k|plus|se)\b/i],
];

// ─────────────────────────────────────────────────────────────────────────────
// The context index — kind-qualified keys, mirroring lectr's `${kind}:${k}`
// pooling, so a signer "megalodon-tooth" (never say never) can't collide with
// the class of the same name.
// ─────────────────────────────────────────────────────────────────────────────

export type ContextIndex = Map<string, ContextRow>;

/** Index the book's context tier. Absent/empty → an empty index (books built
 *  before the tier exist; every caller just gets no annotations). */
export function indexContext(rows: ContextRow[] | undefined): ContextIndex {
  const idx: ContextIndex = new Map();
  for (const r of rows ?? []) idx.set(`${r.kind}:${r.k}`, r);
  return idx;
}

/** The board-facing stamp: drop lectr's market lens `v` (contract v2 — the
 *  deal carries its own vertical string). */
export function toDealContext(row: ContextRow): DealContext {
  return { k: row.k, kind: row.kind, med: row.med, lo: row.lo, hi: row.hi, n: row.n, lastSale: row.lastSale };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate context keys for a listing
// ─────────────────────────────────────────────────────────────────────────────

/** Signed-material signal — mirrors lectr's contextKeysForLot gate (a signer
 *  rollup only applies when the listing IS signed material). */
const SIGNED_RE = /\bsigned\b|\bautograph/i;

/** Game-used object language — the player-object rollups lectr carries today
 *  are `<playerSlug>|game-used` (jerseys/equipment pools). */
const GAME_USED_RE = /\bgame[- ](?:used|worn)\b/i;

/** Leading-name heuristic for player-object keys: the first two capitalized
 *  name tokens of the title ("Reggie White Philadelphia Eagles Game Used…" →
 *  reggie-white). Two tokens exactly — a longer run swallows the team name, a
 *  shorter one is a stray word; abstention is correct either way. */
function leadingPlayerSlug(title: string): string | null {
  const tokens = title.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const isName = (tok: string) => /^[A-Z][A-Za-z'’.\-]*$/.test(tok.replace(/[.,]+$/, ''));
  if (!isName(tokens[0]) || !isName(tokens[1])) return null;
  const s = slug(`${tokens[0]} ${tokens[1]}`);
  return s || null;
}

/** The minimal hunt-entry lens contextFor needs — avoids importing hunt.ts
 *  (which would drag the yaml loader into every consumer). */
export interface ContextEntryHint {
  vertical: string;
}

/**
 * Match a listing to a context row, or null. Tries, in order:
 *   (a) class canon on the title (fossils / early tech / meteorites);
 *   (b) signer — the autographs matcher's own signer resolution, slugged, when
 *       the title carries signed/autograph language;
 *   (c) player-object — for sports hunt entries with game-used language, the
 *       leading-name slug + "|game-used".
 * Only rows the BOOK actually carries can return — the index is the evidence,
 * the heuristics only propose keys.
 */
export function contextFor(
  listing: EbayListing,
  index: ContextIndex,
  entry?: ContextEntryHint,
): ContextRow | null {
  if (index.size === 0) return null;
  const title = listing.title || '';

  // (a) class canon — first matching class wins, as in lectr's emit
  for (const [id, re] of CLASS_CANON) {
    if (re.test(title)) {
      const row = index.get(`class:${id}`);
      if (row) return row;
      break; // canon matched but the book has no rollup — don't fall through to a wrong kind
    }
  }

  // (b) signer rollup — signed material only
  if (SIGNED_RE.test(title)) {
    const signer = resolveSigner(listing);
    if (signer) {
      const row = index.get(`signer:${slug(signer)}`);
      if (row) return row;
    }
  }

  // (c) player-object — sports hunt entries with game-used language
  if (entry?.vertical === 'sports' && GAME_USED_RE.test(title)) {
    const player = leadingPlayerSlug(title);
    if (player) {
      const row = index.get(`player-object:${player}|game-used`);
      if (row) return row;
    }
  }

  return null;
}
