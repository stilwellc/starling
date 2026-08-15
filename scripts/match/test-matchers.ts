/**
 * test-matchers.ts — the offline assertion harness (npm run test:matchers).
 *
 * For each launch vertical it loads the matcher's own fixture file, runs
 * identify() on every listing, and checks the fixtures/README.md contract:
 *   - ≥3 listings identify to a key that EXISTS in the sample value book
 *   - ≥1 listing ABSTAINS (identify → null)
 *   - ≥1 condition-flag listing is caught by the gate
 *   - ≥1 scam listing (depth > 0.90) is suppressed by the gate
 * Exits non-zero on any failure so CI can gate on it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ValueBook, Vertical } from '../types';
import { LAUNCH_VERTICALS } from '../types';
import { matcherFor } from './registry';
import { fixtureListings } from '../lib/fixture-source';
import { gate } from '../gate';

const book = JSON.parse(
  readFileSync(join(process.cwd(), 'fixtures', 'value-book.sample.json'), 'utf8'),
) as ValueBook;
const bookKeys = new Set(book.rows.map((r) => r.k));
const rowByKey = new Map(book.rows.map((r) => [r.k, r]));

let failures = 0;
function check(cond: boolean, label: string) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`);
  if (!cond) failures++;
}

for (const vertical of LAUNCH_VERTICALS as Vertical[]) {
  console.log(`\n[${vertical}]`);
  const matcher = matcherFor[vertical];
  if (!matcher) {
    check(false, `matcher registered`);
    continue;
  }
  const fixturePath = join(process.cwd(), 'fixtures', 'ebay', `${vertical}.json`);
  if (!existsSync(fixturePath)) {
    check(false, `fixture file exists (${vertical}.json)`);
    continue;
  }
  const listings = fixtureListings(vertical);
  check(listings.length > 0, `fixtures load (${listings.length} listings)`);

  let inBook = 0;
  let abstains = 0;
  let conditionCaught = 0;
  let scamCaught = 0;

  for (const l of listings) {
    const key = matcher.identify(l);
    if (key === null) {
      abstains++;
      continue;
    }
    if (bookKeys.has(key)) {
      inBook++;
      const row = rowByKey.get(key)!;
      const g = gate(l, row);
      if (g.reason === 'condition-flag') conditionCaught++;
      if (g.reason === 'scam-cap') scamCaught++;
    }
  }

  check(inBook >= 3, `≥3 in-book identifications (got ${inBook})`);
  check(abstains >= 1, `≥1 abstain (got ${abstains})`);
  check(conditionCaught >= 1, `≥1 condition-flag suppressed (got ${conditionCaught})`);
  check(scamCaught >= 1, `≥1 scam-cap suppressed (got ${scamCaught})`);
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures} checks failed)`}`);
process.exit(failures === 0 ? 0 : 1);
