# Installation

Reference for the setup steps. **If you are setting this up for the first time,
use [`GETTING-STARTED.md`](GETTING-STARTED.md) instead** — same ground, but as an
ordered walkthrough with expected output at each step and a one-command path for
later projects.

Takes about 15 minutes, most of it writing the seed test.

## Prerequisites

| | |
|---|---|
| Node | 18 or later |
| Playwright | **1.56+** — the official test agents ship in 1.56 |
| Claude Code | any recent version |
| A running app | not needed for `greenfield` mode |

## 1. Get the kit

```bash
# Option A — from the packaged tarball
npm i -g ./pw-aidlc-kit-2.0.0.tgz

# Option B — from a checkout, no global install
git clone <your-internal-repo>/playwright-aidlc-kit
node /path/to/playwright-aidlc-kit/bin/pw-aidlc.mjs help
```

If you skip the global install, replace `npx pw-aidlc` with
`node /path/to/playwright-aidlc-kit/bin/pw-aidlc.mjs` throughout.

## 2. Playwright and the official agents

```bash
cd /path/to/your/app-repo
npm init playwright@latest                  # skip if already set up
npx playwright init-agents --loop=claude
```

The second command installs Microsoft's planner, generator and healer agents into
`.claude/agents/`. This kit delegates to them rather than reimplementing them —
without this step the bolt cannot run.

## 3. Scaffold

```bash
npx pw-aidlc init CLC --mode brownfield --url https://crewhub-qa.taconnections.com/ --src src
```

Or run `npx pw-aidlc init` with no flags for an interactive walkthrough.

### What it creates

```
e2e.config.yml          single config — mode, paths, governance. Committed.
.env.local              credentials. Gitignored, created first.
inputs/stories/         story files (manual, or cached from Jira)
inputs/requirements/    BRDs, PRDs
knowledge/org/          locator policy, assertion catalog, checklist, glossary
knowledge/project/      this app's deltas only
bolts/                  one folder per bolt: intake, plan, audit, manifest,
                        and story.snapshot.md — the story version Gate 1 approved
context/                code-side grounding
tests/e2e/              generated specs (tests/api/ for the API profile)
data/                   test-data seeding and fixtures
docs/                   traceability matrix and generated docs
test-cases/             manual test cases, plus the Excel template testers edit
results/                run output. Gitignored except summary.md
.claude/skills/         11 skills
.claude/commands/       /bolt /testcases /revise /rebind /heal /matrix /results
.github/workflows/      deterministic CI + structural lint
CLAUDE.md               ~30 lines appended — the always-on rules
```

`init` is idempotent. It never overwrites an existing config without `--force`,
and it writes `.gitignore` before anything else so credentials cannot leak.

## 4. Fill in the three things only you know

**Credentials** in `.env.local`. `e2e.config.yml` references them by name
(`user_env: E2E_USER`), never by value. Prefer `storageState` auth: sign in once
in the seed test, persist the session, and no test ever handles a password.

**A story** — either set `inputs.jira.base_url` in `e2e.config.yml` (fetched via
the Atlassian MCP connector in Claude Code and cached locally), or drop a
Markdown file in `inputs/stories/`. To try it right away:

```bash
cp examples/sample-inputs/CHK-42.md       inputs/stories/
cp examples/sample-inputs/BRD-checkout.md inputs/requirements/
```

Real requirements usually arrive as Word or PDF. **No skill can read either**, so
convert them once:

```bash
npx pw-aidlc ingest
```

Deterministic, no model involved, no tokens. It writes a `.md` beside each
document, extracts embedded images to `<document>.media/`, and reports what it
found. `doctor` fails soft on any `.docx` or `.pdf` with no `.md` beside it,
because an unconverted document contributes nothing and does so silently.

**Test cases, if there is no app yet.** `/testcases <ID>` in Claude Code writes
reviewable manual cases from the story — no application, no source, no
credentials, and no requirement documents needed. A BRD in `inputs/requirements/`
sharpens the cases when you have one, but an empty directory is a normal project.
Then:

```bash
npx pw-aidlc testcases --export <ID> --format both
```

You get Markdown in the repo, a filled copy of your team's Excel template, and a
CSV for a test-management tool. Export also stamps the file with the content
hashes of its source documents, so `doctor` can later report that the story moved
on and the cases did not.

**The seed test** — `tests/seed.spec.ts`. Make it sign in and reach a usable
state. Every generated test inherits its shape, so a lazy seed test degrades
everything downstream. This is the part worth ten minutes.

```bash
npx playwright test tests/seed.spec.ts     # must pass
```

## 5. Verify

```bash
npx pw-aidlc doctor
```

Checks toolchain, agent definitions, kit installation, **secrets not tracked by
git**, inputs, source path, app reachability, and runs the seed test. Every
failure comes with the exact command to fix it.

Then confirm Claude Code can see the kit:

```
What E2E skills are available here, and what mode is this project in?
```

It should name the eleven skills, state the mode, and say Gate 1 is a hard stop.

## 6. First bolt

```
/bolt CHK-42
```

**One story per Claude Code session**, in the same project folder. Bolts share the
seed test, the knowledge base and the traceability matrix, so they belong in one
project — but a session that has already read one story's requirements will plan
the next one partly from them, and that failure is silent. Resuming across
sessions is safe: `bolts/<ID>/audit.md` is what a new session reads to continue.

See `RUNBOOK.md` for what happens in each mode and what to do at Gate 1.

## 7. When a story changes later

Gate 1 snapshots the story you approved, so the kit can tell you later when a
requirement has moved out from under tests that still pass:

```bash
npx pw-aidlc story-diff CHK-42
```

Then `/revise CHK-42` in Claude Code updates only the specs the drift affected.
No git and no application source are required — the baseline is a literal copy at
`bolts/<ID>/story.snapshot.md`. `doctor` reports drift for every bolt on each run.

For bolts created before this kit version, take one baseline snapshot each:

```bash
npx pw-aidlc story-diff <ID> --snapshot
```

See `RUNBOOK.md` → *The story changed: what now?* for the full workflow.

## Upgrading Playwright

```bash
npm i -D @playwright/test@latest
npx playwright init-agents --loop=claude     # regenerate agent definitions
git diff .claude/agents/                     # review before committing
npx pw-aidlc doctor
```

Never regenerate agent definitions inside CI — that introduces non-determinism.

## Updating the kit

Skills are copied **per project**. Pulling the kit does not update a project that
already exists — you have to refresh it:

```bash
npx pw-aidlc init --yes
```

Refreshes `.claude/skills/` and `.claude/commands/`, which are copied
unconditionally. **Leaves alone:** `e2e.config.yml`, `tests/`, `.env.local`,
`knowledge/`, `bolts/` and generated tests. This is the command `doctor`
suggests when it reports stale skills, and it is safe to run at any time.

`pw-aidlc doctor` will tell you whether a refresh is needed:

```
Kit
  ✓ 11 skills installed
  ✓ skills match this kit version
```

### `--force` is a different thing, and it is destructive

`--force` additionally **overwrites `e2e.config.yml`, `tests/seed.spec.ts`, the
CI workflow and the org knowledge baseline** — regenerating the config from
command-line arguments, so a `--force` without `--mode` resets your project to
the brownfield default and a `--force` without `--name` renames it. Your seed
test, the highest-value file you wrote by hand, goes back to the template.

Use it only to re-scaffold deliberately, pass the same arguments you originally
used, and commit first so the diff is recoverable.

## Uninstall

Delete `.claude/skills/e2e-*`, `.claude/commands/{bolt,testcases,rebind,heal,matrix,results}.md`,
`e2e.config.yml`, `bolts/`, `context/`, `knowledge/`, and the
`<!-- playwright-aidlc-kit -->` section of `CLAUDE.md`. Generated specs are
ordinary Playwright tests and keep working.
