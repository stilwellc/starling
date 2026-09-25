/**
 * format.ts — presentation helpers for the Hunt view. Pure: safe in server and
 * client components. Nothing here computes a price position — the engine did
 * that; these only say it.
 */

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Dollars — cents only when the value has them. */
export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? usd0.format(n) : usd2.format(n);
}

/** 0.35 → "35%". Engine ratios are fractions of the cap. */
export function pct(frac: number): string {
  const p = Math.abs(frac) * 100;
  return `${p >= 10 || Number.isInteger(p) ? Math.round(p) : p.toFixed(1)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Absolute UTC stamp — identical on the build server and every browser, so
 *  it never causes a hydration mismatch: "Sep 30, 2026 20:00 UTC". */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Table-density UTC stamp: "Sep 25 01:13 UTC" (full stamp goes in title). */
export function utcShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Compact span: "5d 18h" / "3h 12m" / "8m" / "<1m". */
export function span(ms: number): string {
  const mins = Math.floor(Math.abs(ms) / 60_000);
  if (mins < 1) return '<1m';
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── reason / flag codes → readable text (unknown codes render raw) ─────────

const REASONS: Record<string, string> = {
  'photo-matched': 'photo matched',
  signed: 'signed',
  'at-or-under-cap': 'at or under cap',
  'over-cap': 'over cap',
  'watch-only': 'watch-only (no cap)',
  'all-in-unknown': 'all-in unknown',
  'claims-original': 'listed as original',
};

export function reasonText(code: string): string {
  if (REASONS[code]) return REASONS[code];
  if (code.startsWith('must:')) return `title has “${code.slice(5)}”`;
  if (code.startsWith('game-used:')) return `game-used wording: “${code.slice(10)}”`;
  if (code.startsWith('medium:')) return `medium: ${code.slice(7)}`;
  return code;
}

const FLAGS: Record<string, string> = {
  'auction-price-moves': 'auction — price will move',
  'name-partial': 'full name not in title',
  'team-not-in-title': 'team not in title',
  'sb-number-unconfirmed': 'Super Bowl number unconfirmed',
  'object-unconfirmed': 'football not confirmed in title',
  'no-authentication-in-title': 'no authentication in title',
  'condition:for-parts': 'condition: for parts',
  'seller-low-feedback': 'seller feedback low',
  'shipping-unknown': 'shipping not listed',
  'price-far-below-market': 'price far below market — authenticity doubtful',
  'fake-art-template': 'matches a common fake-art listing template',
};

export function flagText(code: string): string {
  if (FLAGS[code]) return FLAGS[code];
  if (code.startsWith('same-seller-repeats:')) return `seller lists ${code.split(':')[1]} more like this`;
  return code;
}

export function isKnownCode(code: string): boolean {
  return (
    code in FLAGS ||
    code in REASONS ||
    code.startsWith('must:') ||
    code.startsWith('medium:') ||
    code.startsWith('same-seller-repeats:') ||
    code.startsWith('game-used:')
  );
}
