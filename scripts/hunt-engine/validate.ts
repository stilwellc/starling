/**
 * validate.ts — the hunt list must be well-formed before a single provider call.
 * Bad configuration fails the run; nothing is searched on a malformed list.
 */
import { HUNTS, type Hunt } from './hunts';
import { normalizeText } from './text';

/** 22 acquisition hunts + 13 BSTJ grails (moved from the deal board, Sep 25 2026) */
export const EXPECTED_ACTIVE_HUNTS = 35;

export class HuntConfigError extends Error {
  constructor(public problems: string[]) {
    super(`hunt config invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'HuntConfigError';
  }
}

export function validateHunts(hunts: readonly Hunt[] = HUNTS): Hunt[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const h of hunts) {
    const where = `hunt "${h.id || '(no id)'}"`;
    if (!h.id || !/^[a-z0-9][a-z0-9-]*$/.test(h.id)) problems.push(`${where}: id must be a lowercase slug`);
    if (ids.has(h.id)) problems.push(`${where}: duplicate id`);
    ids.add(h.id);
    if (!h.label?.trim()) problems.push(`${where}: empty label`);
    if (!normalizeText(h.query ?? '').trim()) problems.push(`${where}: empty query`);
    if (!Array.isArray(h.titleMust) || h.titleMust.length === 0) problems.push(`${where}: titleMust must have at least one entry`);
    for (const m of h.titleMust ?? []) {
      const alts = Array.isArray(m) ? m : [m];
      if (alts.length === 0 || alts.some((a) => !normalizeText(a).trim())) problems.push(`${where}: empty titleMust term`);
    }
    for (const x of h.titleExcludes ?? []) if (!normalizeText(x).trim()) problems.push(`${where}: empty exclusion`);
    if (h.maxAllIn !== null && !(typeof h.maxAllIn === 'number' && Number.isFinite(h.maxAllIn) && h.maxAllIn > 0))
      problems.push(`${where}: maxAllIn must be a positive number or null (null = watch-only)`);
    if (h.currency !== 'USD') problems.push(`${where}: currency must be USD`);
    if (!h.buyingModes?.length || h.buyingModes.some((m) => m !== 'FIXED_PRICE' && m !== 'AUCTION'))
      problems.push(`${where}: buyingModes must be FIXED_PRICE and/or AUCTION`);
    if (!['art', 'sports', 'furniture', 'grails'].includes(h.vertical)) problems.push(`${where}: unknown vertical`);
    if (!Number.isInteger(h.priority)) problems.push(`${where}: priority must be an integer`);
  }
  const active = hunts.filter((h) => h.active);
  if (active.length !== EXPECTED_ACTIVE_HUNTS)
    problems.push(`expected exactly ${EXPECTED_ACTIVE_HUNTS} active hunts, found ${active.length}`);
  if (problems.length) throw new HuntConfigError(problems);
  return [...active].sort((a, b) => a.priority - b.priority);
}
