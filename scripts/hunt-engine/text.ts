/**
 * text.ts — deterministic, case- and punctuation-tolerant title matching.
 * No AI classification: every decision is a whole-word phrase test on a
 * normalized string, so the same title always gives the same answer.
 */

/** lowercase, strip diacritics, every non-alphanumeric run becomes one space */
export function normalizeText(s: string): string {
  return ` ${s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** a phrase appears as whole words (a trailing plural "s" is tolerated: print → prints) */
export function hasPhrase(normTitle: string, phrase: string): boolean {
  const p = normalizeText(phrase).trim();
  if (!p) return false;
  return normTitle.includes(` ${p} `) || normTitle.includes(` ${p}s `);
}

export function firstPhrase(normTitle: string, phrases: readonly string[]): string | null {
  for (const p of phrases) if (hasPhrase(normTitle, p)) return p;
  return null;
}
