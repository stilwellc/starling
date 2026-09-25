import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUNTS } from '../hunts';
import { validateHunts, HuntConfigError } from '../validate';

test('the checked-in list validates', () => { assert.equal(validateHunts().length, 22); });

test('duplicate ids fail', () => {
  const bad = HUNTS.map((h, i) => (i === 1 ? { ...h, id: HUNTS[0].id } : h));
  assert.throws(() => validateHunts(bad), (e: any) => e instanceof HuntConfigError && /duplicate id/.test(e.message));
});

test('non-positive caps fail; null (watch-only) is allowed', () => {
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 0 ? { ...h, maxAllIn: 0 } : h))), /positive number or null/);
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 0 ? { ...h, maxAllIn: -5 } : h))), /positive number or null/);
  assert.equal(validateHunts(HUNTS.map((h, i) => (i === 0 ? { ...h, maxAllIn: null } : h))).length, 22);
});

test('empty query or title terms fail', () => {
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 3 ? { ...h, query: '  ' } : h))), /empty query/);
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 3 ? { ...h, titleMust: [] } : h))), /titleMust/);
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 3 ? { ...h, titleMust: [['', 'x']] } : h))), /empty titleMust/);
});

test('anything other than 22 active hunts fails', () => {
  assert.throws(() => validateHunts(HUNTS.slice(1)), /exactly 22 active hunts/);
  assert.throws(() => validateHunts(HUNTS.map((h, i) => (i === 0 ? { ...h, active: false } : h))), /exactly 22 active hunts/);
});

import { MAX_PAGES } from '../provider';
import { HUNT_ENGINE_MAX_CALLS_PER_RUN, PER_RUN_CALLS, RUNS_PER_DAY, DAILY_CALL_BUDGET, boardDailyBudget } from '../../scheduler';
import { readHuntUsage, writeHuntUsage } from '../usage';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('hunts are paid first; the board gets what they leave, never more than the quota', () => {
  assert.equal(HUNT_ENGINE_MAX_CALLS_PER_RUN, validateHunts().length * MAX_PAGES);
  assert.ok(HUNT_ENGINE_MAX_CALLS_PER_RUN <= PER_RUN_CALLS);
  assert.equal(boardDailyBudget(28) / RUNS_PER_DAY, PER_RUN_CALLS - 28);
  assert.equal(boardDailyBudget(null) / RUNS_PER_DAY, PER_RUN_CALLS - HUNT_ENGINE_MAX_CALLS_PER_RUN, 'unknown usage assumes the worst case');
  assert.equal(boardDailyBudget(10_000), 0, 'the board never goes negative');
  assert.ok((boardDailyBudget(0) / RUNS_PER_DAY + 0) * RUNS_PER_DAY <= DAILY_CALL_BUDGET);
});

test('usage hand-off: fresh usage is read, stale usage is ignored', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'hu-')), 'u.json');
  writeHuntUsage({ runId: 'r', finishedAt: new Date(1_000_000_000_000).toISOString(), calls: 31 }, p);
  assert.equal(readHuntUsage(p, 1_000_000_000_000 + 60_000)?.calls, 31);
  assert.equal(readHuntUsage(p, 1_000_000_000_000 + 3 * 3600_000), null);
});
