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

/** A hunt target's vertical is the OPERATOR'S lens — a free string that may
 *  name pockets beyond the launch set (culture, science, sports…). Use the
 *  proper label when it is a real vertical; otherwise render the slug readably
 *  ("science-tech" → "Science Tech"). Display only — never a mapping back into
 *  the Vertical union. */
export function huntLensLabel(v: string): string {
  if (v in VERTICAL_LABELS) return VERTICAL_LABELS[v as Vertical];
  return v
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
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

/** Compact money for dense context lines: $150 · $2.4K · $1.1M. */
export function moneyCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (abs >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (abs >= 1_000) return `$${trimZero((n / 1000).toFixed(1))}K`;
  return usd0.format(n);
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** ISO date → "Jul 2026" — the context-line register. */
export function monthYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Freshness for the build stamp: "2 h ago", "35 min ago", "just now". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const mins = Math.round((now - t) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Kind-aware caption for a lectr context block ("Charles Schulz signed
 *  material", "Mickey Mantle player material", …). The key's first segment is
 *  the subject; the kind decides the noun phrase. Unknown kinds render the
 *  prettified key alone — display only, never invented. */
export function contextCaption(kind: string, k: string): string {
  const subject = (k.split('|')[0] ?? k)
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
  switch (kind) {
    case 'signer':
      return `${subject} signed material`;
    case 'player-object':
      return `${subject} player material`;
    case 'artist':
      return `${subject} — artist market`;
    case 'class':
      return `${subject} — class comps`;
    default:
      return prettyKey(k);
  }
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
  if (conf === 'high') return 'High confidence';
  if (conf === 'medium') return 'Medium confidence';
  return 'Thin book'; // n=3 pool — surfaced only at 40%+ depth, badged on the card
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
