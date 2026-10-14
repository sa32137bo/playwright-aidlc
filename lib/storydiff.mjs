/**
 * storydiff.mjs — the story moved; what does that make stale?
 *
 * `impact` answers the code-side question: a commit landed, which specs cover
 * the files it touched. It needs `source.path`, and on a project where we were
 * never given the application source there is nothing for it to diff.
 *
 * This is the mirror question, and the only one answerable without the code:
 * the *requirement* moved. Which acceptance criteria changed, and which
 * already-approved specs and manual cases were written from the old wording?
 *
 * A spec built from a retired rule does not fail. It passes, forever, asserting
 * something nobody wants any more — so this has to be detected, never inferred
 * from a run.
 *
 *   pw-aidlc story-diff CHK-42
 *   pw-aidlc story-diff CHK-42 --story inputs/stories/CHK-42-v2.md
 *   pw-aidlc story-diff CHK-42 --snapshot     # (re)set the baseline, diff nothing
 *
 * Exit code 1 when any criterion moved, matching `testcases --check`, so CI can
 * gate on it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { c, ok, warn, bad, info, head, write, loadConfig, get } from './util.mjs';
import { declaredScenarios, overlap } from './report.mjs';
import { parseMarkdown, checkSources } from './testcases.mjs';

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');
const shaOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const nl = (s) => String(s).replace(/\r\n?/g, '\n');

/** Collapse whitespace so a reflowed paragraph is not reported as a rewording. */
const squash = (s) => nl(s).replace(/\s+/g, ' ').trim();

/**
 * `overlap` divides by its second argument, so it asks "how much of B appears
 * in A" — a direction that matters here. `plan.md`'s coverage table paraphrases
 * the story, so the approved criterion is routinely a five-word summary of a
 * twenty-word requirement: comparing one way clears the threshold and the other
 * does not. Containment in *either* direction is the evidence we actually want.
 */
const akin = (a, b) => overlap(a, b) || overlap(b, a);

// ---------------------------------------------------------------------------
// Acceptance criteria — extraction
// ---------------------------------------------------------------------------

/**
 * Stories in this kit carry no front matter and no `AC-n` labels: the criteria
 * are a plain numbered list under a heading (see examples/sample-inputs/CHK-42.md).
 * So `AC-n` is derived from position, and position is exactly what a deletion
 * destroys — which is why alignment below matches on content, never on index.
 *
 * Four shapes are accepted because all four are in the wild: `1.` numbered,
 * `- [ ]` checklist (how the kit's own canonical units write them), `-`/`*`
 * bullets, and `AC-1:` explicit labels.
 */
export function extractACs(text) {
  const lines = nl(text).split('\n');
  const HEADING = /^#{1,6}\s*(?:\d+[.)]\s*)?(acceptance\s*criteria|acceptance|criteria|acs?)\s*:?\s*$/i;

  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && HEADING.test(lines[i])) { start = i + 1; level = m[1].length; break; }
  }

  // No heading at all: some stories are a bare list. Fall back to the whole
  // document rather than reporting "no criteria" for a file that plainly has them.
  const body = start === -1
    ? lines
    : lines.slice(start, (() => {
      for (let i = start; i < lines.length; i++) {
        const m = /^(#{1,6})\s/.exec(lines[i]);
        if (m && m[1].length <= level) return i;
      }
      return lines.length;
    })());

  // Some stories give each criterion its own heading ("### AC-3 — Shipping
  // address is captured") with a Given/When/Then/And bullet list underneath as
  // its STEPS, not as siblings of it. That shape must be detected before the
  // bullet-per-line scan below runs, because scanning it bullet-by-bullet is
  // exactly the bug this exists to avoid: a 9-criterion story with a 3-5 line
  // Gherkin chain per criterion reports as 29+ criteria, one per bullet, and a
  // pure reformat (fenced ```gherkin block -> bullet list) then reads as a
  // near-total rewrite. Confirmed live (GHC run-11 revision 1: "35 of 35
  // criteria moved" reported for a change that was really 5).
  const AC_HEADING = /^(#{2,6})\s*(?:AC[-\s]?(\d+)|Criterion\s*(\d+))\s*[:—–-]*\s*(.*)$/i;
  if (body.some((l) => AC_HEADING.test(l))) return extractACsByHeading(body, AC_HEADING);

  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.text.trim()) out.push({ ...cur, text: cur.text.trim() }); cur = null; };

  for (const line of body) {
    const item = /^\s*(?:[-*+]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)(.+)$/.exec(line);
    if (item) {
      push();
      let t = item[1].trim();
      // An explicit label wins over the derived one, and is stripped from the text.
      const labelled = /^(AC[-\s]?\d+|Criterion\s*\d+)\s*[:—–-]\s*(.+)$/i.exec(t);
      cur = { label: labelled ? labelled[1].toUpperCase().replace(/[\s_]/g, '-') : null, text: labelled ? labelled[2] : t };
      continue;
    }
    // A wrapped continuation line belongs to the criterion above it.
    if (cur && line.trim() && /^\s+\S/.test(line)) { cur.text += ` ${line.trim()}`; continue; }
    if (!line.trim()) push();
  }
  push();

  return out.map((a, i) => ({
    id: a.label && /^AC-\d+$/.test(a.label) ? a.label : `AC-${i + 1}`,
    index: i + 1,
    text: a.text,
    key: squash(a.text),
  }));
}

/**
 * One heading = one criterion; every line under it (down to the next matching
 * heading) is a step of that criterion, folded into its text rather than
 * counted on its own. The heading supplies the id directly — it is already
 * explicit here, unlike the bullet-per-line shape above where an id has to be
 * derived from position.
 */
function extractACsByHeading(body, AC_HEADING) {
  const sections = [];
  let cur = null;
  for (const line of body) {
    const m = AC_HEADING.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { id: `AC-${m[2] || m[3]}`, title: (m[4] || '').trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) sections.push(cur);

  return sections.map((s, i) => {
    const detail = s.lines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[-*+]\s*(?:\[[ xX]\]\s*)?/, ''))
      .join(' ');
    const text = [s.title, detail].filter(Boolean).join(' — ');
    return { id: s.id, index: i + 1, text, key: squash(text) };
  });
}

/**
 * Align the approved criteria against the current ones by *content*.
 *
 * Aligning by position would report a five-criterion story with one deletion as
 * "four reworded, one removed" — four false alarms, each of which costs a human
 * a re-read of a spec that did not change. `overlap` is reused from report.mjs
 * rather than rewritten: the matrix already depends on it, its threshold is
 * tuned, and a third similarity matcher in this codebase is a third thing to
 * get subtly wrong.
 */
export function alignACs(before, after) {
  const rows = [];
  const takenBefore = new Set();

  // Exact matches are claimed first, across the whole list, before any fuzzy
  // one is considered. Otherwise a reworded criterion can greedily consume the
  // twin of a criterion that did not change at all, and both get misreported.
  const pending = [];
  for (const now of after) {
    const i = before.findIndex((b, idx) => !takenBefore.has(idx) && b.key === now.key);
    if (i === -1) { pending.push(now); continue; }
    takenBefore.add(i);
    rows.push({ class: before[i].index === now.index ? 'unchanged' : 'renumbered', before: before[i], after: now });
  }

  for (const now of pending) {
    const i = before.findIndex((b, idx) => !takenBefore.has(idx) && overlap(b.key, now.key));
    if (i === -1) { rows.push({ class: 'added', before: null, after: now }); continue; }
    takenBefore.add(i);
    rows.push({ class: 'reworded', before: before[i], after: now });
  }

  rows.sort((a, b) => ((a.after || a.before).index) - ((b.after || b.before).index));

  before.forEach((b, i) => {
    if (!takenBefore.has(i)) rows.push({ class: 'removed', before: b, after: null });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Resolving "the story now" and "the story then"
// ---------------------------------------------------------------------------

const SUFFIX = /[\s._-]*(?:v\d+|rev\s*\d+|copy|updated|final|new|latest|\(\d+\))+$/i;
const loose = (s) => String(s).toLowerCase().replace(/\.(md|txt)$/, '').replace(SUFFIX, '').replace(/[\s._-]/g, '');

/**
 * Which file is the current story.
 *
 * The kit's convention is that the filename stem *is* the bolt id, and the
 * recommended workflow when a story is revised is to overwrite that file in
 * place — nothing is lost, because the snapshot holds the approved version.
 * But people paste in a new file, so near-misses are *named*, never chosen:
 * silently picking between two candidate requirement documents is the worst
 * possible failure this tool could have.
 */
export function resolveStory(root, cfg, bolt, args = {}) {
  const dir = get(cfg, 'inputs.stories_dir', 'inputs/stories');

  if (args.story) {
    const p = resolve(root, args.story);
    if (!existsSync(p)) throw new Error(`--story: no file at ${norm(args.story)}`);
    return { path: norm(relative(root, p)), via: '--story' };
  }

  const intake = join(root, get(cfg, 'paths.bolts', 'bolts'), bolt, 'intake.yml');
  if (existsSync(intake)) {
    const m = /^\s*story_file:\s*["']?(.+?)["']?\s*$/m.exec(nl(readFileSync(intake, 'utf8')));
    if (m && m[1] && existsSync(resolve(root, m[1]))) {
      return { path: norm(m[1]), via: 'intake.yml story_file:' };
    }
  }

  for (const ext of ['.md', '.txt']) {
    const rel = `${dir}/${bolt}${ext}`;
    if (existsSync(join(root, rel))) return { path: rel, via: 'convention' };
  }

  const near = [];
  const abs = join(root, dir);
  if (existsSync(abs)) {
    for (const f of readdirSync(abs)) {
      if (!/\.(md|txt)$/i.test(f) || f.startsWith('.')) continue;
      if (loose(f) === loose(bolt)) {
        let mtime = '';
        try { mtime = statSync(join(abs, f)).mtime.toISOString().slice(0, 10); } catch { /* unreadable date is not worth failing over */ }
        near.push({ path: `${dir}/${f}`, mtime });
      }
    }
  }
  return { path: null, via: null, near };
}

/** The approved text, by the first rung that can supply it. */
function resolveBaseline(root, cfg, bolt, storyPath, args) {
  const boltDir = join(root, get(cfg, 'paths.bolts', 'bolts'), bolt);
  const snap = join(boltDir, 'story.snapshot.md');

  if (!args.since && existsSync(snap)) {
    const raw = nl(readFileSync(snap, 'utf8'));
    const m = /^<!--\s*story-snapshot\s([\s\S]*?)-->\s*\n?/.exec(raw);
    const meta = {};
    if (m) for (const kv of m[1].matchAll(/^\s*(\w+):\s*(.*)$/gm)) meta[kv[1]] = kv[2].trim();
    return {
      rung: 'snapshot', text: m ? raw.slice(m[0].length) : raw,
      label: `bolts/${bolt}/story.snapshot.md`, meta, degraded: false,
    };
  }

  const ref = args.since || manifestOf(boltDir).story_ref;
  if (ref && storyPath) {
    try {
      const text = execSync(`git show "${ref}:${storyPath}"`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return { rung: 'git', text: nl(text), label: `git ${ref}:${storyPath}`, meta: {}, degraded: false };
    } catch { /* not committed, not a repo, or the path moved — fall through */ }
  }

  // The plan's own coverage table is the approved criteria, restated by the
  // planner. Wording was summarised, so rewording is unreliable here — but
  // added and removed criteria are still detected exactly, and that is most of
  // the value. Reported as degraded rather than presented as equivalent.
  const plan = join(boltDir, 'plan.md');
  if (existsSync(plan)) {
    const crit = planCoverage(readFileSync(plan, 'utf8'));
    if (crit.length) {
      return {
        rung: 'plan', text: crit.map((r, i) => `${i + 1}. ${r.criterion}`).join('\n'),
        label: `bolts/${bolt}/plan.md coverage table`, meta: {}, degraded: true,
      };
    }
  }

  return { rung: 'none', text: null, label: null, meta: {}, degraded: false };
}

function manifestOf(boltDir) {
  const p = join(boltDir, 'manifest.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Coverage — AC -> scenarios -> specs, and AC -> manual cases
// ---------------------------------------------------------------------------

/**
 * `## Coverage of acceptance criteria` from plan.md.
 *
 * Two column layouts ship in the kit — `| Criterion | Scenario(s) | Notes |`
 * and the example's `| # | Criterion | Scenario(s) | Notes |` — so the columns
 * are found by header name, not by index.
 */
export function planCoverage(plan) {
  const all = nl(plan).split('\n');
  const rows = [];
  let cols = null;

  // Only the coverage section is read. plan.md carries other tables — the
  // discrepancies table, "Not covered by E2E" — and scanning the whole file for
  // anything table-shaped is how one of those ends up parsed as coverage.
  const start = all.findIndex((l) => /^#{2,3}\s+coverage of acceptance criteria/i.test(l));
  const lines = start === -1 ? all : (() => {
    const end = all.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
    return all.slice(start + 1, end === -1 ? all.length : end);
  })();

  for (let i = 0; i < lines.length; i++) {
    const cells = tableRow(lines[i]);
    if (!cells) continue;
    if (/^[-: |]+$/.test(lines[i])) continue;

    if (!cols) {
      const lower = cells.map((x) => x.toLowerCase());
      const ci = lower.findIndex((x) => /criterion|acceptance/.test(x));
      const si = lower.findIndex((x) => /scenario/.test(x));
      if (ci === -1 || si === -1) continue;
      cols = { ci, si, ni: lower.findIndex((x) => /^#$|^no\.?$|^ac$/.test(x)) };
      continue;
    }
    const criterion = cells[cols.ci] || '';
    if (!criterion) continue;
    const num = cols.ni >= 0 ? (cells[cols.ni] || '').replace(/[^\d]/g, '') : '';
    rows.push({
      id: num ? `AC-${num}` : `AC-${rows.length + 1}`,
      criterion: criterion.replace(/^\*\*|\*\*$/g, '').trim(),
      scenarios: (cells[cols.si] || '').split(/[,;]/).map((s) => s.trim().replace(/`/g, '')).filter(Boolean),
    });
  }
  return rows;
}

function tableRow(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
}

/**
 * Scenario id -> the spec files declaring it, via the `// scenarios:` header.
 *
 * A spec without that header cannot be resolved to a criterion at all. Those
 * are collected separately and reported as *unknown*, never as unaffected —
 * the same stance `impact` takes for a spec with no `covers:` line, and for the
 * same reason: an unknown is not a pass, and a revision that quietly skipped a
 * spec it could not classify is the false negative that matters most here.
 */
function specsByScenario(root, cfg, bolt) {
  const dir = join(root, get(cfg, 'paths.tests', 'tests/e2e'), bolt);
  const map = new Map();
  map.undeclared = [];
  if (!existsSync(dir)) return map;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e.startsWith('.')) continue;
      const full = join(d, e);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.spec\.(ts|js|tsx|jsx)$/.test(e)) continue;
      const rel = norm(relative(root, full));
      const ids = declaredScenarios(readFileSync(full, 'utf8'));
      if (!ids.length) { map.undeclared.push(rel); continue; }
      for (const id of ids) {
        if (!map.has(id)) map.set(id, []);
        if (!map.get(id).includes(rel)) map.get(id).push(rel);
      }
    }
  };
  walk(dir);
  return map;
}

/** AC id -> manual case ids, from the sheet's own coverage table. */
function casesByAC(root, cfg, bolt) {
  const file = join(root, get(cfg, 'paths.test_cases', 'test-cases'), `${bolt}.md`);
  if (!existsSync(file)) return { file: null, map: new Map(), check: null };
  const text = readFileSync(file, 'utf8');
  const map = new Map();

  let cols = null;
  for (const line of nl(text).split('\n')) {
    const cells = tableRow(line);
    if (!cells || /^[-: |]+$/.test(line.trim())) continue;
    if (!cols) {
      const lower = cells.map((x) => x.toLowerCase());
      const ci = lower.findIndex((x) => /criterion|acceptance/.test(x));
      const ti = lower.findIndex((x) => /test case/.test(x));
      if (ci >= 0 && ti >= 0) cols = { ci, ti, ni: lower.findIndex((x) => /^#$|^ac$/.test(x)) };
      continue;
    }
    const num = cols.ni >= 0 ? (cells[cols.ni] || '').replace(/[^\d]/g, '') : '';
    const id = num ? `AC-${num}` : `AC-${map.size + 1}`;
    const ids = (cells[cols.ti] || '').split(/[,;]/).map((s) => s.trim().replace(/`/g, '')).filter((s) => /^TC[_-]/i.test(s));
    if (ids.length) map.set(id, ids);
  }

  // A sheet with no coverage table still carries per-case `User Story / Req ID`,
  // which binds the case to the story but not to a criterion — so it is reported
  // wholesale rather than per-AC, which is honest about what it can resolve.
  const { cases } = parseMarkdown(text);
  return {
    file: norm(relative(root, file)),
    map,
    allCases: cases.map((x) => x.id),
    check: checkSources(root, file),
  };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function storyDiff(args) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);
  if (!cfg) throw new Error('e2e.config.yml not found — run: npx pw-aidlc init <name>');

  const bolt = args.bolt || args['story-diff'] || args._?.[1];
  if (!bolt) throw new Error('which bolt? use: pw-aidlc story-diff <ID>');

  const boltDir = join(root, get(cfg, 'paths.bolts', 'bolts'), bolt);
  head(`Story drift — ${bolt}`);

  const found = resolveStory(root, cfg, bolt, args);
  if (!found.path) {
    bad(`no story for ${bolt} under ${get(cfg, 'inputs.stories_dir', 'inputs/stories')}/`);
    if (found.near?.length) {
      info('Did you mean one of these?');
      for (const n of found.near) info(`    ${n.path}${n.mtime ? `   (modified ${n.mtime})` : ''}`);
      info(`Rename it to ${bolt}.md (recommended — the snapshot keeps the old version), or run:`);
      info(`    pw-aidlc story-diff ${bolt} --story "${found.near[0].path}"`);
    }
    process.exitCode = 1;
    return { state: 'no-story', near: found.near || [] };
  }

  const nowText = nl(readFileSync(join(root, found.path), 'utf8'));
  const nowSha = shaOf(readFileSync(join(root, found.path)));

  if (args.snapshot !== undefined && args.snapshot !== false) {
    writeSnapshot(root, boltDir, found.path, nowText, nowSha);
    ok(`baseline set — bolts/${bolt}/story.snapshot.md  sha256:${nowSha}`);
    return { state: 'snapshot', sha: nowSha };
  }

  const base = resolveBaseline(root, cfg, bolt, found.path, args);
  if (base.rung === 'none') {
    warn(`no baseline for ${bolt} — establishing one now, nothing to compare yet`);
    writeSnapshot(root, boltDir, found.path, nowText, nowSha);
    info(`bolts/${bolt}/story.snapshot.md written. The next run will diff against it.`);
    return { state: 'baseline-established', sha: nowSha };
  }

  const before = extractACs(base.text);
  const after = extractACs(nowText);
  if (!after.length) {
    warn(`no acceptance criteria found in ${found.path}`);
    info('expected a numbered or bulleted list under an "## Acceptance criteria" heading');
    return { state: 'no-criteria' };
  }

  const rows = alignACs(before, after);

  // A summarised baseline cannot support a rewording claim. Reporting every
  // criterion as "reworded" because the planner condensed it is worse than
  // useless — it trains people to ignore this report.
  //
  // It cannot fully support "added"/"removed" either: a summary that condensed
  // heavily enough falls below the similarity threshold and splits one
  // criterion into a phantom pair. In this rung the table's *order* survived
  // even though its wording did not, so an added and a retired criterion
  // sitting at the same position are one criterion, not two.
  if (base.degraded) {
    for (const r of rows) if (r.class === 'reworded') r.class = 'uncertain';
    for (const a of rows.filter((r) => r.class === 'added')) {
      const twin = rows.find((r) => r.class === 'removed' && r.before.index === a.after.index);
      if (!twin) continue;
      a.class = 'uncertain';
      a.before = twin.before;
      rows.splice(rows.indexOf(twin), 1);
    }
  }

  const MOVED = new Set(['reworded', 'added', 'removed']);
  const moved = rows.filter((r) => MOVED.has(r.class));

  const cov = planCoverage(existsSync(join(boltDir, 'plan.md')) ? readFileSync(join(boltDir, 'plan.md'), 'utf8') : '');
  const byScenario = specsByScenario(root, cfg, bolt);
  const cases = casesByAC(root, cfg, bolt);

  // Coverage is keyed on the *approved* criterion, so a reworded or removed AC
  // is looked up by what it used to say, not by what it says now.
  const coverFor = (row) => {
    // A criterion that is new has no approved coverage, by definition. Matching
    // it on id would bind it to whatever criterion happened to sit at that
    // position before — which is how a brand-new requirement gets reported as
    // already covered, the one false negative this tool must not produce.
    const probe = row.class === 'added' ? row.after : (row.before || row.after);
    const hit = row.class === 'added'
      ? cov.find((r) => squash(r.criterion) === probe.key)
      : cov.find((r) => squash(r.criterion) === probe.key) || cov.find((r) => akin(r.criterion, probe.key));
    const scenarios = hit ? hit.scenarios : [];
    const specs = [...new Set(scenarios.flatMap((s) => byScenario.get(s) || []))];
    const manual = row.class === 'added' ? [] : (cases.map.get(probe.id) || []);
    return { scenarios, specs, manual };
  };

  for (const r of rows) r.cover = coverFor(r);

  const undeclared = byScenario.undeclared || [];
  const md = renderReport({ bolt, found, base, nowSha, rows, cases, undeclared });
  const outFile = join(root, get(cfg, 'paths.results', 'results'), `story-diff-${bolt}.md`);
  write(outFile, md, { force: true, quiet: true });

  report({ base, found, rows, moved, cases, bolt, outFile, root, undeclared });
  if (moved.length) process.exitCode = 1;

  return {
    state: moved.length ? 'drifted' : 'current',
    bolt, story: found.path, baseline: base.label, degraded: base.degraded,
    rows: rows.map((r) => ({
      class: r.class,
      id: (r.after || r.before).id,
      before: r.before?.text || null,
      after: r.after?.text || null,
      ...r.cover,
    })),
    testCases: cases.file ? { file: cases.file, state: cases.check?.state } : null,
    out: norm(relative(root, outFile)),
  };
}

function writeSnapshot(root, boltDir, storyPath, text, sha) {
  const header = `<!-- story-snapshot\n  source: ${storyPath}\n  sha256: ${sha}\n  taken: ${new Date().toISOString()}\n-->\n`;
  write(join(boltDir, 'story.snapshot.md'), header + text, { force: true, quiet: true });
}

/**
 * How a criterion is named in the report.
 *
 * Ids are positions, so a deletion makes the same number mean two different
 * criteria in one report — "AC-2 reworded" and "AC-2 removed" next to each
 * other, describing unrelated things. Say which number is the old one.
 */
function label(r) {
  if (r.class === 'removed') return `${r.before.id} (was)`;
  if (r.before && r.before.id !== r.after.id) return `${r.before.id}→${r.after.id}`;
  return r.after.id;
}

function report({ base, found, rows, moved, cases, bolt, outFile, root, undeclared = [] }) {
  const n = (k) => rows.filter((r) => r.class === k).length;
  info(`now:      ${found.path}${found.via === 'convention' ? '' : `  (via ${found.via})`}`);
  info(`baseline: ${base.label}${base.degraded ? '  — degraded, see the report' : ''}`);

  const uncertain = rows.filter((r) => r.class === 'uncertain').length;
  if (!moved.length) {
    if (uncertain) warn(`no criteria added or retired, but ${uncertain} cannot be compared — the baseline is summarised`);
    else ok(`current — ${rows.length} acceptance criteria unchanged since approval`);
  } else {
    warn(`${moved.length} of ${rows.length} acceptance criteria moved`);
    for (const r of moved) {
      const cov = r.cover.specs.length ? ` → ${r.cover.specs.join(', ')}` : (r.class === 'added' ? ' → no coverage' : '');
      const icon = { reworded: '~', added: '+', removed: '-' }[r.class];
      info(`  ${icon} ${label(r)} ${r.class}${cov}`);
    }
    if (n('renumbered')) info(`  ${n('renumbered')} renumbered (text identical — not a change)`);
  }
  if (uncertain && moved.length) info(`  ${uncertain} cannot be compared — the baseline is summarised`);
  if (uncertain) info(`  fix permanently:  pw-aidlc story-diff ${bolt} --snapshot`);

  if (undeclared.length) {
    warn(`${undeclared.length} spec(s) carry no "// scenarios:" header — impact for these is unknown, not clear`);
    for (const f of undeclared.slice(0, 5)) info(`    ${f}`);
  }

  if (cases.file && cases.check?.state === 'stale') {
    warn(`${cases.file} was written from an older version of this story`);
  }

  console.log(`\n  ${c.green('✓')} ${norm(relative(root, outFile))}`);
  if (moved.length) console.log(`  ${c.dim('update the tests for this drift:')} ${c.blue(`/revise ${bolt}`)}\n`);
  else console.log('');
}

function renderReport({ bolt, found, base, nowSha, rows, cases, undeclared = [] }) {
  const pick = (k) => rows.filter((r) => r.class === k);
  const reworded = pick('reworded');
  const added = pick('added');
  const removed = pick('removed');
  const renumbered = pick('renumbered');
  const unchanged = pick('unchanged');
  const uncertain = pick('uncertain');
  const moved = reworded.length + added.length + removed.length;

  const cell = (a) => (a.length ? a.map((x) => `\`${x}\``).join('<br>') : '—');
  const lead = !moved && uncertain.length
    ? `**No criterion was added or retired.** ${uncertain.length} cannot be compared for rewording — see the degraded-baseline note below.`
    : moved
    ? `**${moved} acceptance criteri${moved === 1 ? 'on' : 'a'} moved.** `
      + `${[...new Set([...reworded, ...added, ...removed].flatMap((r) => r.cover.specs))].length} spec file(s) `
      + `and ${[...new Set([...reworded, ...added, ...removed].flatMap((r) => r.cover.manual))].length} manual case(s) are affected.`
    : '**No acceptance criterion has moved.** Nothing to revise.';

  return `# Story drift — ${bolt}

_Generated ${new Date().toISOString()} by \`pw-aidlc story-diff\`._

| | |
|---|---|
| Now | \`${found.path}\` sha256:${nowSha}${found.via === 'convention' ? '' : ` — resolved via ${found.via}` } |
| Baseline | \`${base.label}\`${base.meta?.taken ? ` (taken ${base.meta.taken})` : ''} |

${lead}
${base.degraded ? `
> ⚠ **Degraded baseline.** No \`story.snapshot.md\` and no committed version of
> this story exist, so the approved criteria were read back from \`plan.md\`'s
> coverage table, where the planner had already summarised them. **Added and
> retired criteria are exact; rewordings are not reliable** — a summary differs
> from its source by construction. Take a real snapshot to fix this permanently:
> \`pw-aidlc story-diff ${bolt} --snapshot\`
` : ''}
## Reworded — ${reworded.length} criteri${reworded.length === 1 ? 'on' : 'a'}

${reworded.length ? `These are the dangerous ones: the specs below still pass, because they assert what the story used to say.

| AC | Was | Now | Scenarios | Specs | Manual cases |
|---|---|---|---|---|---|
${reworded.map((r) => `| ${r.after.id} | ${r.before.text} | ${r.after.text} | ${cell(r.cover.scenarios)} | ${cell(r.cover.specs)} | ${cell(r.cover.manual)} |`).join('\n')}`
    : '_None._'}

## New — ${added.length} criteri${added.length === 1 ? 'on' : 'a'} with no coverage

${added.length
    ? `| AC | Text | Existing coverage |\n|---|---|---|\n${added.map((r) => `| ${r.after.id} | ${r.after.text} | ${r.cover.specs.length ? cell(r.cover.specs) : '**none — this is the gap**'} |`).join('\n')}`
    : '_None._'}

## Retired — ${removed.length} criteri${removed.length === 1 ? 'on' : 'a'} no longer in the story

${removed.length
    ? `> These are **never deleted automatically.** A criterion vanishing from a story is as often an editing mistake as a decision. Confirm each one before removing its test.\n\n| AC (was) | Text | Scenarios | Specs | Manual cases |\n|---|---|---|---|---|\n${removed.map((r) => `| ${r.before.id} | ${r.before.text} | ${cell(r.cover.scenarios)} | ${cell(r.cover.specs)} | ${cell(r.cover.manual)} |`).join('\n')}`
    : '_None._'}

## Cannot be compared — ${uncertain.length}

${uncertain.length
    ? `The baseline for these is \`plan.md\`'s coverage table, where the planner had already condensed the criterion. Comparing a summary against its source reports a difference every time, so rewording is **not claimed** for these — it is simply unknown.\n\n| AC | Story says now | Approved summary | Specs |\n|---|---|---|---|\n${uncertain.map((r) => `| ${r.after.id} | ${r.after.text} | ${r.before.text} | ${cell(r.cover.specs)} |`).join('\n')}`
    : '_None._'}

## Renumbered — ${renumbered.length}

${renumbered.length
    ? `Identical text at a different position. **Not a change** — listed only so the numbering shift is not mistaken for one.\n\n${renumbered.map((r) => `- ${r.before.id} → ${r.after.id}: ${r.after.text}`).join('\n')}`
    : '_None._'}

## Unchanged — ${unchanged.length}

${unchanged.length ? `${unchanged.map((r) => `- ${r.after.id}: ${r.after.text}`).join('\n')}\n\nSpecs covering these are not opened by a revision.` : '_None._'}

## Unknown impact — ${undeclared.length} spec(s) with no \`// scenarios:\` header

${undeclared.length
    ? `These cannot be tied to a criterion, so they are **unknown**, not unaffected. Add the header \`e2e-generate\` writes (\`// scenarios: 1.1, 1.2\`) and re-run — until then a revision cannot tell whether they cover something that moved.\n\n${undeclared.map((f) => `- \`${f}\``).join('\n')}`
    : '_None — every spec declares the scenarios it covers._'}

## Manual test cases

${cases.file
    ? (cases.check?.state === 'stale'
      ? `\`${cases.file}\` was written from an older version of this story:\n\n${cases.check.changed.map((ch) => `- \`${ch.path}\` — ${ch.why}`).join('\n')}\n\n\`/revise ${bolt}\` will offer to update the affected cases. Declining still updates the specs — the sheet never blocks the scripts.`
      : cases.check?.state === 'unstamped'
        ? `\`${cases.file}\` is not stamped, so its staleness cannot be judged. Run \`pw-aidlc testcases --stamp ${bolt}\`.`
        : `\`${cases.file}\` — current.`)
    : '_No test-case sheet for this bolt._'}

---

**How to read this.** A reworded criterion is the case this tool exists for: the
spec built from the old wording still passes, so no test run will ever surface
it. A retired criterion is a question for a person, never an automatic deletion.
Coverage here is resolved from \`plan.md\`'s approved coverage table and the
\`// scenarios:\` headers in the specs — the same joins \`pw-aidlc matrix\` uses;
a criterion whose specs are listed as \`—\` had no recorded coverage to begin with.

Next: \`/revise ${bolt}\`${moved ? '' : ' is not needed'}.
`;
}
