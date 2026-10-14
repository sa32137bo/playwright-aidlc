/**
 * Unit tests for lib/report.mjs's scenario-to-test binding — no dependencies,
 * no runner.
 *
 *   node tests/test_matrix_binding.mjs
 *
 * The case that actually bit (GHC run-11): a file declaring two scenario ids
 * with one test per id bound the second scenario to the FIRST test instead,
 * because the fallback word-overlap check can match either title in the same
 * file, and reported it as the TRUSTED header+title class despite being
 * wrong.
 */

import { matrix, startsWithId } from '../lib/report.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0;
const fails = [];

function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(`${name}\n      ${e.message}`); }
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}

// ---------------------------------------------------------------------------
// startsWithId — the boundary guard is the point, not just the prefix check
// ---------------------------------------------------------------------------

check('startsWithId: matches an id followed by a space', () => {
  ok(startsWithId('3.1 the newly created customer is found by Customer ID search', '3.1'), 'expected a match');
});

check('startsWithId: does not match a different test that merely contains the id', () => {
  ok(!startsWithId('a FleetNet customer is created (see 3.1)', '3.1'), 'expected no match');
});

check('startsWithId: does not let "1.1" falsely match a title actually starting "1.10"', () => {
  ok(!startsWithId('1.10 some later scenario', '1.1'), 'expected no match - boundary guard');
});

// ---------------------------------------------------------------------------
// matrix() — the real bug, reproduced end to end against real files
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'aidlc-matrix-test-'));
try {
  writeFileSync(join(root, 'e2e.config.yml'), 'paths:\n  tests: tests/e2e\n');

  const boltDir = join(root, 'bolts/US-MDUI-CUST-001');
  mkdirSync(boltDir, { recursive: true });
  writeFileSync(join(boltDir, 'plan.md'), `# Plan

### 2. Journey
#### 2.1 A FleetNet customer is created end to end
#### 3.1 The newly created customer is found by Customer ID search
`);

  const specDir = join(root, 'tests/e2e/US-MDUI-CUST-001');
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, 'customer-create-journey.spec.ts'), `// spec: bolts/US-MDUI-CUST-001/plan.md § 2, § 3
// scenarios: 2.1, 3.1
import { test } from '@playwright/test';

test('2.1 a FleetNet customer is created end to end and its identifiers are exposed @smoke', async () => {});
test('3.1 the newly created customer is found by Customer ID search @smoke', async () => {});
`);

  await matrix({ root });
  const written = readFileSync(join(root, 'docs/traceability-matrix.md'), 'utf8');

  check('matrix: scenario 3.1 binds to the 3.1 test, not the 2.1 test in the same file', () => {
    const row = written.split('\n').find((l) => l.includes('| 3.1 '));
    ok(row, 'expected a row for scenario 3.1');
    ok(row.includes('the newly created customer is found'), `bound to the wrong test:\n      ${row}`);
    ok(!row.includes('a FleetNet customer is created end to end'), `still bound to the 2.1 test:\n      ${row}`);
  });

  check('matrix: scenario 2.1 still binds to its own test, unaffected by the fix', () => {
    const row = written.split('\n').find((l) => l.includes('| 2.1 '));
    ok(row, 'expected a row for scenario 2.1');
    ok(row.includes('a FleetNet customer is created end to end'), `bound to the wrong test:\n      ${row}`);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// matrix() — a retired scenario is not a gap
//
// GHC run-11 revision 1: scenarios 1.2 and 3.1 were deliberately removed at
// Gate 1-R because their acceptance criteria were retired from the story.
// e2e-revise's own convention keeps the plan.md heading but suffixes it
// "— retired in rev-N", rather than deleting it. The matrix reported both as
// "planned but no test found" under "## Gaps" - indistinguishable from an
// accidental hole, even though no test was ever meant to exist for them again.
// ---------------------------------------------------------------------------

const root2 = mkdtempSync(join(tmpdir(), 'aidlc-matrix-retired-test-'));
try {
  writeFileSync(join(root2, 'e2e.config.yml'), 'paths:\n  tests: tests/e2e\n');

  const boltDir = join(root2, 'bolts/US-MDUI-CUST-001');
  mkdirSync(boltDir, { recursive: true });
  writeFileSync(join(boltDir, 'plan.md'), `# Plan

### 2. Journey
#### 2.1 A FleetNet customer is created end to end
#### 3.1 The newly created customer is found by Customer ID search — retired in rev-1
`);

  const specDir = join(root2, 'tests/e2e/US-MDUI-CUST-001');
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, 'customer-create-journey.spec.ts'), `// spec: bolts/US-MDUI-CUST-001/plan.md § 2
// scenarios: 2.1
import { test } from '@playwright/test';

test('2.1 a FleetNet customer is created end to end @smoke', async () => {});
`);

  await matrix({ root: root2 });
  const written = readFileSync(join(root2, 'docs/traceability-matrix.md'), 'utf8');

  check('matrix: a retired scenario is not listed under Gaps', () => {
    const gapsSection = written.split('## Gaps')[1].split('## Retired')[0];
    ok(!gapsSection.includes('3.1'), `retired scenario 3.1 still reported as a gap:\n      ${gapsSection}`);
  });

  check('matrix: a retired scenario is listed under Retired instead', () => {
    const retiredSection = written.split('## Retired')[1].split('---')[0];
    ok(retiredSection.includes('3.1'), `expected scenario 3.1 under Retired:\n      ${retiredSection}`);
  });

  check('matrix: a retired scenario does not count toward planned scenarios', () => {
    ok(written.includes('**1/1 planned scenarios'), `expected only the live scenario counted:\n      ${written.split('\n')[4]}`);
  });
} finally {
  rmSync(root2, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

if (fails.length) {
  console.error(`\n  ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n  ✓ matrix binding — ${pass} checks passed\n`);
