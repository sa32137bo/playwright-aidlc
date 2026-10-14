import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { c, ok, warn, bad, info, head, loadConfig, get, resolveGrounding, GROUNDING_LEVELS } from './util.mjs';

let failures = 0;
let warnings = 0;
const fail = (m, fix) => { failures++; bad(m); if (fix) console.log(`      ${c.dim('fix:')} ${c.blue(fix)}`); };
const soft = (m, fix) => { warnings++; warn(m); if (fix) console.log(`      ${c.dim('fix:')} ${c.blue(fix)}`); };

const sh = (cmd) => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
};

// This command overwrites tests/seed.spec.ts if one already exists (confirmed
// live, bolt US-CLC-001, "CLC_21_09" run, 2026-09-21 — a real credential-smoke
// seed was silently replaced with a 7-line stub). Named once here so all three
// call sites below warn about it identically, not just whichever one someone
// remembers to update.
const INIT_AGENTS_FIX = 'npx playwright init-agents --loop=claude (⚠ overwrites tests/seed.spec.ts if one exists — commit or back it up first)';

/**
 * Skills in the project that differ from the ones this kit ships, compared by
 * content. Returns [] when everything matches, or null if the kit's own skill
 * directory cannot be located.
 */
/** How many skills this kit ships. Falls back to 8, the count before rebind. */
function kitSkillCount() {
  try {
    const dir = fileURLToPath(new URL('../skills', import.meta.url));
    return existsSync(dir) ? readdirSync(dir).length : 8;
  } catch {
    return 8;
  }
}

function staleSkills(installedDir) {
  const kitSkills = fileURLToPath(new URL('../skills', import.meta.url));
  if (!existsSync(kitSkills)) return null;
  const out = [];
  for (const name of readdirSync(kitSkills)) {
    if (!existsSync(join(kitSkills, name, 'SKILL.md'))) continue;
    // Every file in the skill's folder, not only SKILL.md: a skill can keep
    // detail in a supporting file (e2e-bolt/workbench-push.md), and drift
    // there is just as stale.
    for (const entry of readdirSync(join(kitSkills, name), { withFileTypes: true })) {
      if (!entry.isFile()) continue; // a subfolder would make readFileSync throw and void the whole check
      const file = entry.name;
      const mine = join(kitSkills, name, file);
      const theirs = join(installedDir, name, file);
      if (!existsSync(theirs)) { out.push(name); break; }
      try {
        const a = readFileSync(mine, 'utf8').replace(/\r\n/g, '\n');
        const b = readFileSync(theirs, 'utf8').replace(/\r\n/g, '\n');
        if (a !== b) { out.push(name); break; }
      } catch { return null; }
    }
  }
  return out;
}

/** Rough size of the tree a scan would walk — enough to warn on, cheap to get. */
function countSourceFiles(dir, cap = 1500) {
  const CODE = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.html']);
  const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out',
    '__snapshots__', '.turbo', '.cache', '.svelte-kit', '.nuxt', '.output', 'vendor', 'public',
    'storybook-static', 'test-results', 'playwright-report']);
  let n = 0;
  const walk = (d) => {
    if (n >= cap) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (n >= cap) return;
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (CODE.has(e.name.slice(e.name.lastIndexOf('.')))) n++;
    }
  };
  walk(dir);
  return n;
}

/**
 * A heuristic, not a certainty. 'TODO:' catches this kit's own unfilled
 * template exactly; the missing-process.env check catches placeholders
 * from any other source (an IDE's default new-test snippet, a blank
 * scaffold) that 'TODO:' alone can't, since none of those can be doing
 * real credential-based sign-in without reading a credential from
 * somewhere. Caught in the wild: a real workspace had a non-template stub
 * neither this file's old 'TODO:'-only check nor actually running the
 * test (it passed trivially in ~0.2s, an empty test body) would catch.
 *
 * Known false positive: a seed test that delegates sign-in to a shared
 * helper module rather than reading process.env inline will trip this,
 * even though it may be entirely real — this codebase is already moving
 * that direction (see the shared support module a real bolt run
 * extracted). That's why this is `soft()`, not `fail()`, at the call site.
 */
function looksLikeUnfilledSeed(src) {
  return src.includes('TODO:') || !src.includes('process.env');
}

// Returns { status } on a real response, or { status: null, tlsError } on
// failure. tlsError is set when Node's fetch (strict cert verification,
// unlike the generated playwright.config.ts's own ignoreHTTPSErrors: true)
// rejected the connection specifically over TLS - confirmed as a real,
// repeated false negative (GHC run-11): this reported a host as
// "unreachable" while it was, at that same moment, serving 200s and
// accepting real sign-ins behind a corporate CA. A TLS failure and a host
// genuinely being down are different findings and must not share one
// blocking check - see the call sites below.
async function reachable(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status };
  } catch (err) {
    const code = err?.cause?.code || '';
    const message = err?.cause?.message || err?.message || '';
    const tlsError = /CERT|SSL|TLS/i.test(code) || /certificate/i.test(message);
    return { status: null, tlsError };
  } finally { clearTimeout(t); }
}

export async function doctor(args) {
  const root = resolve(args.root || process.cwd());
  console.log(c.bold('\nPlaywright AI-DLC — preflight\n'));

  // --- config ---------------------------------------------------------
  head('Configuration');
  const cfg = loadConfig(root);
  if (!cfg) {
    fail('e2e.config.yml not found', 'npx pw-aidlc init <project-name>');
    return summary();
  }
  const mode = get(cfg, 'project.mode');
  const type = get(cfg, 'project.type', 'webapp');
  ok(`${get(cfg, 'project.name')} — ${c.bold(mode)} / ${type}`);

  // --- toolchain ------------------------------------------------------
  head('Toolchain');
  const node = Number(process.versions.node.split('.')[0]);
  node >= 18 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} — 18+ required`);

  const pw = sh('npx playwright --version');
  if (!pw) {
    fail('Playwright not installed', 'npm init playwright@latest');
  } else {
    const v = pw.match(/(\d+)\.(\d+)/);
    const okVer = v && (Number(v[1]) > 1 || Number(v[2]) >= 56);
    okVer ? ok(pw) : fail(`${pw} — 1.56+ required for the official test agents`, 'npm i -D @playwright/test@latest');
  }

  // --- execution --------------------------------------------------------
  // playwright.config.ts is never scaffolded or touched by this kit — it comes
  // entirely from `npm init playwright@latest`, which defaults to three browser
  // projects. Nothing reconciles that against execution.browsers in
  // e2e.config.yml, so the two silently drift: a config that says "chromium
  // only" can still execute on Firefox and WebKit too, tripling run time with
  // no warning anywhere. Caught in the wild via a Gate 2 review that noticed
  // it by hand — this check exists so nobody has to notice it by hand again.
  head('Execution');
  const pwConfigPath = join(root, 'playwright.config.ts');
  if (!existsSync(pwConfigPath)) {
    soft('playwright.config.ts not found — expected after `npm init playwright@latest`');
  } else {
    // Strip comments first — a commented-out project block still contains the
    // literal text `name: 'firefox'`, and a naive scan would flag a browser
    // that is not actually configured at all.
    // The negative lookbehind on `//` avoids treating a URL's `://` (e.g. a
    // baseURL sharing a line with a project name) as a line comment — a plain
    // `\/\/.*$` would truncate the line at the URL and lose whatever followed.
    const stripped = readFileSync(pwConfigPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?<!:)\/\/.*$/gm, '');
    const rawBrowsers = get(cfg, 'execution.browsers');
    const configuredBrowsers = new Set(
      (Array.isArray(rawBrowsers) ? rawBrowsers : []).map((b) => String(b).trim().toLowerCase()).filter(Boolean)
    );
    const actualBrowsers = new Set();
    const namePattern = /name:\s*['"`](chromium|firefox|webkit)['"`]/gi;
    let m;
    while ((m = namePattern.exec(stripped))) actualBrowsers.add(m[1].toLowerCase());

    if (!actualBrowsers.size) {
      info('could not detect named browser projects in playwright.config.ts — skipping this check');
    } else if (!configuredBrowsers.size) {
      info(`execution.browsers is not set in e2e.config.yml; playwright.config.ts currently runs ${[...actualBrowsers].join(', ')}`);
    } else {
      const extra = [...actualBrowsers].filter((b) => !configuredBrowsers.has(b));
      const missing = [...configuredBrowsers].filter((b) => !actualBrowsers.has(b));
      if (extra.length) {
        soft(`playwright.config.ts runs ${[...actualBrowsers].join(', ')}, but execution.browsers only names ${[...configuredBrowsers].join(', ')} — every run silently executes on ${extra.join(', ')} too`,
          `remove the unused project(s) from playwright.config.ts, or add ${extra.join(', ')} to execution.browsers if that is actually intended`);
      }
      if (missing.length) {
        soft(`execution.browsers names ${missing.join(', ')}, but playwright.config.ts has no project for ${missing.length > 1 ? 'them' : 'it'} — coverage the config claims is not actually running`,
          `add a project for ${missing.join(', ')} to playwright.config.ts, or remove ${missing.join(', ')} from execution.browsers`);
      }
      if (!extra.length && !missing.length) {
        ok(`playwright.config.ts projects match execution.browsers (${[...configuredBrowsers].join(', ')})`);
      }
    }
  }

  // --- official agents ------------------------------------------------
  head('Playwright agents');
  const agentsDir = join(root, '.claude/agents');
  const wanted = ['planner', 'generator', 'healer'];
  if (!existsSync(agentsDir)) {
    fail('.claude/agents/ missing', INIT_AGENTS_FIX);
  } else {
    const files = readdirSync(agentsDir).join(' ');
    const missing = wanted.filter((w) => !files.includes(w));
    missing.length
      ? fail(`missing agent definitions: ${missing.join(', ')}`, INIT_AGENTS_FIX)
      : ok('planner, generator, healer installed');
  }

  // --- MCP registration -------------------------------------------------
  // Claude Code reads .mcp.json under the "mcpServers" key; VS Code Copilot
  // reads .vscode/mcp.json under "servers". Each tool silently ignores a
  // file using the other's key — no error, the MCP tools just never show
  // up — so this checks the key inside each file, not only that the file
  // exists.
  head('MCP registration');
  const checkMcpFile = (relPath, wantKey, wrongKey, forWhat, missingFix) => {
    const p = join(root, relPath);
    if (!existsSync(p)) {
      soft(`${relPath} missing — live browser exploration under ${forWhat} has no MCP tool`, missingFix);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      fail(`${relPath} is not valid JSON`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${relPath} is not a JSON object`);
      return;
    }
    if (parsed[wrongKey] && !parsed[wantKey]) {
      fail(
        `${relPath} uses "${wrongKey}" — ${forWhat} reads "${wantKey}" and silently ignores this file, not an error, so the MCP tools just never appear`,
        `rename "${wrongKey}" to "${wantKey}" in ${relPath}`
      );
    } else if (!parsed[wantKey]) {
      fail(`${relPath} has neither "${wantKey}" nor "${wrongKey}" — no server registered`);
    } else {
      ok(`${relPath} registers under "${wantKey}"`);
    }
  };
  checkMcpFile('.mcp.json', 'mcpServers', 'servers', 'Claude Code', INIT_AGENTS_FIX);
  checkMcpFile(
    '.vscode/mcp.json', 'servers', 'mcpServers', 'VS Code Copilot',
    'copy .vscode/mcp.json from the playwright-aidlc kit root (no generic scaffolding command for this exists yet outside scripts/unpack.ps1)'
  );

  // --- kit skills -----------------------------------------------------
  head('Kit');
  const skills = join(root, '.claude/skills');
  if (!existsSync(skills)) fail('.claude/skills/ missing', 'npx pw-aidlc init --yes');
  else {
    const found = readdirSync(skills).filter((s) => s.startsWith('e2e-'));
    // Compare against the kit rather than a hard-coded number — a count baked in
    // here goes stale the moment a skill is added, and reports a healthy project
    // as broken (or, worse, a stale one as healthy).
    const expected = kitSkillCount();
    found.length >= expected
      ? ok(`${found.length} skills installed`)
      : soft(`${found.length} skills found, kit has ${expected}`, 'npx pw-aidlc init --yes');

    // Upgrading the kit does not update a project that was scaffolded earlier —
    // the skills were copied in. A project running last release's skills gets
    // last release's behaviour no matter what the CLI does, and the symptom is
    // confusing: the config says one thing and the agent does another.
    const stale = staleSkills(skills);
    if (stale === null) {
      info('could not compare installed skills against the kit');
    } else if (stale.length) {
      soft(`${stale.length} skill(s) differ from this kit version: ${stale.join(', ')}`,
        'npx pw-aidlc init --yes   (refreshes skills and commands; leaves your config, tests and knowledge edits alone)');
    } else {
      ok('skills match this kit version');
    }
  }
  existsSync(join(root, 'CLAUDE.md')) && readFileSync(join(root, 'CLAUDE.md'), 'utf8').includes('playwright-aidlc-kit')
    ? ok('CLAUDE.md contains the kit section')
    : fail('CLAUDE.md missing the kit section — the agent will not follow the gates', 'npx pw-aidlc init --yes');

  // --- secrets --------------------------------------------------------
  head('Secrets');
  const gi = existsSync(join(root, '.gitignore')) ? readFileSync(join(root, '.gitignore'), 'utf8') : '';
  gi.includes('.env.local') ? ok('.env.local is gitignored') : fail('.env.local NOT gitignored', 'npx pw-aidlc init --yes');
  gi.includes('storageState') ? ok('storageState is gitignored') : soft('storageState not gitignored');

  const tracked = sh('git ls-files') || '';
  // `.env.local.example` is shipped by `init` and is meant to be committed — it is
  // how a developer learns which variables exist. Flagging it turns every fresh
  // project red, which is how people learn to ignore this check. So a template is
  // allowed through *unless someone has filled a real value into it*, which is the
  // failure that actually leaks.
  const isTemplate = /\.(example|sample|template)$/i;
  const hasRealValue = (f) => {
    try {
      return readFileSync(join(root, f), 'utf8')
        .split('\n')
        .some((l) => /^[A-Z_][A-Z0-9_]*=.+/.test(l) && !/=\s*$|CHANGE_ME|your-|<[^>]*>/.test(l));
    } catch {
      return false;
    }
  };
  const leaked = tracked
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.env(\.|$)|storageState|\.auth\//.test(f))
    .filter((f) => !isTemplate.test(f) || hasRealValue(f));
  leaked.length
    ? fail(`SECRETS TRACKED IN GIT: ${leaked.join(', ')}`, `git rm --cached ${leaked.join(' ')}`)
    : ok('no credential files tracked by git');

  if (existsSync(join(root, '.env.local'))) {
    const env = readFileSync(join(root, '.env.local'), 'utf8');
    // Must allow a digit in the name (E2E_USER, OAUTH2_TOKEN, ...) — a name-only
    // charset here silently fails to match the kit's own example variable names.
    const filled = env.split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=.+/.test(l) && !/=\s*$|CHANGE_ME|your-/.test(l));
    filled.length ? ok(`.env.local has ${filled.length} values set`) : soft('.env.local has no values set yet — auth will fail');
  } else soft('.env.local not found');

  // --- inputs ---------------------------------------------------------
  head('Inputs');
  const storiesDir = join(root, 'inputs/stories');
  const stories = existsSync(storiesDir) ? readdirSync(storiesDir).filter((f) => /\.(md|txt|json)$/.test(f)) : [];
  const jira = get(cfg, 'inputs.jira.base_url');
  if (mode === 'characterization') {
    ok('characterization mode — no stories required');
  } else if (stories.length) {
    ok(`${stories.length} story file(s) in inputs/stories/`);
  } else if (jira) {
    info(`no local stories; will pull from Jira (${jira})`);
    soft('Jira access is not verified here — confirm the Atlassian MCP connector is enabled in Claude Code');
  } else {
    fail(`${mode} mode needs stories`, 'drop a .md file in inputs/stories/ or set inputs.jira.base_url');
  }

  const reqs = existsSync(join(root, 'inputs/requirements')) ? readdirSync(join(root, 'inputs/requirements')).filter((f) => !f.startsWith('.')) : [];
  // Zero is a supported project, not a gap: /testcases and planning both ground
  // in the story's acceptance criteria. Said out loud so an empty directory does
  // not read as something the user forgot to do.
  info(reqs.length
    ? `${reqs.length} requirement doc(s)`
    : 'no requirement docs — optional; stories are the required grounding');

  // A .docx or .pdf with no .md beside it is invisible to every skill: the
  // planner cannot open it, so the document silently contributes nothing. In
  // greenfield, where documents are the only grounding, that is the difference
  // between a real plan and a guessed one.
  const unconverted = [];
  for (const dir of ['inputs/requirements', 'inputs/stories', 'inputs/contracts']) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!/\.(docx|pdf)$/i.test(f)) continue;
      if (!existsSync(join(d, f.replace(/\.(docx|pdf)$/i, '.md')))) unconverted.push(`${dir}/${f}`);
    }
  }
  if (unconverted.length) {
    soft(`${unconverted.length} document(s) not converted — no skill can read .docx or .pdf: ${unconverted.slice(0, 3).join(', ')}${unconverted.length > 3 ? ', …' : ''}`);
    info('run:  pw-aidlc ingest');
  }

  // Test cases are optional, so their absence is not worth a line. A file whose
  // source documents have moved on is, because a bolt treats it as approved.
  //
  // Compared by content, not by timestamp: a clone, a checkout or a copied folder
  // rewrites every mtime, and an editor can rewrite a file without changing a
  // byte of it. Either way a timestamp answers the wrong question.
  const tcPath = get(cfg, 'paths.test_cases', 'test-cases');
  const tcDir = join(root, tcPath);
  if (existsSync(tcDir)) {
    const tcFiles = readdirSync(tcDir).filter((f) => f.endsWith('.md'));
    if (tcFiles.length) {
      ok(`${tcFiles.length} test-case document(s) in ${tcPath}/`);
      const { checkSources } = await import('./testcases.mjs');
      for (const f of tcFiles) {
        const r = checkSources(root, join(tcDir, f));
        if (r.state === 'stale') {
          soft(`${f} was written from documents that have since changed: ${r.changed.map((ch) => `${ch.path} (${ch.why})`).join(', ')}`,
            `npx pw-aidlc testcases --check ${f.replace(/\.md$/, '')}`);
        } else if (r.state === 'unstamped') {
          info(`${f} has no source provenance — staleness cannot be checked (pw-aidlc testcases --stamp ${f.replace(/\.md$/, '')})`);
        }
      }
    }
  }

  // A shipped bolt whose story was edited afterwards is the one kind of
  // staleness no test run can surface: the specs still pass, because they still
  // assert what the story used to say. Same content-hash reasoning as above.
  const boltsDir = join(root, get(cfg, 'paths.bolts', 'bolts'));
  if (existsSync(boltsDir)) {
    const ids = readdirSync(boltsDir).filter((f) => {
      try { return statSync(join(boltsDir, f)).isDirectory() && existsSync(join(boltsDir, f, 'story.snapshot.md')); }
      catch { return false; }
    });
    if (ids.length) {
      const { extractACs, alignACs, resolveStory } = await import('./storydiff.mjs');
      let drifted = 0;
      let unchecked = 0;
      for (const id of ids) {
        // doctor is the command people run when something is already wrong, so
        // it must survive anything on disk: an unreadable snapshot, a story in
        // a shape the parser does not recognise, a half-written file. A crash
        // here would take out every check below it, none of which is related.
        try {
          const snap = readFileSync(join(boltsDir, id, 'story.snapshot.md'), 'utf8').replace(/^<!--[\s\S]*?-->\s*\n?/, '');
          const found = resolveStory(root, cfg, id);
          if (!found.path) { unchecked++; soft(`bolt ${id} has a snapshot but its story is missing`, `pw-aidlc story-diff ${id}`); continue; }
          const now = readFileSync(join(root, found.path), 'utf8');
          const moved = alignACs(extractACs(snap), extractACs(now))
            .filter((r) => r.class === 'reworded' || r.class === 'added' || r.class === 'removed');
          if (moved.length) {
            drifted++;
            soft(`bolt ${id}: ${moved.length} acceptance criteri${moved.length === 1 ? 'on has' : 'a have'} moved since Gate 1`, `/revise ${id}`);
          }
        } catch {
          unchecked++;
          info(`bolt ${id} — story drift could not be checked (pw-aidlc story-diff ${id})`);
        }
      }
      const checked = ids.length - unchecked;
      if (!drifted && checked) ok(`${checked} bolt(s) still match the story they were approved against`);
    }
  }

  // --- source ---------------------------------------------------------
  head('Source code grounding');
  const src = typeof get(cfg, 'source.path') === 'string' ? get(cfg, 'source.path').trim() : '';
  const configured = get(cfg, 'source.grounding');
  const g = resolveGrounding({ cfg });

  if (configured !== undefined && configured !== null && !GROUNDING_LEVELS.includes(String(configured).trim().toLowerCase())) {
    fail(`source.grounding "${configured}" is not valid`, `use one of: ${GROUNDING_LEVELS.join(', ')}`);
  }

  if (!src) {
    soft(mode === 'greenfield'
      ? 'no source.path configured — planning is document-only (the story, plus requirement docs if there are any). Expected in greenfield.'
      : 'no source.path configured — planning will be live-app-only, and discrepancy detection is disabled');
  } else if (!existsSync(join(root, src))) {
    fail(`source.path "${src}" not found`, 'set source.path in e2e.config.yml (a sibling checkout path is fine)');
  } else {
    ok(`source at ${src}`);

    const n = countSourceFiles(join(root, src));
    ok(`grounding: ${g.depth} — ${g.reason}`);

    if (g.depth === 'scan') {
      info(`${n}${n >= 1500 ? '+' : ''} source file(s); discrepancy detection is PARTIAL — strings, test IDs, form fields and routes, not deeper logic`);
      if (configured === undefined || configured === null) {
        info('source.grounding is not set, so "scan" applies. Set it explicitly to make the choice visible to your team.');
      }
    } else if (g.depth === 'deep') {
      if (n >= 400) {
        soft(`deep grounding over ${n}${n >= 1500 ? '+' : ''} source files — expect a slow run to Gate 1`,
          'scope it per bolt: set scope.source_paths in intake.yml, or run pw-aidlc context --depth deep --paths "src/<area>/**"');
      } else {
        info(`${n} source file(s) — deep grounding is affordable at this size`);
      }
    } else {
      info('source will not be read; planning is live-app-only and discrepancy detection is disabled');
    }

    if (get(cfg, 'source.frontend_only')) {
      info('front-end only — server-side rules are invisible; add an OpenAPI contract to inputs/contracts/ to recover most of that');
    }
  }

  // --- running app ----------------------------------------------------
  head('Application');
  // Playwright and clc.ts follow BASE_URL from .env.local when it is set, so that
  // is the host worth checking. Before this, a bolt pointed at UAT by BASE_URL
  // had doctor keep reporting on QA (bolt US-CLC-MISSINGCREWNAME-001, 2026-09-24).
  const cfgUrl = get(cfg, 'app.url');
  const envFile = join(root, '.env.local');
  const baseUrl = existsSync(envFile)
    ? (readFileSync(envFile, 'utf8').match(/^\s*(?:export\s+)?BASE_URL\s*=\s*["']?([^"'\r\n#]+?)["']?\s*(?:#.*)?$/m) || [])[1]
    : undefined;
  const norm = (u) => (u || '').trim().replace(/\/+$/, '').toLowerCase();
  if (baseUrl && cfgUrl && norm(baseUrl) !== norm(cfgUrl)) {
    soft(
      `BASE_URL in .env.local (${baseUrl}) overrides app.url (${cfgUrl}) — tests run against BASE_URL`,
      'fine if deliberate (e.g. a UAT bolt); otherwise align the two so reports and tests name the same environment',
    );
  }
  const url = baseUrl || cfgUrl;
  if (mode === 'greenfield') {
    ok('greenfield mode — a running app is not required yet');
  } else if (!url) {
    fail('app.url not set', 'set app.url in e2e.config.yml');
  } else {
    const { status, tlsError } = await reachable(url);
    if (status === null && tlsError) {
      soft(
        `${url} TLS verification failed - likely a corporate CA Node does not trust by default`,
        `playwright.config.ts already sets ignoreHTTPSErrors for this reason; verify manually (open the URL in a browser) before treating this as a real blocker`,
      );
    } else if (status === null) fail(`${url} unreachable`, 'start the app, or update app.url');
    else if (status >= 500) fail(`${url} returned ${status}`);
    else ok(`${url} → ${status}`);
  }

  // A frontend can be reachable while a specific backend it depends on is
  // down — the frontend check above says nothing about that. Caught the hard
  // way once: a backend outage was only discovered 30+ minutes into a live
  // bolt, via a save that silently failed. Declare the endpoints a story's
  // flow actually depends on in app.health_checks and this catches an outage
  // already in progress at doctor-run time — it cannot catch one that starts
  // mid-session, so treat a pass here as "healthy right now," not a guarantee.
  const healthChecks = get(cfg, 'app.health_checks');
  if (Array.isArray(healthChecks) && healthChecks.length) {
    for (const endpoint of healthChecks) {
      const { status, tlsError } = await reachable(endpoint);
      if (status === null && tlsError) {
        soft(`${endpoint} TLS verification failed - likely a corporate CA Node does not trust by default`);
      } else if (status === null) fail(`${endpoint} unreachable`);
      else if (status >= 500) fail(`${endpoint} returned ${status}`, 'confirm with whoever owns this backend before starting a bolt that depends on it');
      else ok(`${endpoint} → ${status}`);
    }
  }

  // --- session persistence ---------------------------------------------
  // A saved storageState can look valid — file present, token unexpired —
  // and still die seconds into a restored session, because some auth
  // providers run a background session/SSO check that a copied token does
  // not satisfy. Caught the hard way once: 8 of 8 generated tests failed
  // before anyone suspected the saved session itself, rather than the specs.
  // This is a heuristic, not a certainty: it looks for common sign-in wording
  // after a restore and a wait, so an unusual login screen can produce a
  // false pass. Only runs when storage_state auth is actually configured.
  head('Session persistence');
  const authStrategy = get(cfg, 'app.auth.strategy');
  const stateFile = get(cfg, 'app.auth.storage_state', '.auth/user.json');
  if (authStrategy !== 'storage_state') {
    info(`app.auth.strategy is "${authStrategy || 'unset'}" — this check only applies to storage_state`);
  } else if (!existsSync(join(root, stateFile))) {
    soft(`${stateFile} not found — run the seed test first so this check has something to restore`);
  } else if (mode === 'greenfield') {
    info('session-persistence check not run (greenfield — no running app yet)');
  } else if (args.run === false) {
    info('session-persistence check not run (--no-run)');
  } else if (!url) {
    info('session-persistence check not run (app.url not set)');
  } else {
    const waitMs = 15_000; // observed failure in the wild happened at ~6s; generous margin
    const specPath = join(root, 'tests/.aidlc-preflight-session.spec.ts');
    const spec = `import { test, expect } from '@playwright/test';
test.use({ storageState: ${JSON.stringify(stateFile)} });
// Generous fixed timeout, independent of the host project's own default —
// the wait below is already close to a common 30s default on its own, and a
// project whose own timeout is still short (a real failure mode seen once
// already, elsewhere in this kit) must not make this check cry wolf.
test.setTimeout(90_000);
test('saved session survives a wait', async ({ page }) => {
  await page.goto(${JSON.stringify(url)});
  await page.waitForTimeout(${waitMs});
  await page.reload();
  // A password input is a strong, specific signal of a sign-in form. Plain
  // body-text words like "password" are not — a "change your password" link
  // on an authenticated settings page would false-positive on wording alone.
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  const heading = (await page.locator('h1, h2').first().innerText().catch(() => '')).toLowerCase();
  const looksSignedOut = hasPasswordField || /sign in|log in/.test(heading);
  expect(looksSignedOut, 'page looks like a sign-in screen after the wait — the saved session did not survive the restore').toBe(false);
});
`;
    writeFileSync(specPath, spec, 'utf8');
    try {
      execSync(`npx playwright test ${JSON.stringify(specPath)} --reporter=line`, { cwd: root, stdio: 'pipe' });
      ok(`saved session still authenticated after ${Math.round(waitMs / 1000)}s`);
    } catch {
      fail(`saved session looks signed-out after ${Math.round(waitMs / 1000)}s — storage_state may not survive against this app's auth provider`,
        'check for a background SSO/session check invalidating a restored session; per-test sign-in may be needed until this is fixed');
    } finally {
      try { unlinkSync(specPath); } catch { /* best effort */ }
    }
  }

  // --- repository ---------------------------------------------------------
  // Discovered the hard way: a bolt can run all the way through Gate 2 in a
  // checkout with no git remote, no git identity and no `gh` CLI, and Gate 3
  // silently becomes N/A — nothing ships anywhere a second reviewer can see
  // it without manually retrieving the working tree. Surfacing this before a
  // bolt starts costs nothing; discovering it at Ship costs the whole bolt's
  // visibility.
  head('Repository');
  const isRepo = sh('git rev-parse --is-inside-work-tree') === 'true';
  if (!isRepo) {
    soft('not a git repository — Gate 3 (PR review) will be N/A; the bolt can still run and stay local');
  } else {
    const remote = sh('git remote get-url origin');
    remote ? ok(`remote configured: ${remote}`) : soft('no git remote configured — e2e-ship cannot open a PR', 'git remote add origin <url>');

    const uName = sh('git config user.name');
    const uEmail = sh('git config user.email');
    (uName && uEmail) ? ok('git identity configured') : soft('git user.name / user.email not set — commits cannot be made', 'git config user.name "..." && git config user.email "..."');

    const gh = sh('gh --version');
    gh ? ok('gh CLI available') : soft('gh CLI not found — e2e-ship cannot open a PR automatically', 'install the GitHub CLI: https://cli.github.com');
  }

  // --- seed test ------------------------------------------------------
  head('Seed test');
  const seed = join(root, 'tests/seed.spec.ts');
  if (!existsSync(seed)) {
    fail('tests/seed.spec.ts missing', 'npx pw-aidlc init --yes');
  } else if (looksLikeUnfilledSeed(readFileSync(seed, 'utf8'))) {
    // Blocking, not a warning: intake's own validation table requires "seed
    // test exists and passes" as a precondition, not a nice-to-have. A stub
    // left in place would pass vacuously - proving nothing - which makes
    // that gate meaningless rather than merely weak. Confirmed as a real
    // gap, not theoretical (GHC run-11): the shipped stub still contained
    // `// generate code here.` and had to be written before Gate 1 could
    // mean anything, something a soft warning never forced to happen.
    fail(
      'tests/seed.spec.ts is still a stub (still the template, or has no process.env reference anywhere in it)',
      'write a real credential smoke check before running any bolt - an unfilled seed test passing proves nothing',
    );
  } else if (!existsSync(join(root, 'node_modules'))) {
    // Distinct from the "seed test FAILS" case below on purpose. Confirmed as
    // a real, wasted diagnosis, not theoretical (bolt US-CLC-001, "CLC_21_09"
    // run, 2026-09-21): a fresh workspace's missing node_modules surfaced as
    // a generic failing-seed-test report, costing several minutes to work out
    // that nothing about the seed itself was wrong — dependencies had simply
    // never been installed. Checked before ever attempting to run the seed,
    // so this workspace's actual problem is named directly instead of
    // discovered by process of elimination.
    fail('dependencies not installed (node_modules missing) — the seed test has not been run yet', 'npm install');
  } else if (args.run !== false && mode !== 'greenfield') {
    info('running seed test...');
    try {
      execSync('npx playwright test tests/seed.spec.ts --reporter=line', { cwd: root, stdio: 'pipe' });
      ok('seed test passes');
    } catch {
      fail('seed test FAILS — fix this before any bolt; downstream failures will all be noise', 'npx playwright test tests/seed.spec.ts --headed');
    }
  } else {
    info('seed test not run (--no-run or greenfield)');
  }

  return summary();
}

function summary() {
  console.log();
  if (failures) {
    console.log(c.red(c.bold(`  ${failures} blocking issue(s)`)) + (warnings ? c.yellow(`, ${warnings} warning(s)`) : ''));
    console.log(c.dim('  Fix the blocking issues before running a bolt.\n'));
    process.exitCode = 1;
  } else if (warnings) {
    console.log(c.yellow(c.bold(`  Ready, with ${warnings} warning(s).`)));
    console.log(c.dim('  Run: /bolt <STORY-ID> in Claude Code\n'));
  } else {
    console.log(c.green(c.bold('  All checks passed.')));
    console.log(c.dim('  Run: /bolt <STORY-ID> in Claude Code\n'));
  }
}
