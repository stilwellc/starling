/**
 * ladder.ts — grade-ladder pricing (Aug 2026, lectr-side book addition).
 *
 * The book can't carry every grade of every card, but grades of the SAME card
 * move together: lectr emits `gradeLadder` ({ base, rungs }, base grade 8 =
 * 1.0) — market-wide multipliers per grade. When identify() pins a card key
 * that differs from a book key ONLY by its grade segment, we can price it:
 *
 *   med' = med × (rungs[listingGrade] / rungs[bookGrade])
 *
 * The base never enters the math (we take a ratio), which keeps this robust to
 * however lectr normalizes the rungs. Guardrails, because a derived number is
 * a weaker claim than a settled one:
 *   - sports-cards and pokemon only (both keys end in a <GRADER><num> token)
 *   - SAME grader company on both sides — PSA rungs don't price an SGC slab
 *   - 'raw' never ladders (raw↔slabbed is a different market, not a rung)
 *   - both rungs must exist and be positive, or we abstain
 *   - deals built this way carry basis:'ladder' + the source key, and clear a
 *     raised depth floor (gate.ts LADDER_MIN_DEPTH)
 * Everything is optional-tolerant: no gradeLadder (or a malformed one) simply
 * means no ladder pricing — books built before the field are untouched.
 */
import type { ValueBook, ValueBookRow, Vertical } from './types';

/** The verticals whose keys end in a grade segment the ladder understands. */
const LADDER_VERTICALS: ReadonlySet<Vertical> = new Set(['sports-cards', 'pokemon']);

/** "PSA10" / "bgs9.5" → { grader, num } — or null ('raw', junk, no number). */
function parseGradeToken(tok: string | undefined): { grader: string; num: string } | null {
  if (!tok) return null;
  const m = tok.match(/^([A-Za-z]+)(10|[1-9](?:\.5)?)$/);
  if (!m) return null;
  return { grader: m[1].toUpperCase(), num: m[2] };
}

/** Tolerant rung lookup: lectr keys rungs by grade number ("9", "9.5"); accept
 *  the full token too in case the emit lands the other way. */
function rungOf(rungs: Record<string, number>, num: string, token: string): number | null {
  const v = rungs[num] ?? rungs[token] ?? rungs[token.toUpperCase()];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** A usable ladder or null — the single shape check every caller rides. */
function ladderOf(book: ValueBook): { base: number; rungs: Record<string, number> } | null {
  const gl = book.gradeLadder;
  if (!gl || typeof gl !== 'object') return null;
  if (typeof gl.base !== 'number' || !gl.rungs || typeof gl.rungs !== 'object') return null;
  return gl;
}

/** vertical + key-minus-grade → book rows sharing that identity (any grade). */
export type LadderIndex = Map<string, ValueBookRow[]>;

function prefixOf(vertical: Vertical, key: string): string | null {
  const at = key.lastIndexOf('|');
  if (at <= 0) return null;
  return `${vertical}::${key.slice(0, at)}`;
}

/** Index the book's card rows by identity-sans-grade. Cheap (one pass), built
 *  once per run — and only when the book actually carries a gradeLadder. */
export function buildLadderIndex(book: ValueBook): LadderIndex | null {
  if (!ladderOf(book)) return null;
  const index: LadderIndex = new Map();
  for (const row of book.rows) {
    if (!LADDER_VERTICALS.has(row.v)) continue;
    const segs = row.k.split('|');
    if (!parseGradeToken(segs[segs.length - 1])) continue; // raw / unparsable — not a rung
    const p = prefixOf(row.v, row.k);
    if (!p) continue;
    const arr = index.get(p) ?? [];
    arr.push(row);
    index.set(p, arr);
  }
  return index;
}

export interface LadderHit {
  /** the DERIVED row: the listing's key with med/lo/hi scaled by the rung
   *  ratio; n/conf/lastSale/trend inherited from the source row verbatim */
  row: ValueBookRow;
  /** the exact book key the price was derived from */
  sourceKey: string;
}

/**
 * Try to ladder-price a pinned key that has no exact book row. Among same-
 * grader candidate rows the deepest pool wins (n desc, key asc as the
 * deterministic tie) — more sales behind the source row, less derivation risk.
 */
export function ladderRow(
  key: string,
  vertical: Vertical,
  book: ValueBook,
  index: LadderIndex | null,
): LadderHit | null {
  if (!index || !LADDER_VERTICALS.has(vertical)) return null;
  const ladder = ladderOf(book);
  if (!ladder) return null;

  const segs = key.split('|');
  const listGrade = parseGradeToken(segs[segs.length - 1]);
  if (!listGrade) return null;
  const listRung = rungOf(ladder.rungs, listGrade.num, segs[segs.length - 1]);
  if (listRung == null) return null;

  const p = prefixOf(vertical, key);
  if (!p) return null;

  let best: { row: ValueBookRow; rung: number } | null = null;
  for (const cand of index.get(p) ?? []) {
    if (cand.v !== vertical) continue;
    const candSegs = cand.k.split('|');
    const candTok = candSegs[candSegs.length - 1];
    const candGrade = parseGradeToken(candTok);
    if (!candGrade || candGrade.grader !== listGrade.grader) continue; // same grader only
    const candRung = rungOf(ladder.rungs, candGrade.num, candTok);
    if (candRung == null) continue;
    if (!best || cand.n > best.row.n || (cand.n === best.row.n && cand.k < best.row.k)) {
      best = { row: cand, rung: candRung };
    }
  }
  if (!best) return null;

  const f = listRung / best.rung;
  const src = best.row;
  return {
    sourceKey: src.k,
    row: {
      ...src,
      k: key,
      med: Math.round(src.med * f),
      lo: Math.round(src.lo * f),
      hi: Math.round(src.hi * f),
    },
  };
}
