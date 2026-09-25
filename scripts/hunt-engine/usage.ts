/**
 * usage.ts — the hand-off between the hunt engine and the board inside one tick.
 * The engine writes what it actually spent; the board reads it to budget the
 * remainder. Stale or missing usage → the board assumes the engine's worst case.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const USAGE_PATH = join(process.cwd(), '.starling-state', 'hunt-usage.json');
/** usage older than this is from a previous tick, not this one */
export const USAGE_FRESH_MS = 90 * 60 * 1000;

export interface HuntUsage { runId: string | null; finishedAt: string; calls: number }

export function writeHuntUsage(u: HuntUsage, path = USAGE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(u));
}

export function readHuntUsage(path = USAGE_PATH, now = Date.now()): HuntUsage | null {
  if (!existsSync(path)) return null;
  try {
    const u = JSON.parse(readFileSync(path, 'utf8')) as HuntUsage;
    if (typeof u.calls !== 'number' || !u.finishedAt) return null;
    if (now - Date.parse(u.finishedAt) > USAGE_FRESH_MS) return null;
    return u;
  } catch {
    return null;
  }
}
