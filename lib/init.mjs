import { existsSync, readFileSync, readdirSync, cpSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, ok, warn, info, head, write, ensureDir, ensureGitignore, prompt } from './util.mjs';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = (p) => readFileSync(join(KIT, 'templates', p), 'utf8');

const MODES = ['greenfield', 'brownfield', 'characterization'];
const TYPES = ['webapp', 'api'];

export async function init(args) {
  const root = resolve(args.root || process.cwd());
  const interactive = !args.yes && process.stdin.isTTY;

  console.log(c.bold('\nPlaywright AI-DLC — project setup\n'));

  let name = args._[1] || args.name;
  let mode = args.mode;
  let type = args.type || 'webapp';
  let appUrl = args.url;
  let srcPath = args.src;
  let jira = args.jira;

  if (interactive) {
    name ||= await prompt('Project name', { default: 'my-app' });
    console.log(`
  ${c.bold('greenfield')}       stories exist, app does not yet. Tests are written first
                   and are expected to fail until the feature ships.
  ${c.bold('brownfield')}       stories AND a running app. Both are cross-checked and
                   disagreements are reported. The highest-value mode.
  ${c.bold('characterization')} a running app, no usable requirements. Tests describe
                   current behaviour. Nothing is called a bug.
`);
    mode ||= await prompt('Mode', { choices: MODES, default: 'brownfield' });
    type ||= await prompt('Application type', { choices: TYPES, default: 'webapp' });
    if (mode !== 'greenfield') {
      appUrl ||= await prompt('URL of the running app', { default: 'http://localhost:3000' });
    }
    srcPath ||= await prompt('Path to application source (blank if unavailable)', { default: 'src' });
    jira ||= await prompt('Jira base URL (blank to use manual story files)', { default: '' });
  }

  const str = (v) => (typeof v === 'string' ? v : '');
  name = str(name) || 'my-app';
  srcPath = str(srcPath);
  appUrl = str(appUrl);
  jira = str(jira);
  mode ||= 'brownfield';
  appUrl ||= mode === 'greenfield' ? '' : 'http://localhost:3000';
  jira ||= '';

  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);
  if (!TYPES.includes(type)) throw new Error(`type must be one of: ${TYPES.join(', ')}`);
  if (type === 'api' && mode === 'characterization') {
    warn('characterization mode on an API profile is untested — expect rough edges.');
  }

  // ---------------------------------------------------------------------
  // 1. .gitignore FIRST. Nothing else gets created until secrets are safe.
  // ---------------------------------------------------------------------
  head('Protecting secrets');
  const n = ensureGitignore(root, [
    '.env.local', '.env.*.local', '.auth/', 'storageState*.json',
    // node_modules/ is not covered here on the assumption that `npm init
    // playwright` already added it before this runs — true for the kit's
    // own documented flow, not true for a scaffolder that calls `init`
    // directly. Listed explicitly so it holds either way.
    'node_modules/',
    // `results/` (bare) excludes the whole directory, so git never
    // descends into it to notice the negation below — a real bolt run
    // caught exactly this: results/summary.md silently never staged.
    // `results/*` excludes every entry but still lets git look inside.
    'results/*', 'test-results/', 'playwright-report/', 'blob-report/',
    '!results/summary.md', '!results/.gitkeep', '!results/*.result.json',
    // Same bare-directory bug, found in this kit's own root .gitignore:
    // a bare `.vscode/` stops git descending into it, so a negation for
    // mcp.json (a real, shared MCP registration, not personal editor
    // config) could never take effect. `.vscode/*` still lets git look.
    '.vscode/*', '!.vscode/mcp.json',
  ]);
  ok(n ? `.gitignore — added ${n} entries` : '.gitignore already covers secrets and results');

  // ---------------------------------------------------------------------
  // 2. Folder structure — only what this profile needs.
  // ---------------------------------------------------------------------
  head('Creating structure');
  const dirs = [
    'inputs/stories', 'inputs/requirements', 'inputs/contracts', 'knowledge/org', 'knowledge/project',
    'bolts', 'context', 'docs', 'results', 'data', 'test-cases',
    type === 'webapp' ? 'tests/e2e' : 'tests/api',
  ];
  for (const d of dirs) {
    ensureDir(join(root, d));
    write(join(root, d, '.gitkeep'), '', { quiet: true });
  }
  ok(`${dirs.length} directories under ${root}`);

  // ---------------------------------------------------------------------
  // 3. Config + env
  // ---------------------------------------------------------------------
  head('Configuration');
  const config = tpl('e2e.config.yml')
    .replaceAll('{{PROJECT}}', name)
    .replaceAll('{{MODE}}', mode)
    .replaceAll('{{TYPE}}', type)
    .replaceAll('{{APP_URL}}', appUrl)
    .replaceAll('{{SRC}}', srcPath || '')
    .replaceAll('{{JIRA}}', jira)
    .replaceAll('{{TESTS_DIR}}', type === 'webapp' ? 'tests/e2e' : 'tests/api')
    .replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10));
  write(join(root, 'e2e.config.yml'), config, { force: args.force });

  write(join(root, '.env.local.example'), tpl('env.local.example'), { force: args.force });
  if (!existsSync(join(root, '.env.local'))) {
    write(join(root, '.env.local'), tpl('env.local.example'), { quiet: true });
    ok('.env.local (gitignored — fill in credentials here, never in e2e.config.yml)');
  } else {
    info('.env.local exists, left alone');
  }

  // ---------------------------------------------------------------------
  // 4. Knowledge — org baseline copied in, project deltas left empty
  // ---------------------------------------------------------------------
  head('Knowledge base');
  const orgDir = join(KIT, 'templates', 'knowledge', 'org');
  for (const f of readdirSync(orgDir)) {
    write(join(root, 'knowledge/org', f), readFileSync(join(orgDir, f), 'utf8'), { force: args.force });
  }
  write(join(root, 'knowledge/project/README.md'), tpl('project-knowledge.md'), { force: args.force });

  // ---------------------------------------------------------------------
  // 5. Skills, commands, agent instructions
  // ---------------------------------------------------------------------
  head('IDE integration (Claude Code + Copilot)');
  cpSync(join(KIT, 'skills'), join(root, '.claude/skills'), { recursive: true, force: true });
  ok(`.claude/skills/ — ${readdirSync(join(KIT, 'skills')).length} skills`);
  cpSync(join(KIT, 'commands'), join(root, '.claude/commands'), { recursive: true, force: true });
  ok(`.claude/commands/ — ${readdirSync(join(KIT, 'commands')).map((f) => '/' + f.replace(/\.md$/, '')).join(' ')}`);

  const claudeMd = join(root, 'CLAUDE.md');
  const MARK = '<!-- playwright-aidlc-kit -->';
  const section = tpl('CLAUDE.section.md').replaceAll('{{MODE}}', mode).replaceAll('{{TESTS_DIR}}', type === 'webapp' ? 'tests/e2e' : 'tests/api');
  if (existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes(MARK)) {
    info('CLAUDE.md already contains the kit section');
  } else {
    const prev = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : '';
    write(claudeMd, `${prev}${prev ? '\n\n' : ''}${section}`, { force: true, quiet: true });
    ok('CLAUDE.md — appended kit section');
  }

  // Copilot doesn't auto-load CLAUDE.md or .claude/skills the way Claude Code
  // does — this is a short pointer to them, not a second copy of the rules,
  // so the two never drift against each other.
  write(join(root, '.github/copilot-instructions.md'), tpl('copilot-instructions.md'), { force: args.force });
  ok('.github/copilot-instructions.md — points Copilot at CLAUDE.md and .claude/skills');

  // ---------------------------------------------------------------------
  // 6. Seed test + CI
  // ---------------------------------------------------------------------
  head('Test scaffolding');
  const testsDir = type === 'webapp' ? 'tests/e2e' : 'tests/api';
  write(join(root, 'tests/seed.spec.ts'), tpl(type === 'webapp' ? 'seed.spec.ts' : 'seed.api.spec.ts'), { force: args.force });
  write(join(root, 'data/README.md'), tpl('data-readme.md'), { force: args.force });

  // The test-case workbook is a team asset, not a kit asset — QA teams restyle
  // it. A project copy is what `testcases --export` prefers, so editing this one
  // changes what their testers receive without touching the kit.
  const tcTemplate = join(root, 'test-cases/_template.xlsx');
  if (!existsSync(tcTemplate) || args.force) {
    cpSync(join(KIT, 'templates', 'test-case-template.xlsx'), tcTemplate);
    ok('test-cases/_template.xlsx — edit this to restyle what testers receive');
  }
  write(join(root, '.github/workflows/e2e.yml'), tpl('workflows/e2e.yml').replaceAll('{{TESTS_DIR}}', testsDir), { force: args.force });
  write(join(root, 'bolts/_template.intake.yml'), tpl('intake.yml').replaceAll('{{MODE}}', mode), { force: args.force });

  // ---------------------------------------------------------------------
  // 7. Next steps — literal commands, in order
  // ---------------------------------------------------------------------
  const storyStep = jira
    ? `  2. Nothing to do — stories come from Jira (${jira}).`
    : `  2. Drop a story into ${c.bold('inputs/stories/')} as Markdown (see examples/sample-inputs/).`;

  console.log(`
${c.green(c.bold('Done.'))} ${name} is set up in ${c.bold(mode)} mode (${type}).

${c.bold('Next, in order:')}
  1. Put credentials in ${c.bold('.env.local')} — never in e2e.config.yml.
${storyStep}
  3. Make ${c.bold('tests/seed.spec.ts')} reach a usable app state, then:
       ${c.blue('npx playwright test tests/seed.spec.ts')}
  4. Check everything is wired up:
       ${c.blue('npx pw-aidlc doctor')}
  5. In Claude Code or GitHub Copilot:
       ${c.blue('/bolt <STORY-ID>')}

${c.dim('Gate 1 is a hard stop. Read the plan before approving it.')}
${c.dim('Mode walkthroughs: RUNBOOK.md')}
`);
}
