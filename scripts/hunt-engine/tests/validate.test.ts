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
import { HUNT_ENGINE_CALLS_PER_RUN, BOARD_DAILY_BUDGET, DAILY_CALL_BUDGET, HUNT_ENGINE_DAILY_RESERVE } from '../../scheduler';

test('the engine budget covers every hunt at max pages, and board + engine stay within the daily quota', () => {
  assert.ok(HUNT_ENGINE_CALLS_PER_RUN >= validateHunts().length * MAX_PAGES);
  assert.equal(BOARD_DAILY_BUDGET + HUNT_ENGINE_DAILY_RESERVE, DAILY_CALL_BUDGET);
});
