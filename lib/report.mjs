import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { c, ok, warn, info, head, loadConfig, get } from './util.mjs';

// ---------------------------------------------------------------------------
// results — run the suite (or read the last JSON report) and write a summary
// ---------------------------------------------------------------------------

export async function results(args) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);
  if (!cfg) throw new Error('e2e.config.yml not found — run: npx pw-aidlc init <name>');

  const testsDir = get(cfg, 'paths.tests', 'tests/e2e');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(root, 'results', `run-${stamp}.json`);
  mkdirSync(join(root, 'results'), { recursive: true });

  if (args.run !== false) {
    const grep = args.grep ? ` --grep ${args.grep}` : '';
    const target = args.bolt ? ` ${testsDir}/${args.bolt}` : '';
    const cmd = `npx playwright test${target}${grep} --reporter=json`;
    console.log(c.dim(`\n  ${cmd}\n`));
    try {
      const out = execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();
      writeFileSync(jsonPath, out, 'utf8');
    } catch (e) {
      // Playwright exits non-zero on failures but still emits the report.
      const out = (e.stdout || '').toString();
      if (!out.trim()) throw new Error('Playwright produced no report. Run the command above directly to see the error.');
      writeFileSync(jsonPath, out, 'utf8');
    }
  }

  const latest = args.file
    ? resolve(args.file)
    : readdirSync(join(root, 'results')).filter((f) => f.startsWith('run-') && f.endsWith('.json')).sort().pop();
  const file = args.file ? latest : join(root, 'results', latest);
  if (!file || !existsSync(file)) throw new Error('No results JSON found. Run without --no-run first.');

  const report = JSON.parse(readFileSync(file, 'utf8'));
  const tests = flatten(report);
  const counts = tests.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
  const durationMs = tests.reduce((a, t) => a + (t.duration || 0), 0);

  const lines = [];
  lines.push(`# Test Run Summary`);
  lines.push('');
  lines.push(`- **Run:** ${new Date().toISOString()}`);
  lines.push(`- **Report:** \`${file.replace(root + '/', '')}\``);
  lines.push(`- **Commit:** ${gitSha(root)}`);
  lines.push(`- **Duration:** ${(durationMs / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push(`| Status | Count |`);
  lines.push(`|---|---|`);
  for (const [k, v] of Object.entries(counts)) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  const failed = tests.filter((t) => t.status === 'failed' || t.status === 'timedOut');
  if (failed.length) {
    lines.push(`## Failures (${failed.length})`);
    lines.push('');
    lines.push('> Run `/heal` in Claude Code. It classifies each failure as product bug /');
    lines.push('> test defect / environment / flake **before** changing anything.');
    lines.push('');
    for (const t of failed) {
      lines.push(`### ${t.title}`);
      lines.push(`- **File:** \`${t.file}\``);
      lines.push(`- **Bolt:** ${t.bolt || 'unknown'}`);
      lines.push(`- **Error:** ${(t.error || '').split('\n')[0].slice(0, 200)}`);
      lines.push('');
    }
  }

  const skipped = tests.filter((t) => t.status === 'skipped');
  if (skipped.length) {
    lines.push(`## Skipped (${skipped.length})`);
    lines.push('');
    lines.push('Every skip needs a written reason. Unexplained skips are how coverage quietly disappears.');
    lines.push('');
    for (const t of skipped) lines.push(`- ${t.title} — \`${t.file}\``);
    lines.push('');
  }

  const outPath = join(root, 'results', 'summary.md');
  writeFileSync(outPath, lines.join('\n'), 'utf8');

  console.log(`  ${c.bold('Results')}`);
  for (const [k, v] of Object.entries(counts)) {
    const paint = k === 'passed' ? c.green : k === 'skipped' ? c.yellow : c.red;
    console.log(`  ${paint(String(v).padStart(4))} ${k}`);
  }
  console.log(`\n  ${c.dim('summary:')} results/summary.md`);
  if (failed.length) console.log(`  ${c.dim('next:   ')} /heal in Claude Code\n`);
  else console.log();

  writeFileSync(join(root, 'results', 'latest.json'), JSON.stringify(tests, null, 2), 'utf8');
  writeBoltResults(root, tests, stamp);
  return tests;
}

/**
 * One durable, non-gitignored file per bolt — `results/<bolt_id>.result.json`
 * (ER-4, connected-ai-dlc-tlc/project-docs/canonical/units/2026-09-07-001-
 * execution-result-publishing.md). `results/latest.json` already carries this
 * same data (including `error` per test) but is gitignored and overwritten
 * every run — this captures it durably instead of computing anything new.
 *
 * Keyed by bolt id + test title, matching how docs/traceability-matrix.md
 * itself joins a result to a planned scenario (`byTitle` in matrix(), below) —
 * not literally "scenario number", which isn't a field results ever carries.
 * Title is the real join key already in use; matching it, not inventing a
 * second one, is what lets ingestion join this file against the matrix in
 * one pass.
 */
function writeBoltResults(root, tests, runId) {
  const commit = gitSha(root);
  const branch = gitBranch(root);
  const generatedAt = new Date().toISOString();
  const byBolt = new Map();
  for (const t of tests) {
    if (!t.bolt) continue; // seed.spec.ts and similar have no bolt — not part of any bolt's chain
    if (!byBolt.has(t.bolt)) byBolt.set(t.bolt, []);
    byBolt.get(t.bolt).push({
      title: t.title,
      file: t.file,
      status: t.status,
      duration_ms: t.duration ?? null,
      error_detail: t.error ?? null,
    });
  }
  for (const [bolt, boltTests] of byBolt) {
    const out = {
      bolt_id: bolt,
      run_id: runId,
      tested_commit: commit,
      branch,
      generated_at: generatedAt,
      tests: boltTests,
    };
    writeFileSync(join(root, 'results', `${bolt}.result.json`), JSON.stringify(out, null, 2), 'utf8');
  }
}

function flatten(report) {
  const out = [];
  const visit = (suite, file) => {
    const f = suite.file || file;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const r = (test.results || []).slice(-1)[0] || {};
        out.push({
          title: spec.title,
          file: f,
          bolt: boltOf(f),
          status: r.status === 'passed' && test.status === 'expected' ? 'passed' : (test.status === 'skipped' ? 'skipped' : r.status || test.status),
          duration: r.duration,
          error: r.error?.message,
        });
      }
    }
    for (const s of suite.suites || []) visit(s, f);
  };
  for (const s of report.suites || []) visit(s, s.file);
  return out;
}

// A leading `tests/` is optional, not required: Playwright's JSON reporter
// emits file paths relative to playwright.config.ts's own testDir, and the
// kit's own generated config sets `testDir: './tests'` — so a real report
// shows `e2e/<bolt>/spec.ts`, never `tests/e2e/<bolt>/spec.ts`. Requiring the
// prefix made every real bolt resolve to null silently; confirmed live
// against a real run's results/latest.json, not assumed.
const boltOf = (file = '') => (file.match(/(?:^|\/)(?:e2e|api)\/([\w-]+)\//) || [])[1] || null;
const gitSha = (root) => { try { return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; } };
const gitBranch = (root) => { try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; } };

// ---------------------------------------------------------------------------
// matrix — release visibility: story → scenario → test → last result
// ---------------------------------------------------------------------------

const cleanTitle = (s) => s.replace(/`@[\w-]+`/g, '').replace(/\s+/g, ' ').trim();

/**
 * Pull the scenarios out of a plan.
 *
 * Plans do not agree on a heading shape. One bolt writes `#### 1.1 Retrieve the
 * customer` grouped under `### 1. Navigation`; another writes `### S-01 — Open
 * the wizard` with no grouping at all. Pinning the parser to one shape made the
 * other bolt vanish from the matrix *silently* — its scenarios left the
 * denominator too, so the file reported a confident coverage figure over half
 * the project.
 *
 * So take the deepest heading level that yields scenario-shaped ids. Group
 * headings sit exactly one level above their scenarios by construction, which
 * is what makes "deepest wins" a rule rather than a guess.
 */
// e2e-revise's own convention for a scenario whose acceptance criterion was
// retired: the heading keeps the scenario (so its history stays legible) but
// suffixes the title with this marker, rather than deleting the heading.
const RETIRED = /\s*[—–-]\s*retired\b.*$/i;

function parseScenarios(plan) {
  const ID = '([A-Za-z]{0,6}-?\\d+(?:\\.\\d+)*)';
  for (const depth of [5, 4, 3]) {
    const re = new RegExp(`^#{${depth}}\\s+${ID}[.)]?\\s*(?:[—–-]\\s+)?\\s*(\\S.*?)\\s*$`, 'gm');
    const found = [...plan.matchAll(re)]
      .map((m) => ({ id: m[1], title: cleanTitle(m[2].replace(RETIRED, '')), retired: RETIRED.test(m[2]) }))
      .filter((s) => s.title);
    if (found.length) return found;
  }
  return [];
}

/**
 * The scenario ids a spec file declares, from the `// spec:` header
 * `e2e-generate` writes. This is the only authoritative link between a plan and
 * the specs built from it.
 *
 * Title similarity, which this used to rely on alone, bound scenario 7.2 ("an
 * edited note is visible in the grid") to 6.2's *department* test and counted
 * it as coverage. A wrong match is worse than a reported gap, because a gap
 * gets investigated and a false match does not.
 */
export function declaredScenarios(src) {
  // Preferred: an explicit machine-readable line.
  let list = (/^\/\/\s*scenarios:\s*(.+)$/im.exec(src) || [])[1] || '';

  if (!list) {
    // Otherwise read the tail of the `// spec:` line. Two shapes are in the
    // wild — "§ 4.1 — scenarios 1.1–1.4" and "§ 3 — S-02, S-03" — so split on
    // the en/em dash that separates the plan reference from the ids, never on a
    // plain hyphen, which lives inside ids like S-01.
    const spec = (/^\/\/\s*spec:\s*(.+)$/im.exec(src) || [])[1] || '';
    list = ((/[–—]\s*(.+)$/.exec(spec) || [])[1] || '').replace(/^\s*scenarios?\b\s*/i, '');
  }
  if (!list) return [];

  const out = [];
  for (const part of list.split(',')) {
    const range = /^\s*([A-Za-z]*-?[\d.]+)\s*[–—-]\s*([A-Za-z]*-?[\d.]+)\s*$/.exec(part);
    if (range) { out.push(...expandRange(range[1], range[2])); continue; }
    const one = /([A-Za-z]*-?\d[\d.]*)/.exec(part);
    if (one) out.push(one[1]);
  }
  return out;
}

/** "1.1–1.4" -> 1.1 1.2 1.3 1.4; "S-01–S-03" -> S-01 S-02 S-03. */
export function expandRange(a, b) {
  const pa = /^(.*?)(\d+)$/.exec(a);
  const pb = /^(.*?)(\d+)$/.exec(b);
  if (!pa || !pb || pa[1] !== pb[1]) return [a, b];
  const width = pa[2].length;
  const out = [];
  for (let i = Number(pa[2]); i <= Number(pb[2]); i++) out.push(`${pa[1]}${String(i).padStart(width, '0')}`);
  return out.length ? out : [a, b];
}

/**
 * Titles of actual test cases.
 *
 * Whitelisted rather than blacklisted, because `test.` prefixes a lot of things
 * that are not tests. A naive /test(\.\w+)?\(/ swept up `test.describe` suite
 * names and `test.step` step names and reported them in the Test column — which
 * is how scenario S-08 "Card Share Group" came to be matched against S-06's
 * *step* about the Volume Group. Step titles also never appear in
 * results/latest.json, so such a row could never resolve a run status either.
 */
const TEST_TITLE = /\btest(?:\.(?:only|skip|fixme|fail|slow))?\(\s*['"`](.+?)['"`]/g;

export async function matrix(args) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);
  if (!cfg) throw new Error('e2e.config.yml not found');

  const boltsDir = join(root, 'bolts');
  const bolts = existsSync(boltsDir)
    ? readdirSync(boltsDir).filter((d) => !d.startsWith('_') && !d.startsWith('.') && existsSync(join(boltsDir, d, 'plan.md')))
    : [];

  const lastRun = existsSync(join(root, 'results/latest.json'))
    ? JSON.parse(readFileSync(join(root, 'results/latest.json'), 'utf8'))
    : [];
  const byTitle = new Map(lastRun.map((t) => [t.title, t]));

  const testsDir = get(cfg, 'paths.tests', 'tests/e2e');
  const rows = [];
  const unparsed = [];
  let totalScenarios = 0;
  let covered = 0;
  let named = 0;
  let fileLevel = 0;
  let heuristic = 0;

  for (const bolt of bolts) {
    const plan = readFileSync(join(boltsDir, bolt, 'plan.md'), 'utf8');
    const scenarios = parseScenarios(plan);

    const testFiles = existsSync(join(root, testsDir, bolt))
      ? readdirSync(join(root, testsDir, bolt)).filter((f) => f.endsWith('.spec.ts'))
      : [];
    const perFile = testFiles.map((f) => {
      const src = readFileSync(join(root, testsDir, bolt, f), 'utf8');
      return {
        file: f,
        declared: new Set(declaredScenarios(src)),
        titles: [...src.matchAll(TEST_TITLE)].map((m) => m[1]),
      };
    });
    const allTitles = perFile.flatMap((p) => p.titles);

    // A bolt with a plan but no recognisable scenarios is a parser failure, not
    // an empty plan. Silence here is what made the old bug dangerous.
    if (!scenarios.length) {
      unparsed.push({ bolt, tests: allTitles.length });
      continue;
    }

    for (const s of scenarios) {
      // A retired scenario has no test by design (its acceptance criterion is
      // gone), so it must never be counted as planned or reported as a gap -
      // both would mark an approved decision as a defect. Confirmed live
      // (GHC run-11 revision 1): scenarios 1.2 and 3.1 were deliberately
      // removed at Gate 1-R and still showed up under "## Gaps" as "planned
      // but no test found", indistinguishable from an accidental hole.
      if (s.retired) {
        rows.push({ bolt, scenario: `${s.id} ${s.title}`, test: c0('retired'), how: '—', status: '—', retired: true });
        continue;
      }

      totalScenarios++;
      const owner = perFile.find((p) => p.declared.has(s.id));

      let test = null;
      let how = '';
      if (owner) {
        // Prefer a title that literally declares this scenario's own id
        // first - deterministic, and the only thing that disambiguates
        // correctly when one file declares SEVERAL scenario ids with one
        // test per id. The word-overlap scan below is not enough on its
        // own: two titles in the same file can both satisfy it. Confirmed
        // live, not theoretical (GHC run-11): scenario 3.1 was bound to
        // test "2.1 a FleetNet customer is created end to end..." instead
        // of the real "3.1 the newly created customer is found..." test in
        // the same file, and reported as the TRUSTED header+title match
        // class despite being wrong - worse than a reported gap, per this
        // file's own "How to read" table.
        const idPrefixed = owner.titles.find((t) => startsWithId(t, s.id));
        const inFile = idPrefixed || owner.titles.find((t) => overlap(t, s.title));
        test = inFile ? `\`${inFile}\`` : `_${owner.file}_`;
        how = inFile ? 'header + title' : 'header';
        if (inFile) named++; else fileLevel++;
      } else {
        const loose = allTitles.find((t) => overlap(t, s.title));
        if (loose) { test = `\`${loose}\``; how = c0('title only'); heuristic++; named++; }
      }

      if (test) covered++;
      const runKey = owner && test && test.startsWith('`') ? test.slice(1, -1) : (test || '').replace(/^`|`$/g, '');
      const run = runKey ? byTitle.get(runKey) : null;

      rows.push({
        bolt,
        scenario: `${s.id} ${s.title}`,
        test: test || c0('not generated'),
        how: how || '—',
        status: run ? statusIcon(run.status) : '—',
      });
    }
  }

  const gaps = rows.filter((r) => r.test.includes('not generated'));
  const retired = rows.filter((r) => r.retired);

  const lines = [
    '# Traceability Matrix',
    '',
    `Generated ${new Date().toISOString()} · commit ${gitSha(root)} · project ${get(cfg, 'project.name')} (${get(cfg, 'project.mode')})`,
    '',
    `**${named}/${totalScenarios} planned scenarios map to a named test**, across ${bolts.length} bolt(s).`,
    fileLevel
      ? `${fileLevel} more are claimed by a spec file that does not name them individually — usually several scenarios covered by one longer test. Counted as present, but not as one test each.`
      : '',
    lastRun.length ? `Last run: ${lastRun.filter((t) => t.status === 'passed').length} passed, ${lastRun.filter((t) => t.status === 'failed').length} failed, ${lastRun.filter((t) => t.status === 'skipped').length} skipped.` : 'No test run recorded yet — run `npx pw-aidlc results`.',
    '',
  ];

  if (unparsed.length) {
    lines.push(
      '> **⚠ Some bolts are missing from this table.** Their plans parsed to zero',
      '> scenarios, so their coverage is **not counted above**. This is a parser',
      '> failure, not an empty plan — check the scenario heading format.',
      '>',
      ...unparsed.map((u) => `> - **${u.bolt}** — plan.md yielded no scenarios (${u.tests} test(s) exist in this bolt)`),
      ''
    );
  }

  lines.push(
    '| Bolt | Planned scenario | Test | Matched by | Last run |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.bolt} | ${r.scenario} | ${r.test} | ${r.how} | ${r.status} |`),
    '',
    '## Gaps',
    '',
    ...(gaps.length
      ? gaps.map((r) => `- **${r.bolt}** ${r.scenario} — planned but no test found`)
      : ['_None — every planned scenario has a test._']),
    '',
    '## Retired',
    '',
    ...(retired.length
      ? retired.map((r) => `- **${r.bolt}** ${r.scenario} — retired, no test expected`)
      : ['_None._']),
    '',
    '---',
    '',
    '### How to read the "Matched by" column',
    '',
    '| Value | Means | Trust |',
    '|---|---|---|',
    '| `header + title` | the spec file declares this scenario id in its `// spec:` header, and a test inside it matches by name | reliable |',
    '| `header` | the spec file declares this scenario id, but no single test name matched — the file is named instead | reliable at file level |',
    `| ${c0('title only')} | **no spec file declares this id.** Matched by title similarity alone, which has bound scenarios to the wrong test before | verify before quoting |`,
    '',
    heuristic
      ? `**${heuristic} row(s) matched by title only.** Those are the ones to check first — a wrong match reads as coverage.`
      : '_Every matched row is anchored to a `// spec:` header. No row relies on title similarity._',
  );

  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs/traceability-matrix.md'), lines.join('\n'), 'utf8');

  console.log(`\n  ${c.bold('Traceability matrix')}`);
  console.log(`  ${bolts.length} bolt(s), ${totalScenarios} planned scenarios, ${covered} with tests`);
  if (heuristic) console.log(`  ${c.yellow('!')} ${heuristic} row(s) matched by title similarity only — verify before quoting`);
  for (const u of unparsed) {
    console.log(`  ${c.red('✗')} ${u.bolt}: plan.md parsed to 0 scenarios — this bolt is NOT counted above`);
  }
  console.log(`  ${c.dim('written:')} docs/traceability-matrix.md\n`);
}

const c0 = (s) => `**${s}**`;
const statusIcon = (s) => ({ passed: '✅ passed', failed: '❌ failed', timedOut: '❌ timeout', skipped: '⏭️ skipped' }[s] || s);

// Generated test titles conventionally begin with their own scenario id
// (e2e-generate's own "scenarios: is not optional" rule) - "3.1 the newly
// created customer is found..." for scenario "3.1". A plain prefix check
// with a boundary guard (the next character must not also be a digit) so
// id "1.1" cannot falsely match a title that actually starts with "1.10".
export function startsWithId(title, id) {
  if (!title.startsWith(id)) return false;
  const next = title[id.length];
  return next === undefined || !/[0-9]/.test(next);
}

export function overlap(a, b) {
  const norm = (s) => s.toLowerCase().replace(/@\w+/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const A = new Set(norm(a)), B = norm(b);
  if (!B.length) return false;
  return B.filter((w) => A.has(w)).length / B.length >= 0.5;
}
