import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { c, ok, warn, bad, info, head, ensureDir, loadConfig, get, prompt } from './util.mjs';
import { sheets, readRows, replaceSheetData } from './xlsx.mjs';

/**
 * Test cases as a portable artifact.
 *
 * Markdown is the source of truth: it lives in the repo, git can diff it, and a
 * reviewer can read it in a pull request. The workbook and the CSV are exports —
 * the workbook because it is the format the testers already govern, the CSV
 * because every test-management tool imports one.
 *
 * Editing happens in Excel, so the round trip has to work. `--import` reads an
 * edited sheet, shows what changed, and writes back only on confirmation. Without
 * that, the first regeneration silently discards a tester's corrections, which is
 * the failure that makes people stop trusting generated documents.
 */

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The template's 18 columns, in order. Column letter is the index. */
export const COLUMNS = [
  'Test Case ID', 'Module / Feature', 'User Story / Req ID', 'Test Scenario',
  'Test Steps', 'Test Data', 'Expected Result',
  // --- execution columns: never written by the generator ---
  'Actual Result', 'Status', 'Severity', 'Test Environment',
  'Browser / Device / OS', 'Post-conditions', 'Executed By', 'Execution Date',
  'Defect / Bug ID',
  // --- authored again ---
  'Automation Candidate', 'Comments / Remarks',
];

/** Indices 7..15 inclusive. Filled by whoever runs the test, never by us. */
const EXECUTION_FIRST = 7;
const EXECUTION_LAST = 15;

const FIELD_TO_COLUMN = {
  id: 0, module: 1, req: 2, scenario: 3, steps: 4, data: 5, expected: 6,
  automation: 16, comments: 17,
};

// ---------------------------------------------------------------------------
// Provenance — which documents these cases were written from, and their content
// ---------------------------------------------------------------------------

/**
 * Test cases go stale when the story moves on without them, and a bolt that
 * reconciles against a stale sheet reports coverage that was true last month.
 *
 * Modification times do not detect this: a `git checkout`, a `git clone` or a
 * copied folder rewrites them all, and an editor can rewrite a file without
 * changing its content. So the file records what it was written from, by content.
 *
 * Shape, chosen so both this parser and the kit's YAML reader cope:
 *
 *   sources:
 *     - inputs/stories/CHK-42.md sha256:1f3a9c02b7d4
 */
export function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n?/g, '\n'));
  if (!m) return { fields: {}, sources: [], body: text, raw: '' };

  const fields = {};
  const sources = [];
  let inSources = false;

  for (const line of m[1].split('\n')) {
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (inSources && item) {
      const [, path, sha] = /^(.*?)(?:\s+sha256:([0-9a-f]+))?$/.exec(item[1].trim());
      sources.push({ path: path.trim(), sha: sha || null });
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    inSources = kv[1] === 'sources' && kv[2].trim() === '';
    if (!inSources) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fields, sources, body: text.slice(m[0].length), raw: m[1] };
}

const shaOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/**
 * Re-hash the documents a test-case file names, and rewrite its front matter.
 *
 * Called explicitly by `--stamp`, and automatically after a successful export —
 * exporting is the moment a version is handed to someone, which is exactly when
 * it is worth recording what it was built from.
 */
export function stampSources(root, mdFile, { defaults = [] } = {}) {
  const text = readFileSync(mdFile, 'utf8').replace(/\r\n?/g, '\n');
  const fm = parseFrontMatter(text);

  const paths = (fm.sources.length ? fm.sources.map((s) => s.path) : defaults)
    .filter(Boolean)
    .filter((p, i, a) => a.indexOf(p) === i);

  const stamped = paths.map((p) => {
    const abs = resolve(root, p);
    return { path: p, sha: existsSync(abs) ? shaOf(readFileSync(abs)) : null };
  });

  const lines = fm.raw
    .split('\n')
    .filter((l) => !/^\s*-\s/.test(l) && !/^(sources|stamped):/.test(l));

  lines.push('sources:');
  for (const s of stamped) lines.push(`  - ${s.path}${s.sha ? ` sha256:${s.sha}` : ''}`);
  lines.push(`stamped: ${new Date().toISOString()}`);

  writeFileSync(mdFile, `---\n${lines.filter((l) => l.trim()).join('\n')}\n---\n${fm.body}`, 'utf8');
  return stamped;
}

/**
 * Compare recorded hashes against the documents as they are now.
 *
 * Returns one of: unstamped (staleness cannot be judged — say so rather than
 * implying freshness), ok, or stale with the specific files that moved.
 */
export function checkSources(root, mdFile) {
  if (!existsSync(mdFile)) return { state: 'missing', changed: [] };
  const fm = parseFrontMatter(readFileSync(mdFile, 'utf8'));
  const hashed = fm.sources.filter((s) => s.sha);
  if (!hashed.length) return { state: 'unstamped', changed: [] };

  const changed = [];
  for (const s of hashed) {
    const abs = resolve(root, s.path);
    if (!existsSync(abs)) { changed.push({ ...s, why: 'no longer exists' }); continue; }
    if (shaOf(readFileSync(abs)) !== s.sha) changed.push({ ...s, why: 'content changed' });
  }
  return { state: changed.length ? 'stale' : 'ok', changed, sources: hashed };
}

// ---------------------------------------------------------------------------
// Markdown  <->  case objects
// ---------------------------------------------------------------------------

/**
 * Parse `test-cases/<ID>.md`.
 *
 * Tolerant about spacing and bold markers, strict about structure: a `##`
 * heading opens a case, `- **Field:** value` sets a field, and the three long
 * fields are `**Name**` blocks. Anything it cannot place is reported rather than
 * dropped, because a silently ignored section is a test case that vanishes.
 */
export function parseMarkdown(text) {
  const cases = [];
  const problems = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  let cur = null;
  let block = null;
  let buf = [];

  const flush = () => {
    if (cur && block) cur[block] = buf.join('\n').trim();
    block = null;
    buf = [];
  };

  const BLOCKS = {
    'test steps': 'steps',
    steps: 'steps',
    'test data': 'data',
    'expected result': 'expected',
    'comments / remarks': 'comments',
    comments: 'comments',
  };

  for (const line of lines) {
    const heading = /^##\s+(\S+)\s*(?:[—–-]\s*(.*))?$/.exec(line);
    if (heading && /^TC[_-]/i.test(heading[1])) {
      flush();
      if (cur) cases.push(cur);
      // Heading text is the scenario. An explicit `- **Test Scenario:**` line
      // still wins, so files written against the older format keep parsing.
      cur = { id: heading[1].trim(), scenario: (heading[2] || '').trim() };
      continue;
    }
    // Any other h2 ends the current case (coverage tables, open questions).
    if (/^##\s/.test(line) && cur) { flush(); cases.push(cur); cur = null; continue; }
    if (!cur) continue;

    const field = /^-\s*\*\*(.+?):?\*\*:?\s*(.*)$/.exec(line);
    if (field && !block) {
      const key = normaliseField(field[1]);
      if (key) cur[key] = field[2].trim();
      else problems.push(`${cur.id}: unrecognised field "${field[1]}"`);
      continue;
    }

    const blockHead = /^\*\*(.+?)\*\*\s*$/.exec(line);
    if (blockHead) {
      flush();
      const key = BLOCKS[blockHead[1].toLowerCase().trim()];
      if (key) block = key;
      else problems.push(`${cur.id}: unrecognised block "${blockHead[1]}"`);
      continue;
    }

    if (block) buf.push(line);
  }
  flush();
  if (cur) cases.push(cur);

  for (const tc of cases) {
    for (const key of ['module', 'req', 'scenario', 'steps', 'expected']) {
      if (!tc[key]) problems.push(`${tc.id}: missing ${key}`);
    }
  }
  return { cases, problems };
}

function normaliseField(raw) {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^module/.test(s)) return 'module';
  if (/^(user story|req)/.test(s)) return 'req';
  if (/^test scenario|^scenario/.test(s)) return 'scenario';
  if (/^automation/.test(s)) return 'automation';
  if (/^severity/.test(s)) return 'severity';
  return null;
}

/** A case object -> an 18-cell row. Execution columns stay empty by construction. */
export function toRow(tc) {
  const row = new Array(COLUMNS.length).fill('');
  for (const [field, index] of Object.entries(FIELD_TO_COLUMN)) {
    if (index >= EXECUTION_FIRST && index <= EXECUTION_LAST) continue;
    row[index] = tc[field] ?? '';
  }
  return row;
}

/** An 18-cell row -> a case object, for import. */
export function fromRow(row) {
  const tc = {};
  for (const [field, index] of Object.entries(FIELD_TO_COLUMN)) {
    const v = (row[index] ?? '').toString().trim();
    if (v) tc[field] = v;
  }
  return tc;
}

export function toMarkdown(cases, { bolt, story, coverage = '', notes = '', sources = [] } = {}) {
  const out = [
    '---',
    `bolt: ${bolt}`,
    story ? `story: ${story}` : null,
    `generated: ${new Date().toISOString()}`,
    'generator: e2e-testcases',
    // Provenance survives an import. Losing it on the round trip would quietly
    // turn a stale-detectable file back into an unstamped one.
    ...(sources.length
      ? ['sources:', ...sources.map((s) => `  - ${s.path}${s.sha ? ` sha256:${s.sha}` : ''}`)]
      : []),
    '---',
    '',
    `# Test cases — ${bolt}`,
    '',
    '> **Execution columns are deliberately blank.** Actual Result, Status,',
    '> Severity, Test Environment, Browser, Post-conditions, Executed By,',
    '> Execution Date and Defect ID are filled by whoever runs these tests.',
    '',
  ].filter((l) => l !== null);

  if (coverage) out.push(coverage.trim(), '');

  for (const tc of cases) {
    // The scenario is the heading. It is the one mandatory one-line description
    // the template keeps, so putting it here means the file reads well in a pull
    // request and still round-trips through the sheet without a spare column.
    out.push(`## ${tc.id} — ${tc.scenario || ''}`.trimEnd(), '');
    out.push(`- **Module / Feature:** ${tc.module || ''}`);
    out.push(`- **User Story / Req ID:** ${tc.req || bolt}`);
    out.push(`- **Automation Candidate:** ${tc.automation || ''}`);
    out.push('', '**Test Steps**', tc.steps || '', '');
    out.push('**Test Data**', tc.data || '_none_', '');
    out.push('**Expected Result**', tc.expected || '');
    if (tc.comments) out.push('', '**Comments / Remarks**', tc.comments);
    out.push('');
  }

  if (notes) out.push(notes.trim(), '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// CSV — RFC 4180
// ---------------------------------------------------------------------------

/**
 * Test Steps and Test Data contain newlines by construction, so quoting is not a
 * nicety. A CSV that breaks on the first multi-line cell fails in the client's
 * import tool, not here.
 */
export function toCsv(cases) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map(esc).join(',')];
  for (const tc of cases) lines.push(toRow(tc).map(esc).join(','));
  // CRLF per the RFC — Excel and most importers are happier with it.
  return lines.join('\r\n') + '\r\n';
}

export function fromCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function testcases(args = {}) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);
  const dir = join(root, get(cfg, 'paths.test_cases', 'test-cases'));

  if (args.import) return importSheet({ root, dir, args });

  const bolt = args.stamp || args.check || args.export || args.bolt || args._?.[1];
  if (!bolt) throw new Error('which bolt? use --export <ID>, --stamp <ID>, --check <ID>, or --import <file>');

  if (args.stamp) return stampCommand({ root, cfg, dir, bolt });
  if (args.check) return checkCommand({ root, dir, bolt });
  return exportCases({ root, cfg, dir, bolt, args });
}

/** Documents a test-case file is written from, when it does not say. */
function defaultSources(root, cfg, bolt) {
  const storiesDir = get(cfg, 'inputs.stories_dir', 'inputs/stories');
  const out = [];
  for (const ext of ['.md', '.txt']) {
    const p = join(root, storiesDir, `${bolt}${ext}`);
    if (existsSync(p)) { out.push(`${storiesDir}/${bolt}${ext}`); break; }
  }
  return out;
}

function stampCommand({ root, cfg, dir, bolt }) {
  const mdFile = join(dir, `${bolt}.md`);
  if (!existsSync(mdFile)) throw new Error(`no test cases at ${relish(root, mdFile)}`);
  head(`Stamp — ${bolt}`);
  const stamped = stampSources(root, mdFile, { defaults: defaultSources(root, cfg, bolt) });
  if (!stamped.length) {
    warn('no source documents recorded and no story found — nothing to stamp');
    info('add a `sources:` list to the front matter naming what these cases were written from');
    return { stamped: 0 };
  }
  for (const s of stamped) {
    s.sha ? ok(`${s.path}  sha256:${s.sha}`) : warn(`${s.path} — not found, recorded without a hash`);
  }
  console.log(`\n  ${c.dim('doctor now reports when any of these change.')}\n`);
  return { stamped: stamped.length };
}

function checkCommand({ root, dir, bolt }) {
  const mdFile = join(dir, `${bolt}.md`);
  const r = checkSources(root, mdFile);
  head(`Check — ${bolt}`);
  if (r.state === 'missing') throw new Error(`no test cases at ${relish(root, mdFile)}`);
  if (r.state === 'unstamped') {
    warn('not stamped — staleness cannot be judged');
    info(`run:  pw-aidlc testcases --stamp ${bolt}`);
    return r;
  }
  if (r.state === 'ok') {
    ok(`current — ${r.sources.length} source document(s) unchanged since these cases were written`);
    return r;
  }
  for (const ch of r.changed) bad(`${ch.path} — ${ch.why}`);
  console.log(`\n  ${c.dim('These cases may not cover the change. Re-run')} ${c.blue(`/testcases ${bolt}`)}${c.dim(', or re-stamp if you have reviewed them.')}\n`);
  process.exitCode = 1;
  return r;
}

function exportCases({ root, cfg, dir, bolt, args }) {
  const mdFile = join(dir, `${bolt}.md`);
  if (!existsSync(mdFile)) {
    throw new Error(`no test cases at ${relish(root, mdFile)} — write them first with /testcases ${bolt}`);
  }

  const { cases, problems } = parseMarkdown(readFileSync(mdFile, 'utf8'));
  head(`Export — ${bolt}`);
  if (!cases.length) throw new Error(`${relish(root, mdFile)} parsed to zero test cases — check the format`);
  ok(`${cases.length} test case(s) read from ${relish(root, mdFile)}`);
  for (const p of problems) warn(p);

  const format = (args.format || 'both').toLowerCase();
  const wantCsv = format === 'csv' || format === 'both';
  const wantXlsx = format === 'xlsx' || format === 'both';

  if (wantCsv) {
    const out = join(dir, `${bolt}.csv`);
    writeFileSync(out, toCsv(cases), 'utf8');
    ok(`${relish(root, out)} — ${COLUMNS.length} columns, RFC 4180`);
  }

  if (wantXlsx) {
    const template = templatePath(root);
    if (!template) {
      warn('no test-case template found — skipping the workbook');
      info('expected templates/test-case-template.xlsx in the kit, or test-cases/_template.xlsx in the project');
    } else {
      const src = readFileSync(template);
      const sheet = sheets(src).find((s) => /test case/i.test(s.name));
      if (!sheet) throw new Error(`${basename(template)} has no "Test Cases" sheet`);

      // A project keeps its own copy of the workbook, and `templatePath` prefers
      // it. So a project provisioned against an older template still has that
      // one, and rows written to today's column order would land under the wrong
      // headings — silently, because a full row of plausible values in the wrong
      // columns still looks like a test case. Refuse instead.
      assertTemplateColumns(src, sheet.file, template, root);

      const buf = replaceSheetData(src, sheet.file, {
        keepThroughRow: headerRowOf(src, sheet.file),
        rows: cases.map(toRow),
        styleFromRow: headerRowOf(src, sheet.file) + 1,
      });

      const out = join(dir, `${bolt}.xlsx`);
      writeFileSync(out, buf);

      // Re-read what we just wrote. A workbook that only fails in Excel fails on
      // a tester's machine, where nobody can debug it.
      const check = readRows(buf, sheet.file).filter((r) => (r.cells.A || '').startsWith('TC'));
      if (check.length !== cases.length) {
        bad(`wrote ${cases.length} case(s) but read back ${check.length} — not writing this file`);
        throw new Error('workbook verification failed');
      }
      ok(`${relish(root, out)} — ${check.length} rows, template formatting preserved`);
    }
  }

  // Exporting is the moment a version is handed to someone, so record what it
  // was built from. Without this, nothing can later tell whether the story moved.
  const stamped = stampSources(root, mdFile, { defaults: defaultSources(root, cfg, bolt) });
  if (stamped.length) info(`stamped ${stamped.length} source document(s) — doctor will report if they change`);

  console.log(`\n  ${c.dim('Execution columns (Actual Result, Status, Executed By, …) are blank by design.')}`);
  console.log(`  ${c.dim('Edited the workbook? Bring it back with:')}  ${c.blue(`pw-aidlc testcases --import test-cases/${bolt}.xlsx`)}\n`);
  return { cases: cases.length };
}

async function importSheet({ root, dir, args }) {
  const file = resolve(root, args.import);
  if (!existsSync(file)) throw new Error(`no such file: ${args.import}`);

  const ext = extname(file).toLowerCase();
  let rows;
  if (ext === '.csv') {
    rows = fromCsv(readFileSync(file, 'utf8')).slice(1);
  } else if (ext === '.xlsx') {
    const buf = readFileSync(file);
    const sheet = sheets(buf).find((s) => /test case/i.test(s.name));
    if (!sheet) throw new Error('no "Test Cases" sheet in that workbook');
    const all = readRows(buf, sheet.file);
    rows = all
      .filter((r) => /^TC[_-]/i.test(r.cells.A || ''))
      .map((r) => COLUMNS.map((_, i) => r.cells[colLetter(i)] || ''));
  } else {
    throw new Error('import expects a .xlsx or .csv file');
  }

  const incoming = rows.map(fromRow).filter((tc) => tc.id);
  if (!incoming.length) throw new Error('no test case rows found — is the Test Case ID column filled?');

  const bolt = args.bolt || boltIdOf(incoming[0].req);
  if (!bolt) throw new Error('cannot tell which bolt this is — pass --bolt <ID>');

  const foreign = incoming.filter((tc) => boltIdOf(tc.req) !== bolt);
  if (foreign.length) {
    warn(`${foreign.length} case(s) name a different story and will be imported as-is: ${foreign.map((tc) => `${tc.id} -> ${tc.req}`).slice(0, 3).join(', ')}`);
    info('a case belonging to another story should live in that story\'s file');
  }

  const mdFile = join(dir, `${bolt}.md`);
  const prior = existsSync(mdFile) ? readFileSync(mdFile, 'utf8') : '';
  const existing = prior ? parseMarkdown(prior).cases : [];
  const priorSources = prior ? parseFrontMatter(prior).sources : [];

  head(`Import — ${bolt}`);
  info(`${incoming.length} case(s) in ${basename(file)}, ${existing.length} in ${relish(root, mdFile)}`);

  const changes = diffCases(existing, incoming);
  if (!changes.length) {
    ok('no differences — nothing to do');
    return { changed: 0 };
  }

  console.log('');
  for (const ch of changes) {
    if (ch.kind === 'added') ok(`${ch.id}  added`);
    else if (ch.kind === 'removed') bad(`${ch.id}  removed`);
    else {
      warn(`${ch.id}  ${ch.fields.length} field(s) changed`);
      for (const f of ch.fields) {
        console.log(`      ${c.bold(f.field)}`);
        console.log(`        ${c.red('-')} ${oneLine(f.before)}`);
        console.log(`        ${c.green('+')} ${oneLine(f.after)}`);
      }
    }
  }

  // Never silent, and never automatic. This is the only thing standing between a
  // tester's edits and a regeneration that quietly discards them.
  console.log('');
  const answer = process.stdin.isTTY
    ? await prompt(`Apply ${changes.length} change(s) to ${relish(root, mdFile)}?`, { choices: ['yes', 'no'], default: 'no' })
    : 'no';

  if (answer !== 'yes') {
    info('not applied');
    if (!process.stdin.isTTY) info('re-run in an interactive terminal to apply');
    return { changed: 0, pending: changes.length };
  }

  ensureDir(dir);
  const story = get(loadConfig(root), 'inputs.stories_dir', 'inputs/stories');
  writeFileSync(
    mdFile,
    toMarkdown(incoming, { bolt, story: `${story}/${bolt}.md`, sources: priorSources }),
    'utf8'
  );
  ok(`${relish(root, mdFile)} updated — ${incoming.length} case(s)`);
  if (priorSources.length) info(`provenance kept — ${priorSources.length} source document(s) still tracked`);
  return { changed: changes.length };
}

function diffCases(before, after) {
  const byId = (list) => new Map(list.map((tc) => [tc.id, tc]));
  const a = byId(before);
  const b = byId(after);
  const out = [];

  for (const [id, tc] of b) {
    if (!a.has(id)) { out.push({ kind: 'added', id }); continue; }
    const old = a.get(id);
    const fields = [];
    for (const key of Object.keys(FIELD_TO_COLUMN)) {
      const x = norm(old[key]);
      const y = norm(tc[key]);
      if (x !== y) fields.push({ field: key, before: old[key] || '', after: tc[key] || '' });
    }
    if (fields.length) out.push({ kind: 'changed', id, fields });
  }
  for (const id of a.keys()) if (!b.has(id)) out.push({ kind: 'removed', id });
  return out;
}

/**
 * The bolt id inside a `User Story / Req ID` cell.
 *
 * The column is a join key — a bolt matches on it, and a test-management tool
 * links it to an issue — so it should hold the bare id. Authors annotate it
 * anyway ("US-MDUI-DRV-002 (AC-1)"), which is informative to a reader and useless
 * to everything else. Strip the annotation rather than reject the sheet: rejecting
 * an otherwise-good document over a parenthesis helps nobody.
 */
export const boltIdOf = (req) => String(req ?? '').replace(/\s*[([].*$/, '').trim();

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const oneLine = (v) => {
  const s = norm(v) || '(empty)';
  return s.length > 96 ? `${s.slice(0, 93)}…` : s;
};
const relish = (root, p) => p.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
const colLetter = (i) => {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
};

/** The header row is the one whose first cell reads "Test Case ID". */
function headerRowOf(buf, sheetFile) {
  const rows = readRows(buf, sheetFile);
  const hit = rows.find((r) => /test case id/i.test(r.cells.A || ''));
  return hit ? hit.r : 3;
}

/**
 * The template's header row has to be the column order this module writes.
 *
 * Reported as the specific mismatch rather than "template is wrong", because the
 * fix depends on which it is: a project copy left over from an older kit, or a
 * team edit that renamed a column the exporter fills.
 */
function assertTemplateColumns(src, sheetFile, template, root) {
  const rows = readRows(src, sheetFile);
  const hit = rows.find((r) => /test case id/i.test(r.cells.A || ''));
  if (!hit) throw new Error(`${basename(template)} has no header row starting with "Test Case ID"`);

  const found = COLUMNS.map((_, i) => (hit.cells[colLetter(i)] || '').toString().trim());
  const extra = Object.keys(hit.cells)
    .filter((k) => (hit.cells[k] || '').toString().trim())
    .length;

  const wrong = COLUMNS
    .map((want, i) => ({ i, want, got: found[i] }))
    .filter(({ want, got }) => want.toLowerCase() !== got.toLowerCase());

  if (!wrong.length && extra <= COLUMNS.length) return;

  bad(`${relish(root, template)} does not match the ${COLUMNS.length}-column template`);
  for (const { i, want, got } of wrong.slice(0, 4)) {
    info(`column ${colLetter(i)}: expected "${want}", found "${got || '(empty)'}"`);
  }
  if (extra > COLUMNS.length) info(`the sheet has ${extra} header cells, expected ${COLUMNS.length}`);
  info(`refresh it with: cp "${join(KIT, 'templates', 'test-case-template.xlsx')}" "${relish(root, template)}"`);
  throw new Error('template column mismatch — not writing a misaligned workbook');
}

function templatePath(root) {
  const project = join(root, 'test-cases', '_template.xlsx');
  if (existsSync(project)) return project;
  const kit = join(KIT, 'templates', 'test-case-template.xlsx');
  return existsSync(kit) ? kit : null;
}
