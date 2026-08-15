/**
 * slug.ts — the ONE slugifier. Every matcher must map eBay brand/artist/player
 * strings to slugs the SAME way, because the slug is part of the value-book key
 * ("patek-philippe|3940"). Divergence here = silent identify() misses.
 */
export function slug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
