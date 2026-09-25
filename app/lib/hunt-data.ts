/**
 * hunt-data.ts — build-time reader for the hunt engine's ONE view model
 * (public/data/starling/hunt/dashboard.json, DashboardPayload v1).
 *
 * Returns null when the file is missing, unparseable, or not schemaVersion 1 —
 * the page then renders an explicit "not searched yet" state. It never
 * substitutes an empty payload: a missing run must not read as "0 results".
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DashboardPayload } from '@/scripts/hunt-engine/dashboard';

export const HUNT_DASHBOARD_PATH = path.join(
  process.cwd(),
  'public',
  'data',
  'starling',
  'hunt',
  'dashboard.json',
);

function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** Structural check of the load-bearing fields the page renders. */
function looksValid(x: unknown): x is DashboardPayload {
  if (!isObj(x) || x.schemaVersion !== 1) return false;
  const run = x.run;
  if (!isObj(run)) return false;
  if (typeof run.id !== 'string' || typeof run.state !== 'string' || typeof run.mode !== 'string') return false;
  if (typeof run.finishedAt !== 'string' || typeof run.staleAfterMinutes !== 'number') return false;
  if (typeof run.huntsTotal !== 'number' || typeof run.huntsComplete !== 'number') return false;
  if (!isObj(run.providerHealth)) return false;
  if (!Array.isArray(x.hunts) || !Array.isArray(x.cards) || !Array.isArray(x.alerts)) return false;
  if (!isObj(x.meta) || !isObj(x.counts)) return false;
  return true;
}

export function loadHuntDashboard(): DashboardPayload | null {
  let raw: string;
  try {
    raw = fs.readFileSync(HUNT_DASHBOARD_PATH, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return looksValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
