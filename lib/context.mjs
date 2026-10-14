#!/usr/bin/env node
/**
 * context.mjs — deterministic source scan for E2E test grounding.
 *
 * Extracts routes, test IDs, accessible names, form fields, HTTP calls and API
 * specs from a frontend source tree, so the planning agent starts from what the
 * code says rather than from clicking around the live app.
 *
 * Deliberately regex-level and dependency-free. It does the cheap mechanical
 * extraction; the agent does the semantic layer on top — but only at
 * `grounding: deep`. At `scan` this file is the whole of the code-side pass,
 * which is what keeps a bolt fast.
 *
 *   pw-aidlc context --src src --out context/app-context.md
 *   pw-aidlc context --src src --paths "src/checkout/**"
 *   pw-aidlc context --if-stale          # no-op when the tree has not changed
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, extname, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.html']);

const SKIP_DIR = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out', '__snapshots__',
  // added because they are large, generated, and never the grounding for a test
  '.turbo', '.cache', '.svelte-kit', '.nuxt', '.output', '.parcel-cache',
  'vendor', 'public', 'storybook-static', 'test-results', 'playwright-report',
]);

/**
 * Hoisted out of the per-file loop. Rebuilding these for every file was
 * measurable on large trees. `matchAll` clones the regex internally, so
 * sharing a /g instance across files is safe.
 */
const RE_ROUTE_JSX = /<Route\s[^>]*path=["'`]([^"'`]+)["'`][^>]*?(?:element|component)=\{?\s*<?([A-Z][\w]*)/g;
const RE_ROUTE_OBJ = /\{\s*path:\s*["'`]([^"'`]+)["'`][\s\S]{0,120}?component:\s*([A-Za-z][\w]*)/g;
const RE_PAGE_FILE = /\/(page|route)\.(tsx?|jsx?)$/;
const RE_TESTID = /data-testid=["'`{]?\s*["'`]?([\w:.-]+)/g;
const RE_ARIA = /aria-label=["'`]([^"'`]{2,60})["'`]/g;
const RE_FIELD = /<(?:input|select|textarea)\s([^>]*)>/gi;
const RE_FIELD_NAME = /(?:name|id)=["'`]([\w.-]+)["'`]/;
const RE_FIELD_TYPE = /type=["'`](\w+)["'`]/;
const RE_FIELD_REQUIRED = /\brequired\b/;
const RE_FETCH = /fetch\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*\{[^}]*method:\s*['"`](\w+)['"`])?/g;
const RE_CLIENT = /\b(?:axios|api|http|client)\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)/gi;
// Greedy-bounded rather than lazy: the closing quote already terminates the
// match, and the lazy form backtracked heavily across large files.
const RE_STRING = /["'`]([A-Z][^"'`\n]{7,90})["'`]/g;
const RE_STRING_SKIP = /^(https?:|\/|[A-Z_]+$)/;
const RE_STRING_KEEP = /\b(required|invalid|must|cannot|failed|error|success|please|already|not found|try again|confirmed|expired)\b/i;
const RE_FLAG = /(?:useFlag|isEnabled|featureFlag|flags)\s*[(\[.]\s*["'`]([\w.-]+)["'`]/g;

// Every rendered section is capped. An app-context.md too large for the agent to
// hold costs more than the detail it carries — it pushes the planner into
// summarising instead of planning, and burns the budget before Gate 1.
const MAX_ROUTES = 80;

const API_SPEC_CANDIDATES = [
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'swagger.yaml', 'swagger.json', 'schema.graphql', 'api/openapi.yaml',
];

/** Read the `source_hash:` recorded in an existing app-context.md, if any. */
export function readContextHash(outFile) {
  if (!existsSync(outFile)) return null;
  try {
    const head = readFileSync(outFile, 'utf8').slice(0, 2000);
    return /^source_hash:\s*(\S+)/m.exec(head)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildContext({
  src = 'src',
  outFile = 'context/app-context.md',
  paths = '',
  maxFiles = 1500,
  maxFileSize = 512 * 1024,
  depth = 'scan',
  ifStale = false,
} = {}) {
  const started = Date.now();
  const SRC = src;
  const OUT = outFile;
  const FILTER = paths;

  if (!existsSync(SRC)) throw new Error(`Source directory not found: ${SRC}`);

  let truncated = false;

  function walk(dir, acc = []) {
    if (acc.length >= maxFiles) { truncated = true; return acc; }
    let entries;
    try { entries = readdirSync(dir); } catch { return acc; }
    for (const entry of entries) {
      if (acc.length >= maxFiles) { truncated = true; return acc; }
      if (SKIP_DIR.has(entry) || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, acc);
      else if (CODE_EXT.has(extname(entry)) && st.size <= maxFileSize) acc.push({ path: full, size: st.size, mtime: st.mtimeMs });
    }
    return acc;
  }

  let files = walk(SRC);
  if (FILTER) {
    // Comma-separated globs; we only need prefix matching, not real globbing.
    // Both sides are normalised to forward slashes first: walk() produces
    // native separators, so on Windows a "src/checkout/**" needle would never
    // match "src\checkout\Form.tsx" and the filter would silently select
    // nothing at all.
    const slash = (s) => s.replace(/\\/g, '/');
    const needles = FILTER.split(',')
      .map((p) => slash(p.trim()).replace(/\*+/g, '').replace(/\/+$/, ''))
      .filter(Boolean);
    if (needles.length) {
      files = files.filter((f) => {
        const p = slash(f.path);
        return needles.some((n) => p.includes(n));
      });
      if (!files.length) {
        console.log(`\n  WARNING: --paths "${FILTER}" matched no files under ${SRC}.`);
        console.log('  Paths are matched against the scanned tree, e.g. --paths "src/checkout".\n');
      }
    }
  }

  // Freshness: a hash of what we are about to read. Lets `--if-stale` skip a
  // rescan on fact rather than on the agent's judgement.
  const hash = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${f.path}:${f.size}:${f.mtime}\n`);
  }
  const sourceHash = hash.digest('hex').slice(0, 16);

  if (ifStale && readContextHash(OUT) === sourceHash) {
    return {
      out: OUT, files: files.length, routes: 0, testids: 0,
      ms: Date.now() - started, hash: sourceHash, skipped: true, truncated,
    };
  }

  const routes = [];
  const testids = new Map();          // id -> [files]
  const accessibleNames = new Map();  // aria-label -> [files]
  const forms = new Map();            // file -> [fields]
  const apiCalls = new Map();         // "METHOD path" -> [files]
  const messages = new Map();         // file -> [strings that look user-facing]
  const flags = new Set();

  const add = (map, key, val) => {
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(val)) map.get(key).push(val);
  };

  for (const { path: file } of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relative(process.cwd(), file);

    // --- routes: react-router, next/app dir, vue-router, angular ---
    for (const m of text.matchAll(RE_ROUTE_JSX)) routes.push({ path: m[1], component: m[2], file: rel });
    for (const m of text.matchAll(RE_ROUTE_OBJ)) routes.push({ path: m[1], component: m[2], file: rel });
    if (RE_PAGE_FILE.test(rel)) {
      const p = '/' + relative(SRC, dirname(file)).replace(/^app\/?/, '').replace(/\\/g, '/');
      routes.push({ path: p === '/' ? '/' : p.replace(/\/$/, ''), component: rel, file: rel });
    }

    // --- test ids ---
    for (const m of text.matchAll(RE_TESTID)) add(testids, m[1], rel);

    // --- accessible names ---
    for (const m of text.matchAll(RE_ARIA)) add(accessibleNames, m[1], rel);

    // --- form fields ---
    const fields = [];
    for (const m of text.matchAll(RE_FIELD)) {
      const attrs = m[1];
      const name = RE_FIELD_NAME.exec(attrs)?.[1];
      const type = RE_FIELD_TYPE.exec(attrs)?.[1] ?? 'text';
      if (name) fields.push({ name, type, required: RE_FIELD_REQUIRED.test(attrs) });
    }
    if (fields.length) forms.set(rel, fields);

    // --- HTTP calls ---
    for (const m of text.matchAll(RE_FETCH)) add(apiCalls, `${(m[2] ?? 'GET').toUpperCase()} ${m[1]}`, rel);
    for (const m of text.matchAll(RE_CLIENT)) add(apiCalls, `${m[1].toUpperCase()} ${m[2]}`, rel);

    // --- user-facing strings (validation / error / confirmation copy) ---
    const msgs = [];
    for (const m of text.matchAll(RE_STRING)) {
      const s = m[1];
      if (RE_STRING_SKIP.test(s)) continue;
      if (RE_STRING_KEEP.test(s) && !msgs.includes(s)) msgs.push(s);
      if (msgs.length >= 25) break;
    }
    if (msgs.length) messages.set(rel, msgs);

    // --- feature flags ---
    for (const m of text.matchAll(RE_FLAG)) flags.add(m[1]);
  }

  const apiSpecs = API_SPEC_CANDIDATES.filter((cand) => existsSync(cand));

  const uniqRoutes = [...new Map(routes.map((r) => [r.path + r.component, r])).values()]
    .sort((a, b) => a.path.localeCompare(b.path));

  // Resolve the commit in the *source* tree, not the working directory. When
  // source.path points at a sibling checkout those are different repositories,
  // and recording the test repo's commit would make the provenance a lie.
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: SRC, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  }

  const elapsed = Date.now() - started;

  const table = (rows) => rows.join('\n');
  const listMap = (map, limit = 60) =>
    [...map.entries()].slice(0, limit).map(([k, v]) => `| \`${k}\` | ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` +${v.length - 3}` : ''} |`);

  const deepSection = depth === 'deep' ? `
---

## TO BE COMPLETED BY THE AGENT

The scan cannot infer these. Read the files above and fill them in.

### Validation rules
| Surface | Field | Rule | Exact message | Source |

### States per surface
| Surface | States the code can produce | Reachable how |

### Authorization
| Control | Roles that see it | Source |

### Async behaviour
| Surface | Debounce / poll / retry / optimistic update | Implication for waits |

### Locator readiness
| Surface | Rating | What is missing |

### Open questions for the team
` : `
---

## Scan-only grounding

\`grounding: scan\` — this file is the **whole** of the code-side pass. No agent
read of the source happened, which is what keeps the bolt fast.

That means discrepancy detection is **partial**: routes, test IDs, form fields
and the exact message strings above can still be cross-checked against the live
app, but validation logic, state machines, authorization rules and async
behaviour were not derived. Gate 1 must say so rather than imply full coverage.

Re-run with \`--depth deep\` (or set \`source.grounding: deep\`, or mark the bolt
\`risk: high\`) when a bolt needs the semantic layer.
`;

  const out = `---
generated_at: ${new Date().toISOString()}
commit: ${commit}
scope: ${SRC}${FILTER ? ` (filtered: ${FILTER})` : ''}
grounding: ${depth}
files_scanned: ${files.length}
elapsed_ms: ${elapsed}
source_hash: ${sourceHash}
truncated: ${truncated}
generator: pw-aidlc context
---

# Application Context (mechanical scan)

> Machine-extracted.${depth === 'deep' ? ' The agent must add the semantic layer — validation rules,\n> state transitions, authorization, async behaviour — by reading the files below.\n> Do not treat this file as complete on its own.' : ' Scan-only: see the note at the end for what is\n> deliberately *not* covered here.'}
${truncated ? `\n> **Truncated** — the scan stopped at ${maxFiles} files. Narrow it with \`--paths\`,\n> or raise \`--max-files\`. Anything past the cap is invisible to this file.\n` : ''}
## Routes (${uniqRoutes.length})

| Path | Component | File |
|---|---|---|
${table(uniqRoutes.slice(0, MAX_ROUTES).map((r) => `| \`${r.path}\` | ${r.component} | ${r.file} |`)) || '| _none detected_ | | |'}
${uniqRoutes.length > MAX_ROUTES ? `\n> **${uniqRoutes.length - MAX_ROUTES} more routes not listed.** This application is larger than\n> one bolt should cover. Narrow the scan with \`--paths\` to the area under test —\n> a context file the agent cannot hold is worse than a smaller, accurate one.\n` : ''}

## Test IDs (${testids.size})

${testids.size === 0
    ? '**None found.** Locators will have to rely on roles and accessible names. If those are also missing, flag this at Gate 1 and recommend adding `data-testid` to the source before generating tests.'
    : `| testid | Files |\n|---|---|\n${table(listMap(testids))}`}

## Accessible names (${accessibleNames.size})

${accessibleNames.size === 0 ? '_No explicit aria-labels found._' : `| aria-label | Files |\n|---|---|\n${table(listMap(accessibleNames, 40))}`}

## Form fields

${forms.size === 0 ? '_No form elements detected._' : [...forms.entries()].slice(0, 30).map(([f, flds]) =>
    `### ${f}\n\n| Field | Type | Required |\n|---|---|---|\n${flds.map((x) => `| ${x.name} | ${x.type} | ${x.required ? 'yes' : ''} |`).join('\n')}`).join('\n\n')}

## API calls (${apiCalls.size})

${apiCalls.size === 0 ? '_None detected._' : `| Call | Files |\n|---|---|\n${table(listMap(apiCalls))}`}

## API specs on disk

${apiSpecs.length ? apiSpecs.map((s) => `- \`${s}\``).join('\n') : '_None found — check for a contract elsewhere._'}

## Feature flags (${flags.size})

${flags.size ? [...flags].map((f) => `- \`${f}\``).join('\n') : '_None detected._'}

## Candidate user-facing messages

> Assert on these **exactly**. Verify each against the live app — a string in
> source is not proof it is what renders.

${messages.size === 0 ? '_None detected._' : [...messages.entries()].slice(0, 20).map(([f, ms]) =>
    `### ${f}\n${ms.map((m) => `- "${m}"`).join('\n')}`).join('\n\n')}
${deepSection}`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out, 'utf8');

  console.log(`Wrote ${OUT}`);
  console.log(`  grounding     : ${depth}`);
  console.log(`  files scanned : ${files.length}${truncated ? ` (truncated at ${maxFiles})` : ''}`);
  console.log(`  routes        : ${uniqRoutes.length}`);
  console.log(`  test ids      : ${testids.size}`);
  console.log(`  form files    : ${forms.size}`);
  console.log(`  api calls     : ${apiCalls.size}`);
  console.log(`  flags         : ${flags.size}`);
  console.log(`  elapsed       : ${elapsed} ms`);
  if (testids.size === 0 && accessibleNames.size === 0) {
    console.log('\n  WARNING: no test ids and no aria-labels found.');
    console.log('  Generated locators will be fragile. Consider adding data-testid first.');
  }
  if (truncated) {
    console.log(`\n  WARNING: stopped at ${maxFiles} files. Narrow with --paths, or raise --max-files.`);
  }

  return {
    files: files.length, routes: uniqRoutes.length, testids: testids.size,
    out: OUT, ms: elapsed, hash: sourceHash, truncated, skipped: false,
  };
}
