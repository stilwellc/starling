/**
 * registry.ts — the matcher registry. One entry per launch vertical; the
 * pipeline iterates this, never a hardcoded list. Adding a vertical = adding its
 * matcher here (and to LAUNCH_VERTICALS / the fixtures). The anti-cards-trap is
 * structural: every vertical is a peer behind the same VerticalMatcher contract.
 */
import type { VerticalMatcher, Vertical } from '../types';
import { sportsCardsMatcher } from './sports-cards';
import { pokemonMatcher } from './pokemon';
import { artEditionsMatcher } from './art-editions';
import { autographsMatcher } from './autographs';
import { watchesMatcher } from './watches';
import { designMatcher } from './design';

export const MATCHERS: VerticalMatcher[] = [
  sportsCardsMatcher,
  autographsMatcher,
  pokemonMatcher,
  artEditionsMatcher,
  watchesMatcher, // sweep-fed (queriesFor → []) — the audit's 1,278 never-polled keys
  designMatcher, // sweep/hunt-fed, abstain-heavy; not in LAUNCH_VERTICALS yet
];

export const matcherFor: Partial<Record<Vertical, VerticalMatcher>> =
  Object.fromEntries(MATCHERS.map((m) => [m.vertical, m])) as Partial<
    Record<Vertical, VerticalMatcher>
  >;
