/**
 * display.ts — presentation-only helpers shared across the board UI.
 * No data manufacturing here: every number originates in board.json (lectr's
 * corpus). These functions only format what's already been decided.
 */
import type { Vertical, RiskGrade, Confidence, ReceiptOutcome } from '@/scripts/types';

/** The live board verticals, in board order — the pockets lectr has the most
 *  data on. Cards get NO special prominence (PROPOSAL §2); this is not a ranking,
 *  just the chip/filter order. Watches and design are in the type union but off
 *  the launch board (watches: condition/authenticity noise; design: P4), so they
 *  are intentionally absent here — no empty filter chips, no dead static pages. */
export const ALL_VERTICALS: Vertical[] = [
  'sports-cards',
  'autographs',
  'pokemon',
  'art-editions',
];

const VERTICAL_LABELS: Record<Vertical, string> = {
  watches: 'Watches',
  'sports-cards': 'Sports Cards',
  pokemon: 'Pokémon',
  'art-editions': 'Art Editions',
  autographs: 'Autographs',
  design: 'Design',
};

export function verticalLabel(v: Vertical): string {
  return VERTICAL_LABELS[v] ?? v;
}

export function isVertical(v: string): v is Vertical {
  return (ALL_VERTICALS as string[]).includes(v);
}

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Whole-dollar money — the board deals in collectibles, cents are noise. */
export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return usd0.format(n);
}

/** depth is a 0..1 fraction (1 − allIn/med). "38% under the book". */
export function depthPct(depth: number): string {
  return `${Math.round(depth * 100)}%`;
}

/** trend is a signed fraction (1Y sub-index), or null where not certified. */
export function trendPct(trend: number | null): string | null {
  if (trend == null || Number.isNaN(trend)) return null;
  const sign = trend > 0 ? '+' : '';
  return `${sign}${Math.round(trend * 100)}%`;
}

export function confLabel(conf: Confidence): string {
  return conf === 'high' ? 'High confidence' : 'Medium confidence';
}

const RISK_LABELS: Record<RiskGrade, string> = {
  A: 'Lowest risk',
  B: 'Low risk',
  C: 'Moderate risk',
  D: 'High risk',
};

export function riskLabel(g: RiskGrade): string {
  return RISK_LABELS[g];
}

const OUTCOME_LABELS: Record<ReceiptOutcome, string> = {
  live: 'Live',
  sold: 'Sold',
  ended: 'Ended',
  delisted: 'Delisted',
};

export function outcomeLabel(o: ReceiptOutcome): string {
  return OUTCOME_LABELS[o] ?? o;
}

/** ISO date/datetime → a short human date. Empty/invalid → '—'. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "3 days ago" style relative age for lastSale / surfacedAt. */
export function relativeDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const days = Math.round((now - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} mo ago`;
  return `${Math.round(months / 12)} yr ago`;
}

/** Book last-sale older than 24 months → an "aging book" caveat (PROPOSAL §3.3). */
export function isAgingBook(lastSale: string, now = Date.now()): boolean {
  const t = Date.parse(lastSale);
  if (Number.isNaN(t)) return false;
  const months = (now - t) / (86_400_000 * 30.44);
  return months > 24;
}

/** The identity key rendered readably: "rolex | 1665" → "rolex · 1665". */
export function prettyKey(key: string): string {
  return key.split('|').join(' · ');
}
