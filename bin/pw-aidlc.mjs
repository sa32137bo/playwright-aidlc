#!/usr/bin/env node
import { parseArgs, c, loadConfig, get } from '../lib/util.mjs';

const HELP = `
${c.bold('pw-aidlc')} — Playwright AI-DLC kit

${c.bold('Setup (once per project)')}
  init [name]        Scaffold folders, config, knowledge base and Claude Code skills
  doctor             Preflight: toolchain, agents, secrets, inputs, app, seed test

${c.bold('During work')}
  ingest             Convert .docx / .pdf inputs to Markdown (no model, no tokens)
  testcases          Export test cases to Excel/CSV, or import an edited sheet
  context            Rebuild the code-side grounding from application source
  results            Run the suite and write results/summary.md
  matrix             Regenerate docs/traceability-matrix.md (release visibility)
  impact             Which tests a code change touches, and what it left uncovered
  story-diff         Which acceptance criteria moved since a bolt was approved
  rebind --bolt <ID> Preflight for binding a greenfield bolt to a live app

${c.bold('In Claude Code')}
  /bolt <ID>         Run one full bolt: context → plan → [gate] → generate → heal → PR
  /rebind <ID>       Bind a greenfield bolt's @pending specs to the live app
  /testcases <ID>    Write manual test cases from the story (+ requirements, if any)
  /revise <ID>       The story changed — update the specs it made stale
  /heal [test]       Classify and repair failures
  /matrix            Regenerate the traceability matrix
  /results           Run the suite and summarise

${c.bold('Common flags')}
  --mode <m>         greenfield | brownfield | characterization
  --type <t>         webapp | api
  --url <url>        URL of the running application
  --src <path>       Path to application source (may be a sibling checkout)
  --jira <url>       Jira base URL (omit to use manual story files)
  --yes              Non-interactive, use defaults (for CI and scripted setup)
  --force            Overwrite existing config files
  --no-run           doctor/results: skip actually running Playwright
  --grep <tag>       results: filter, e.g. @smoke
  --bolt <ID>        results: only this bolt's tests
  --dir <path>       ingest: one folder instead of every inputs/ folder
  --file <path>      ingest: a single document
  --export <ID>      testcases: write test-cases/<ID>.xlsx and/or .csv
  --import <path>    testcases: read an edited sheet back, with a diff
  --format <f>       testcases: xlsx | csv | both (default both)
  --stamp <ID>       testcases: record the documents these cases were written from
  --check <ID>       testcases: have those documents changed since?
  --depth <d>        context: off | scan | deep (default from source.grounding)
  --paths <glob>     context: narrow the scan, e.g. "src/checkout/**"
  --if-stale         context: skip the rescan when the source has not changed
  --max-files <n>    context: cap the scan (default 1500)
  --since <ref>      impact: git ref to diff against, e.g. main or a release tag
  --story <path>     story-diff: a story file that is not named <ID>.md
  --snapshot         story-diff: (re)set the approved baseline, diff nothing

${c.bold('Examples')}
  npx pw-aidlc init CLC --mode brownfield --url https://crewhub-qa.taconnections.com/ --src src
  npx pw-aidlc init Legacy --mode characterization --url https://staging.acme.io --yes
  npx pw-aidlc ingest
  npx pw-aidlc doctor
  npx pw-aidlc results --grep @smoke
  npx pw-aidlc story-diff CHK-42

Walkthroughs for each mode: RUNBOOK.md
`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

try {
  switch (cmd) {
    case 'init': {
      const { init } = await import('../lib/init.mjs');
      await init(args);
      break;
    }
    case 'doctor': {
      const { doctor } = await import('../lib/doctor.mjs');
      await doctor({ ...args, run: args['no-run'] ? false : true });
      break;
    }
    case 'context': {
      const { buildContext } = await import('../lib/context.mjs');
      const { resolveGrounding } = await import('../lib/util.mjs');
      const cfg = loadConfig();
      const g = resolveGrounding({ cfg, flag: args.depth || args.grounding || '' });
      if (g.depth === 'off') {
        console.log(`\n  ${c.yellow('!')} grounding is off — ${g.reason}. Nothing to scan.\n`);
        break;
      }
      const src = args.src || g.sourcePath || 'src';
      const outFile = args.out || get(cfg, 'paths.context', 'context/app-context.md');
      const r = buildContext({
        src,
        outFile,
        paths: args.paths || '',
        depth: g.depth,
        ifStale: !!args['if-stale'],
        maxFiles: Number(args['max-files']) || 1500,
      });
      if (r.skipped) {
        console.log(`\n  ${c.green('✓')} ${r.out} is current (source unchanged) — skipped in ${r.ms} ms\n`);
        break;
      }
      console.log(`\n  ${c.green('✓')} ${r.out} — ${r.files} files, ${r.routes} routes, ${r.testids} test ids, ${r.ms} ms (${g.depth})\n`);
      break;
    }
    case 'ingest': {
      const { ingest } = await import('../lib/ingest.mjs');
      await ingest(args);
      break;
    }
    case 'impact': {
      const { impact } = await import('../lib/impact.mjs');
      await impact(args);
      break;
    }
    case 'story-diff': {
      const { storyDiff } = await import('../lib/storydiff.mjs');
      await storyDiff(args);
      break;
    }
    case 'rebind': {
      const { rebind } = await import('../lib/rebind.mjs');
      await rebind(args);
      break;
    }
    case 'testcases': {
      const { testcases } = await import('../lib/testcases.mjs');
      await testcases(args);
      break;
    }
    case 'results': {
      const { results } = await import('../lib/report.mjs');
      await results({ ...args, run: args['no-run'] ? false : true });
      break;
    }
    case 'matrix': {
      const { matrix } = await import('../lib/report.mjs');
      await matrix(args);
      break;
    }
    case 'help':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`\n  ${c.red('✗')} ${err.message}\n`);
  process.exitCode = 1;
}
