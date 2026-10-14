/**
 * impact.mjs — what a code change touches, and what it left uncovered.
 *
 * Regression asks a different question from authoring. Authoring asks "how
 * deeply do we read the code"; regression asks "what changed, and what does
 * that break or leave untested". This answers the second one.
 *
 * It works off the `// covers:` header the generator writes into each spec.
 * Specs produced before that header existed have no provenance, so they are
 * reported separately rather than silently counted as unaffected — an unknown
 * is not a pass.
 *
 *   pw-aidlc impact --since main
 *   pw-aidlc impact --since v2.3.0
 *   pw-aidlc impact                  # defaults to the commit app-context was built at
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { c, ok, warn, info, head, write, loadConfig, get } from './util.mjs';

const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'out', 'test-results', 'playwright-report']);

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

function walkSpecs(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkSpecs(full, acc);
    else if (/\.spec\.(ts|js|tsx|jsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Pull the traceability header the generator writes at the top of each spec. */
function readSpecHeader(file) {
  let head4k;
  try { head4k = readFileSync(file, 'utf8').slice(0, 4000); } catch { return null; }
  const field = (name) => {
    const m = new RegExp(`^//\\s*${name}:\\s*(.+)$`, 'm').exec(head4k);
    return m ? m[1].trim() : '';
  };
  const list = (name) => field(name).split(',').map((s) => s.trim()).filter(Boolean);
  return {
    file: norm(relative(process.cwd(), file)),
    bolt: field('bolt'),
    covers: list('covers').map(norm),
    routes: list('routes'),
    appCommit: field('app-commit'),
  };
}

function gitLines(cmd, cwd = process.cwd()) {
  try {
    return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/** Repository root containing `dir`, or '' if it is not in a git work tree. */
function gitTop(dir) {
  if (!existsSync(dir)) return '';
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return '';
  }
}

/** The commit app-context.md was generated at — a sensible default baseline. */
function contextCommit(contextFile) {
  if (!existsSync(contextFile)) return '';
  try {
    return /^commit:\s*(\S+)/m.exec(readFileSync(contextFile, 'utf8').slice(0, 2000))?.[1] ?? '';
  } catch {
    return '';
  }
}

export async function impact(args = {}) {
  const root = process.cwd();
  const cfg = loadConfig();
  const testsDir = join(root, get(cfg, 'paths.tests', 'tests/e2e'));
  const contextFile = join(root, get(cfg, 'paths.context', 'context/app-context.md'));
  const srcPath = norm(String(get(cfg, 'source.path', '') || '').trim());

  head('Change impact');

  // The diff has to run in the repo that holds the application source, which is
  // not always the repo holding the tests — source.path may point at a sibling
  // checkout. Diffing the test repo in that case finds nothing and reports a
  // clean bill of health, which is the worst possible way to be wrong.
  const srcAbs = srcPath ? resolve(root, srcPath) : root;
  const srcRepo = gitTop(srcAbs);
  const hereRepo = gitTop(root);
  const separateRepo = !!srcRepo && !!hereRepo && srcRepo !== hereRepo;
  const diffCwd = separateRepo ? srcRepo : root;

  if (separateRepo) {
    info(`source lives in a separate repository — diffing ${norm(srcRepo)}`);
  } else if (srcPath && !srcRepo) {
    warn(`source.path "${srcPath}" is not inside a git repository — cannot diff it`);
    process.exitCode = 1;
    return;
  }

  let since = String(args.since || '').trim();
  if (!since) {
    since = contextCommit(contextFile);
    if (since) info(`no --since given; using the commit app-context.md was built at (${since})`);
  }
  if (!since) {
    since = 'HEAD~1';
    info('no --since and no recorded context commit; defaulting to HEAD~1');
  }

  const changed = gitLines(`git diff --name-only ${since}...HEAD`, diffCwd);
  if (changed === null) {
    warn(`could not diff against "${since}" — is it a valid git ref in ${norm(diffCwd)}?`);
    console.log(`\n  Try: ${c.bold('pw-aidlc impact --since main')}`);
    if (separateRepo) {
      console.log(`  Note: refs are resolved in the ${c.bold('source')} repository, not the test repository.\n`);
    } else {
      console.log('');
    }
    process.exitCode = 1;
    return;
  }
  if (!changed.length) {
    ok(`no files changed since ${since} — nothing to analyse`);
    return;
  }

  // git returns paths relative to the repo it diffed. Re-express them relative
  // to where we are standing, so they line up with the covers: headers.
  const changedNorm = separateRepo
    ? changed.map((f) => norm(relative(root, join(srcRepo, f))))
    : changed.map(norm);
  const changedSource = srcPath
    ? changedNorm.filter((f) => f.startsWith(`${srcPath}/`) || f === srcPath)
    : changedNorm;

  ok(`${changed.length} file(s) changed since ${since}${srcPath ? ` — ${changedSource.length} under ${srcPath}/` : ''}`);

  const specs = walkSpecs(testsDir).map(readSpecHeader).filter(Boolean);
  if (!specs.length) {
    warn(`no spec files found under ${norm(relative(root, testsDir))}`);
    return;
  }

  const withProvenance = specs.filter((s) => s.covers.length);
  const withoutProvenance = specs.filter((s) => !s.covers.length);

  // A spec is impacted when any file it declares coverage of changed. Prefix
  // matching so a spec may name a directory as well as a file.
  const impacted = [];
  const coveredFiles = new Set();
  for (const spec of withProvenance) {
    const hits = changedSource.filter((f) => spec.covers.some((cv) => f === cv || f.startsWith(`${cv}/`)));
    for (const cv of spec.covers) {
      for (const f of changedSource) if (f === cv || f.startsWith(`${cv}/`)) coveredFiles.add(f);
    }
    if (hits.length) impacted.push({ ...spec, hits });
  }

  const uncovered = changedSource.filter((f) => !coveredFiles.has(f));
  const unaffected = withProvenance.filter((s) => !impacted.some((i) => i.file === s.file));

  // ---- report ----
  if (impacted.length) {
    warn(`${impacted.length} spec(s) cover code that changed — run these first`);
    for (const i of impacted) info(`${i.file}  ←  ${i.hits.slice(0, 3).join(', ')}${i.hits.length > 3 ? ` +${i.hits.length - 3}` : ''}`);
  } else {
    ok('no existing spec declares coverage of the changed files');
  }

  if (uncovered.length) {
    warn(`${uncovered.length} changed file(s) have no covering spec — this is the regression gap`);
    for (const f of uncovered.slice(0, 15)) info(f);
    if (uncovered.length > 15) info(`… and ${uncovered.length - 15} more`);
  }

  if (withoutProvenance.length) {
    warn(`${withoutProvenance.length} spec(s) carry no "covers:" header — impact for these is unknown, not clear`);
    info('specs generated before coverage provenance existed; regenerate or add the header by hand');
  }

  const outFile = join(root, get(cfg, 'paths.results', 'results'), 'impact.md');
  const md = `# Change impact — since \`${since}\`

_Generated ${new Date().toISOString()} by \`pw-aidlc impact\`._

Files changed: **${changed.length}**${srcPath ? ` (${changedSource.length} under \`${srcPath}/\`)` : ''}

## Run these first — ${impacted.length} spec(s) cover changed code

${impacted.length
    ? `| Spec | Bolt | Changed files it covers |\n|---|---|---|\n${impacted.map((i) => `| \`${i.file}\` | ${i.bolt || '—'} | ${i.hits.map((h) => `\`${h}\``).join('<br>')} |`).join('\n')}`
    : '_None. Either the change is outside tested surfaces, or coverage provenance is missing._'}

## Regression gap — ${uncovered.length} changed file(s) with no covering spec

${uncovered.length
    ? `These are the candidates for new scenarios. Scope a bolt to them:\n\n\`\`\`\npw-aidlc context --depth deep --paths "${uncovered.slice(0, 3).map((f) => f.split('/').slice(0, -1).join('/')).filter((v, i, a) => a.indexOf(v) === i).join(',')}"\n\`\`\`\n\n${uncovered.map((f) => `- \`${f}\``).join('\n')}`
    : '_None — every changed file is claimed by at least one spec._'}

## Unknown impact — ${withoutProvenance.length} spec(s) without a \`covers:\` header

${withoutProvenance.length
    ? `Impact cannot be computed for these. Treat as **unknown**, not unaffected.\n\n${withoutProvenance.map((s) => `- \`${s.file}\``).join('\n')}`
    : '_None — every spec declares what it covers._'}

## Unaffected — ${unaffected.length} spec(s)

${unaffected.length ? unaffected.map((s) => `- \`${s.file}\``).join('\n') : '_None._'}

---

**How to read this.** A spec listed as impacted covers code that moved; it may
still pass, and passing is the point. A file in the regression gap is change
that no test claims — that is where new scenarios come from. Coverage
provenance is a declaration made at generation time, not proof the assertions
are meaningful; only Gate 2 review establishes that.
`;

  write(outFile, md, { force: true, quiet: true });
  console.log(`\n  ${c.green('✓')} ${norm(relative(root, outFile))} — ${impacted.length} impacted, ${uncovered.length} uncovered, ${withoutProvenance.length} unknown\n`);
}
