/**
 * Unit tests for lib/storydiff.mjs — no dependencies, no runner.
 *
 *   node tests/test_story_diff.mjs
 *
 * The cases here are the ones that actually bite: a deletion renumbering every
 * criterion after it, a planner's paraphrase being mistaken for a rewording,
 * and a new criterion inheriting the coverage of whatever used to sit at its
 * position. Each of those is a *false* report, and a false report is what stops
 * people reading this tool's output at all.
 */

import { extractACs, alignACs, planCoverage, resolveStory } from '../lib/storydiff.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let pass = 0;
const fails = [];

function check(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(`${name}\n      ${e.message}`); }
}
function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}\n      expected ${b}\n      got      ${a}`);
}

const classes = (rows) => rows.map((r) => `${(r.after || r.before).id}:${r.class}`);

// ---------------------------------------------------------------------------
// extractACs — the four list shapes that are actually in the wild
// ---------------------------------------------------------------------------

check('extract: numbered list under "## Acceptance criteria"', () => {
  const acs = extractACs(`# CHK-42

## Description
Prose that must not be picked up.

## Acceptance criteria

1. First rule.
2. Second rule.

## Out of scope
- Not a criterion.
`);
  eq(acs.map((a) => a.id), ['AC-1', 'AC-2'], 'ids');
  eq(acs.map((a) => a.text), ['First rule.', 'Second rule.'], 'text');
});

check('extract: stops at the next heading of equal or higher level', () => {
  const acs = extractACs('## Acceptance criteria\n1. Kept.\n\n## Out of scope\n1. Dropped.\n');
  eq(acs.length, 1, 'only the criteria section is read');
});

check('extract: checklist form, as the kit writes its own units', () => {
  const acs = extractACs('## Acceptance Criteria\n- [ ] Unticked rule.\n- [x] Ticked rule.\n');
  eq(acs.map((a) => a.text), ['Unticked rule.', 'Ticked rule.'], 'checkbox markers stripped');
});

check('extract: explicit AC-n labels win over derived positions', () => {
  const acs = extractACs('## Acceptance criteria\n- AC-7: Seventh rule.\n- AC-9: Ninth rule.\n');
  eq(acs.map((a) => a.id), ['AC-7', 'AC-9'], 'declared ids kept');
  eq(acs[0].text, 'Seventh rule.', 'label stripped from the text');
});

check('extract: a wrapped criterion is one criterion, not two', () => {
  const acs = extractACs('## Acceptance criteria\n1. A rule that runs on\n   to a second line.\n2. Another.\n');
  eq(acs.length, 2, 'count');
  eq(acs[0].text, 'A rule that runs on to a second line.', 'continuation joined');
});

check('extract: reflowed whitespace is not a difference', () => {
  const a = extractACs('## Acceptance criteria\n1. One   rule    here.\n')[0];
  const b = extractACs('## Acceptance criteria\n1. One rule\n   here.\n')[0];
  eq(a.key, b.key, 'squashed keys match');
});

// ---------------------------------------------------------------------------
// alignACs — the part that must not cry wolf
// ---------------------------------------------------------------------------

const five = (...t) => t.map((text, i) => ({ id: `AC-${i + 1}`, index: i + 1, text, key: text }));

check('align: identical lists report nothing moved', () => {
  const l = five('Alpha rule about carts.', 'Beta rule about postcodes.', 'Gamma rule about orders.');
  eq(classes(alignACs(l, l)), ['AC-1:unchanged', 'AC-2:unchanged', 'AC-3:unchanged'], 'all unchanged');
});

check('align: a deletion is ONE removal, not a cascade of rewordings', () => {
  // The regression this whole design exists to avoid: aligning by position
  // reports criteria 2..5 as reworded when only criterion 2 was deleted.
  const before = five(
    'Alpha rule about carts and baskets.',
    'Beta rule about saved addresses.',
    'Gamma rule about postcode validation.',
    'Delta rule about confirmation numbers.',
    'Epsilon rule about email receipts.',
  );
  const after = five(
    'Alpha rule about carts and baskets.',
    'Gamma rule about postcode validation.',
    'Delta rule about confirmation numbers.',
    'Epsilon rule about email receipts.',
  );
  const rows = alignACs(before, after);
  eq(rows.filter((r) => r.class === 'removed').length, 1, 'exactly one removal');
  eq(rows.filter((r) => r.class === 'reworded').length, 0, 'no false rewordings');
  eq(rows.filter((r) => r.class === 'renumbered').length, 3, 'the three that shifted');
  eq(rows.find((r) => r.class === 'removed').before.text, 'Beta rule about saved addresses.', 'the right one went');
});

check('align: a genuine rewording is reported as reworded, not added+removed', () => {
  const before = five('An invalid postcode blocks submission and shows a message next to the field.');
  const after = five('An invalid postcode blocks submission and shows a message beneath the field, and the button stays disabled.');
  const rows = alignACs(before, after);
  eq(classes(rows), ['AC-1:reworded'], 'one reworded');
});

check('align: an unrelated new criterion is added, never matched', () => {
  const before = five('A guest can reach checkout without signing in.');
  const after = five(
    'A guest can reach checkout without signing in.',
    'A guest can opt into order updates by SMS during checkout.',
  );
  eq(classes(alignACs(before, after)), ['AC-1:unchanged', 'AC-2:added'], 'second is new');
});

check('align: identical text at a new position is renumbered, not changed', () => {
  const before = five('Alpha about carts.', 'Beta about postcodes.');
  const after = five('Beta about postcodes.', 'Alpha about carts.');
  const rows = alignACs(before, after);
  eq(rows.every((r) => r.class === 'renumbered'), true, 'both renumbered');
  eq(rows.some((r) => r.class === 'reworded'), false, 'nothing reported as changed');
});

check('align: an exact match is never stolen by a fuzzy one', () => {
  // "Beta" survives verbatim, so it must claim its twin before the reworded
  // "Alpha" is allowed to consider it.
  const before = five('Alpha rule about postcode validation here.', 'Beta rule about postcode validation there.');
  const after = five('Beta rule about postcode validation there.', 'Alpha rule about postcode validation elsewhere.');
  const rows = alignACs(before, after);
  const beta = rows.find((r) => r.after && r.after.text.startsWith('Beta'));
  eq(beta.class, 'renumbered', 'Beta matched itself exactly');
});

check('align: empty before (never approved) makes everything added', () => {
  eq(classes(alignACs([], five('One.', 'Two.'))), ['AC-1:added', 'AC-2:added'], 'all new');
});

// ---------------------------------------------------------------------------
// planCoverage — AC -> scenario ids, from the approved plan
// ---------------------------------------------------------------------------

check('coverage: reads the numbered four-column table the examples use', () => {
  const rows = planCoverage(`## Coverage of acceptance criteria

| # | Criterion | Scenario(s) | Notes |
|---|---|---|---|
| 1 | Guest reaches checkout | 1.1 | |
| 2 | Saved addresses appear | 2.1, 2.2 | a note |

## Test scenarios
`);
  eq(rows.map((r) => r.id), ['AC-1', 'AC-2'], 'ids from the # column');
  eq(rows[1].scenarios, ['2.1', '2.2'], 'scenario list split');
});

check('coverage: reads the three-column table the skill documents', () => {
  const rows = planCoverage('## Coverage of acceptance criteria\n\n| Criterion | Scenario(s) | Notes |\n|---|---|---|\n| Only rule | S-01, S-02 | |\n');
  eq(rows.length, 1, 'one row');
  eq(rows[0].scenarios, ['S-01', 'S-02'], 'non-numeric scenario ids survive');
});

check('coverage: other tables in plan.md are not mistaken for coverage', () => {
  const rows = planCoverage(`## Coverage of acceptance criteria

| Criterion | Scenario(s) |
|---|---|
| Real rule | 1.1 |

## Discrepancies (code vs live app)

| Code says | App does | File | Impact |
|---|---|---|---|
| ten | twelve | a.ts | high |
`);
  eq(rows.length, 1, 'the discrepancies table is outside the section');
});

check('coverage: a plan with no coverage section yields nothing, not a crash', () => {
  eq(planCoverage('# Plan\n\nNo tables at all.\n'), [], 'empty');
});

// ---------------------------------------------------------------------------
// resolveStory — the naming ladder
// ---------------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'sd-'));
try {
  mkdirSync(join(root, 'inputs/stories'), { recursive: true });
  mkdirSync(join(root, 'bolts/CHK-42'), { recursive: true });
  const cfg = { inputs: { stories_dir: 'inputs/stories' }, paths: { bolts: 'bolts' } };

  check('resolve: nothing there names no file and suggests nothing', () => {
    const r = resolveStory(root, cfg, 'CHK-42');
    eq(r.path, null, 'no path');
    eq(r.near, [], 'no near misses');
  });

  check('resolve: a near-miss is NAMED, never chosen', () => {
    writeFileSync(join(root, 'inputs/stories/CHK-42-v2.md'), '## Acceptance criteria\n1. x\n');
    const r = resolveStory(root, cfg, 'CHK-42');
    eq(r.path, null, 'still refuses to pick');
    eq(r.near.map((n) => n.path), ['inputs/stories/CHK-42-v2.md'], 'but says what it saw');
  });

  check('resolve: --story is honoured exactly', () => {
    const r = resolveStory(root, cfg, 'CHK-42', { story: 'inputs/stories/CHK-42-v2.md' });
    eq(r.path, 'inputs/stories/CHK-42-v2.md', 'path');
    eq(r.via, '--story', 'rung');
  });

  check('resolve: --story pointing at nothing fails loudly', () => {
    let threw = false;
    try { resolveStory(root, cfg, 'CHK-42', { story: 'inputs/stories/nope.md' }); } catch { threw = true; }
    eq(threw, true, 'throws rather than falling back');
  });

  check("resolve: intake.yml's story_file: registers a renamed story", () => {
    writeFileSync(join(root, 'bolts/CHK-42/intake.yml'), 'bolt_id: "CHK-42"\nstory_file: "inputs/stories/CHK-42-v2.md"\n');
    const r = resolveStory(root, cfg, 'CHK-42');
    eq(r.path, 'inputs/stories/CHK-42-v2.md', 'path');
    eq(r.via, 'intake.yml story_file:', 'rung');
  });

  check('resolve: the <ID>.md convention outranks a stale story_file:', () => {
    writeFileSync(join(root, 'inputs/stories/CHK-42.md'), '## Acceptance criteria\n1. x\n');
    writeFileSync(join(root, 'bolts/CHK-42/intake.yml'), 'bolt_id: "CHK-42"\nstory_file: "inputs/stories/gone.md"\n');
    const r = resolveStory(root, cfg, 'CHK-42');
    eq(r.path, 'inputs/stories/CHK-42.md', 'falls through when story_file: does not exist');
    eq(r.via, 'convention', 'rung');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

if (fails.length) {
  console.error(`\n  ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`\n  ✓ storydiff — ${pass} checks passed\n`);
