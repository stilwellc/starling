/**
 * hunt.ts — the hunt list: curated priorities above the book (PROPOSAL §4.4).
 *
 * The book is the floor, not the strategy. hunt/priority.yaml is Collin's taste
 * made machine-readable: a small, PR-reviewed set of targets that poll EVERY
 * run, paid from a reserved 10% of the call budget (scheduler.ts) — never
 * rationed against the book's key count, never on the rotating wheel.
 *
 * Two hard rules encoded here:
 *   1. A malformed hunt file FAILS THE RUN LOUDLY. A silently-dropped grail is
 *      the worst bug this system can have, so validation throws with the entry
 *      and field named — no warn-and-continue, no partial list. (A MISSING file
 *      is different: the list is operator-staged and CI may not carry it yet,
 *      so absent → empty list with a loud warning, same spirit as load-board's
 *      pre-first-run tolerance.)
 *   2. The book still prices; the list only prioritizes. Compilation may loosen
 *      the depth floor per entry (minDepth) but the 0.90 scam cap is structural
 *      — it is not representable here and gate.huntGate() never reads one.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  EbayQuery,
  HuntTarget,
  ValueBookRow,
  Vertical,
  VerticalMatcher,
} from './types';
import { MAX_DEPTH } from './gate';

export const HUNT_PATH = join(process.cwd(), 'hunt', 'priority.yaml');

// ─────────────────────────────────────────────────────────────────────────────
// The config schema — hunt/priority.yaml is the source of truth
// ─────────────────────────────────────────────────────────────────────────────

/** Exactly one match form per entry (validated):
 *    { key }                — exact identity key in the book
 *    { keyPrefix }          — a key family ("kaws|")
 *    { q, categoryHint }    — raw terms when no key exists yet */
export type HuntMatch =
  | { key: string }
  | { keyPrefix: string }
  | { q: string; categoryHint: string };

export interface HuntEntry {
  /** stable slug — the hunt stamp on every hit, and the fixture-file key */
  id: string;
  label: string;
  /** the operator's lens — free taxonomy, may name pockets beyond the launch
   *  Vertical set. When it IS a launch vertical, that matcher identifies hits. */
  vertical: string;
  match: HuntMatch;
  /** optional ceiling — ignore listings above it (a grail, not at any price) */
  maxAllIn?: number;
  /** optional LOOSER depth floor than the board's 0.25; must sit under the
   *  0.90 scam cap, which is never overridable */
  minDepth?: number;
  note?: string;
  added: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader + validator — malformed fails LOUDLY
// ─────────────────────────────────────────────────────────────────────────────

/** Throw with the file, entry, and problem named — the loud failure. */
function bad(context: string, problem: string): never {
  throw new Error(`[hunt] MALFORMED hunt/priority.yaml — ${context}: ${problem}. ` +
    `Refusing to run: a silently-dropped grail is the worst bug this system can have.`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(entry: string, field: string, v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) bad(entry, `"${field}" must be a non-empty string`);
  return v.trim();
}

function validateMatch(entry: string, v: unknown): HuntMatch {
  if (!isRecord(v)) bad(entry, '"match" must be a mapping');
  const forms = ['key', 'keyPrefix', 'q'].filter((k) => v[k] != null);
  if (forms.length !== 1) {
    bad(entry, `"match" must use exactly ONE of key | keyPrefix | q (found: ${forms.join(', ') || 'none'})`);
  }
  const known = ['key', 'keyPrefix', 'q', 'categoryHint'];
  for (const k of Object.keys(v)) {
    if (!known.includes(k)) bad(entry, `"match.${k}" is not a recognized field`);
  }
  if (v.key != null) {
    if (v.categoryHint != null) bad(entry, '"match.categoryHint" only accompanies raw "q" terms');
    return { key: requireString(entry, 'match.key', v.key) };
  }
  if (v.keyPrefix != null) {
    if (v.categoryHint != null) bad(entry, '"match.categoryHint" only accompanies raw "q" terms');
    return { keyPrefix: requireString(entry, 'match.keyPrefix', v.keyPrefix) };
  }
  return {
    q: requireString(entry, 'match.q', v.q),
    categoryHint: requireString(entry, 'match.categoryHint', v.categoryHint),
  };
}

function validateEntry(raw: unknown, index: number, seenIds: Set<string>): HuntEntry {
  if (!isRecord(raw)) bad(`entry #${index + 1}`, 'each list item must be a mapping');
  const id = requireString(`entry #${index + 1}`, 'id', raw.id);
  const ctx = `entry "${id}"`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) bad(ctx, '"id" must be a stable slug (lowercase, digits, hyphens)');
  if (seenIds.has(id)) bad(ctx, 'duplicate id — every target must be uniquely addressable');
  seenIds.add(id);

  const entry: HuntEntry = {
    id,
    label: requireString(ctx, 'label', raw.label),
    vertical: requireString(ctx, 'vertical', raw.vertical),
    match: validateMatch(ctx, raw.match),
    added: requireString(ctx, 'added', raw.added),
  };
  if (Number.isNaN(Date.parse(entry.added))) bad(ctx, `"added" is not a parseable date (${entry.added})`);

  if (raw.maxAllIn != null) {
    if (typeof raw.maxAllIn !== 'number' || !Number.isFinite(raw.maxAllIn) || raw.maxAllIn <= 0) {
      bad(ctx, '"maxAllIn" must be a positive number (USD)');
    }
    entry.maxAllIn = raw.maxAllIn;
  }
  if (raw.minDepth != null) {
    if (typeof raw.minDepth !== 'number' || !Number.isFinite(raw.minDepth)) {
      bad(ctx, '"minDepth" must be a number');
    }
    // minDepth loosens the 0.25 floor; it must never reach the scam cap — the
    // 0.90 suppression is the one non-negotiable in the system.
    if (raw.minDepth < 0 || raw.minDepth >= MAX_DEPTH) {
      bad(ctx, `"minDepth" must sit in [0, ${MAX_DEPTH}) — the scam cap is not overridable`);
    }
    entry.minDepth = raw.minDepth;
  }
  if (raw.note != null) {
    if (typeof raw.note !== 'string') bad(ctx, '"note" must be a string');
    entry.note = raw.note.trim();
  }
  return entry;
}

/**
 * Load + validate the hunt list. Malformed → throws (fails the run, §6.1 step
 * 1). Missing → [] with a loud warning (the file is operator-staged; a clone
 * without it runs book-only, and the hunt lane sits idle — visibly, not
 * silently).
 */
export function loadHuntList(path = HUNT_PATH): HuntEntry[] {
  if (!existsSync(path)) {
    console.warn('[hunt] hunt/priority.yaml not found — hunt lane idle this run (book-only).');
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (e) {
    bad('file', `YAML parse failed (${(e as Error).message})`);
  }
  if (parsed == null) return []; // an intentionally emptied list is valid
  if (!Array.isArray(parsed)) bad('file', 'top level must be a list of targets');
  const seen = new Set<string>();
  return parsed.map((raw, i) => validateEntry(raw, i, seen));
}

/** The board-facing shape of a target (what /hunt renders per entry). */
export function toHuntTarget(e: HuntEntry): HuntTarget {
  return { id: e.id, label: e.label, vertical: e.vertical, note: e.note, added: e.added };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query compilation — entries → the eBay search plan the hunt lane polls
// ─────────────────────────────────────────────────────────────────────────────

/** A keyPrefix can fan out over a whole key family; cap the fan-out per entry
 *  (highest-med rows first) so one broad prefix can't starve later targets of
 *  the reserved budget. Deterministic — no clock, no randomness. */
const MAX_QUERIES_PER_ENTRY = 8;

// ── raw-terms relevance (the first live run's lesson) ────────────────────────
// eBay's q search is keyword-ish and spans accessories/apparel; a "philadelphia
// eagles" cards target matched a Full Zip jacket. Two cheap, honest guards for
// hits that arrive WITHOUT a pinned identity (the noBook lane):
//   1. every non-stopword q token must appear in the title
//   2. the entry's vertical must show a weak object signal in the title
// Priced hits never pass through this — their identity IS the relevance proof.
const Q_STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'with']);
const VERTICAL_HINT: Record<string, RegExp> = {
  'sports-cards': /\b(card|cards|psa|bgs|sgc|cgc|rookie|rc|refractor|prizm|topps|bowman|#\s?[a-z0-9]+)\b/i,
  pokemon: /\b(pokemon|pok[eé]mon|psa|cgc|bgs|charizard|holo)\b/i,
  'art-editions': /\b(print|lithograph|screenprint|etching|edition|poster|multiple)\b/i,
  autographs: /\b(signed|autograph(?:ed)?|als|tls|psa\/dna|jsa|beckett)\b/i,
  sports: /\b(game[- ](?:used|worn)|jersey|photo[- ]?match)/i,
  science: /\b(fossil|meteorite|apple|computer|prototype|nasa|flown|patent|manual)\b/i,
};
/** Category scoping for raw-q hunt queries — only trees where narrowing is safe. */
export const HUNT_CATEGORY_SCOPE: Record<string, string[]> = {
  'sports-cards': ['212'],   // Sports Mem, Cards & Fan Shop > Sports Trading Cards
  sports: ['64482'],         // Sports Mem, Cards & Fan Shop
};

/** Relevance guard for un-pinned (noBook) hunt hits from raw-terms targets. */
export function huntRelevant(entry: HuntEntry, title: string): boolean {
  if (!('q' in entry.match)) return true;   // key/keyPrefix targets are pinned by construction
  const t = title.toLowerCase();
  const tokens = entry.match.q.toLowerCase().split(/\s+/).filter(w => w && !Q_STOP.has(w));
  if (!tokens.every(w => t.includes(w))) return false;
  const hint = VERTICAL_HINT[entry.vertical];
  return hint ? hint.test(title) : true;
}

/** noBook hits kept per target on the published board — newest first. The lane
 *  is a watch list, not a firehose; 375 rows on the first live run was payload
 *  bloat, not signal. Priced hits are never capped (they earned admission). */
export const NOBOOK_CAP_PER_TARGET = 8;

export interface CompiledHuntQuery {
  entry: HuntEntry;
  query: EbayQuery;
  /** the matcher vertical that identifies this query's hits, when one exists —
   *  null for raw-terms entries outside the launch set (their hits can only
   *  surface via the "hunted — no book value" path) */
  identifyVertical: Vertical | null;
}

function isLaunchVertical(v: string, matcherFor: Partial<Record<Vertical, VerticalMatcher>>): v is Vertical {
  return (v as Vertical) in matcherFor && matcherFor[v as Vertical] != null;
}

/** Compile one book row through its vertical's matcher. */
function compileRow(
  entry: HuntEntry,
  row: ValueBookRow,
  matcherFor: Partial<Record<Vertical, VerticalMatcher>>,
): CompiledHuntQuery | null {
  const matcher = matcherFor[row.v];
  if (!matcher) {
    console.warn(`[hunt] ${entry.id}: book key "${row.k}" is in vertical "${row.v}" with no matcher — skipped.`);
    return null;
  }
  const [query] = matcher.queriesFor([row]);
  if (!query) {
    console.warn(`[hunt] ${entry.id}: matcher for "${row.v}" compiled no query for "${row.k}" — skipped.`);
    return null;
  }
  return { entry, query, identifyVertical: row.v };
}

/**
 * Compile the hunt list against the synced book:
 *   key       → that row, through its vertical's matcher
 *   keyPrefix → every matching row (med-desc, capped), each through its matcher
 *   q         → the raw terms verbatim; categoryHint rides along as documentation
 *               until the P0 taxonomy pass maps hints to leaf category ids
 *               (same placeholder posture as the matchers' hardcoded ids)
 * A key/prefix that matches nothing is a LOUD warning, never a quiet drop —
 * the book changes nightly, so this is a data condition, not a config error.
 */
export function compileHuntQueries(
  entries: HuntEntry[],
  synced: { byKey: Map<string, ValueBookRow>; rows: ValueBookRow[] },
  matcherFor: Partial<Record<Vertical, VerticalMatcher>>,
): CompiledHuntQuery[] {
  const out: CompiledHuntQuery[] = [];
  for (const entry of entries) {
    if ('key' in entry.match) {
      const row = synced.byKey.get(entry.match.key);
      if (!row) {
        console.warn(
          `[hunt] ${entry.id}: key "${entry.match.key}" is not in the book this run — ` +
            `no query compiled (retries when the book carries it).`,
        );
        continue;
      }
      const c = compileRow(entry, row, matcherFor);
      if (c) out.push(c);
    } else if ('keyPrefix' in entry.match) {
      const prefix = entry.match.keyPrefix;
      const rows = synced.rows
        .filter((r) => r.k.startsWith(prefix))
        .sort((a, b) => b.med - a.med);
      if (rows.length === 0) {
        console.warn(`[hunt] ${entry.id}: keyPrefix "${prefix}" matches no book row this run — no query compiled.`);
        continue;
      }
      if (rows.length > MAX_QUERIES_PER_ENTRY) {
        console.warn(
          `[hunt] ${entry.id}: keyPrefix "${prefix}" matches ${rows.length} rows — ` +
            `polling the top ${MAX_QUERIES_PER_ENTRY} by med so one family can't eat the reserve.`,
        );
      }
      for (const row of rows.slice(0, MAX_QUERIES_PER_ENTRY)) {
        const c = compileRow(entry, row, matcherFor);
        if (c) out.push(c);
      }
    } else {
      out.push({
        entry,
        query: {
          key: `hunt:${entry.id}`,
          q: entry.match.q,
          // Category scoping where it's safe. A bare q search spans ALL of
          // eBay — the first live run matched a zip-up jacket to a cards
          // target. Only verticals whose category tree is unambiguous get
          // scoped (over-narrowing kills recall on culture/science targets);
          // everything else relies on the relevance guard below.
          categoryIds: HUNT_CATEGORY_SCOPE[entry.vertical] ?? [],
          // the ceiling is also a search bound — never pay eBay calls for
          // listings the gate would discard anyway
          priceMax: entry.maxAllIn,
        },
        identifyVertical: isLaunchVertical(entry.vertical, matcherFor) ? entry.vertical : null,
      });
    }
  }
  return out;
}
