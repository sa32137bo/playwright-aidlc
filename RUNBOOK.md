# Runbook

How to actually run this. Pick the section that matches your situation.

- [Which mode am I in?](#which-mode-am-i-in)
- [How much code should it read?](#how-much-code-should-it-read)
- [Regression: code changed, what now?](#regression-code-changed-what-now)
- [Brownfield](#brownfield--app-exists-stories-exist) — app exists, stories exist
- [Greenfield](#greenfield--stories-exist-app-does-not) — stories exist, app does not
- [Characterization](#characterization--app-exists-no-usable-requirements) — app exists, no usable requirements
- [Running tests and capturing results](#running-tests-and-capturing-results)
- [When tests fail](#when-tests-fail)
- [Release visibility](#release-visibility)
- [Everyday commands](#everyday-commands)
- [Troubleshooting](#troubleshooting)

---

## Which mode am I in?

| Do you have… | Mode |
|---|---|
| User stories **and** a running app | `brownfield` |
| Stories, but the feature is not built yet | `greenfield` |
| A running app, but no requirements worth testing against | `characterization` |

Mode is set in `e2e.config.yml` and can be overridden per bolt. It is the single most important setting: it decides what is authoritative and what Gate 1 shows you.

---

## How much code should it read?

Mode decides what is authoritative. **`source.grounding` decides how long you wait for it.**

```yaml
source:
  path: "src"
  grounding: "scan"     # off | scan | deep
```

| Depth | What runs | Use when |
|---|---|---|
| `off` | live app only | no source available, or you want speed over depth |
| `scan` | mechanical scan — routes, test IDs, aria-labels, form fields, API calls, exact message strings, flags | **the default.** Most bolts |
| `deep` | scan + the agent reads the files for validation rules, states, authorization, async behaviour | high-risk areas, regulated work, dense validation logic |

A blank `source.path` is `off` automatically — not an error.

**Per bolt:** `grounding:` in `bolts/<ID>/intake.yml`, or `/bolt CHK-42 --grounding deep`.
**Automatic:** a bolt with `risk: high` escalates to `deep` and says so at Gate 1.

### If bolts are slow to reach Gate 1

In order of effect:

1. **Scope the scan.** Set `scope.source_paths` in the intake — one subtree instead of the whole tree is usually the whole problem.
   ```bash
   npx pw-aidlc context --depth deep --paths "src/checkout/**"
   ```
   Deep over a narrow scope is often faster *and* better than scan over everything.
2. **Drop to `scan`** if you are on `deep` and do not need derived logic.
3. **Use `--if-stale`** so an unchanged tree is not rescanned. It compares a content hash, not a timestamp guess.
4. Check `doctor` — it prints the resolved depth and the file count, and warns when `deep` is pointed at a large tree.

---

## Regression: code changed, what now?

Grounding depth is the wrong question here. Depth answers *"how deeply do we read
the code to design tests"*. Regression asks *"what changed, and what does that
break or leave untested"*. Two different things.

Regression splits in two:

**1. Do the existing tests still pass?**

```bash
npx pw-aidlc results
```
Then `/heal` anything red. It classifies each failure — product bug, test defect,
environment, flake — before repairing. Grounding depth is irrelevant to this half.

**2. Did the change introduce behaviour nothing tests?**

```bash
npx pw-aidlc impact --since main
```

Diffs against the ref, matches changed files against the `covers:` header in each
spec, and writes `results/impact.md` with three lists:

| List | Meaning |
|---|---|
| **Run these first** | specs covering code that moved |
| **Regression gap** | changed files no spec claims — this is where new scenarios come from |
| **Unknown impact** | specs with no `covers:` header. Unknown, *not* unaffected |

Then run a bolt scoped to the gap. Deep is affordable here precisely because the
scope is a diff rather than an application:

```bash
npx pw-aidlc context --depth deep --paths "src/payments/**"
```

Record the baseline in the bolt's intake with `since:` so the reviewer can see
what the change was measured against.

> Specs generated before coverage provenance existed carry no `covers:` line.
> They show up as *unknown* forever until regenerated. Treat unknown as untested.

---

## The story changed: what now?

The other half of regression, and the half that works with **no access to the
application code**. `impact` needs `source.path`; this needs nothing but the
story file.

Why it needs a command at all: a spec written from a criterion that was later
retired **does not fail**. It passes, asserting a rule nobody wants any more.
Running the suite will never tell you. Only comparing the documents will.

### 1. Find out what moved

```bash
npx pw-aidlc story-diff US-CLC-CUST-001
```

```
Story drift — US-CLC-CUST-001
  · now:      inputs/stories/US-CLC-CUST-001.md
  · baseline: bolts/US-CLC-CUST-001/story.snapshot.md
  ! 3 of 5 acceptance criteria moved
  ·   ~ AC-3→AC-2 reworded → tests/e2e/US-CLC-CUST-001/postcode.spec.ts
  ·   + AC-4 added → no coverage
  ·   - AC-2 (was) removed → tests/e2e/US-CLC-CUST-001/customer-create.spec.ts
```

Exit code 1 when anything moved, so CI can gate on it. The full report is
`results/story-diff-<ID>.md`.

| Class | What it means | What happens |
|---|---|---|
| **reworded** | the criterion says something different now | the spec still passes while asserting the old rule — **the dangerous one** |
| **added** | new criterion | nothing covers it; this is the gap |
| **removed** | criterion is gone from the story | flagged, **never auto-deleted** |
| **renumbered** | identical text, new position | not a change |
| **uncertain** | only a degraded baseline exists | cannot be judged; take a snapshot |

### 2. Update the tests

```
/revise US-CLC-CUST-001
```

One approval round covering: the drift, the exact edit proposed per criterion,
what to do about any retired criterion, and whether to bring a stale manual
test-case sheet along. Then it edits only the affected specs, runs only those,
and re-snapshots so the next check starts clean.

Answering **no** to the test-case question still updates the specs. The sheet
never blocks the scripts.

### 3. Confirm the loop closed

```bash
npx pw-aidlc story-diff US-CLC-CUST-001    # must now say "current", exit 0
```

If it still reports drift, the snapshot was not refreshed and every future check
will report the same thing forever.

### Where the baseline comes from

`/bolt` writes `bolts/<ID>/story.snapshot.md` when you approve Gate 1 — a literal
copy, so the diff is against **what you approved**. **Git is not required**: an
edited file dropped in with no commit and no remote works exactly the same.

A bolt approved before this feature existed has no snapshot. `story-diff` falls
back to `plan.md`'s coverage table, says so loudly, and downgrades rewordings to
*uncertain* — a planner's summary differs from its source by construction, so
claiming a rewording there would be noise. Fix it once:

```bash
npx pw-aidlc story-diff <ID> --snapshot
```

### If the new story has a different filename

Overwrite `inputs/stories/<ID>.md` in place — the snapshot keeps the old
version, so nothing is lost. If a file arrives as `<ID>-v2.md`, `story-diff`
lists the near-misses and refuses to guess. Either rename it, pass
`--story <path>`, or set `story_file:` in `bolts/<ID>/intake.yml` to make it
permanent.

### Doctor reports this too

`npx pw-aidlc doctor` checks every bolt with a snapshot:

```
  ! bolt US-CLC-CUST-001: 3 acceptance criteria have moved since Gate 1
      fix: /revise US-CLC-CUST-001
```

---

## Brownfield — app exists, stories exist

The default, and where the kit earns its keep. Both sources are consulted and disagreements between them are reported rather than guessed at.

### Setup (once)

```bash
cd /path/to/your/app-repo
npm init playwright@latest                 # if Playwright isn't set up
npx playwright init-agents --loop=claude   # official planner/generator/healer
npx pw-aidlc init CLC --mode brownfield --url https://crewhub-qa.taconnections.com/ --src src
```

Then, in order:

1. **Credentials** → `.env.local`. Never in `e2e.config.yml`.
2. **A story** → either set `inputs.jira.base_url` in `e2e.config.yml`, or drop `inputs/stories/CHK-42.md`. To try it immediately: `cp examples/sample-inputs/CHK-42.md inputs/stories/`
3. **Requirements** (optional but valuable) → `inputs/requirements/`
4. **Make the seed test real.** Open `tests/seed.spec.ts` and make it sign in and reach a usable state. This is the highest-leverage file in the setup — every generated test inherits its shape.

```bash
npx playwright test tests/seed.spec.ts     # must pass
npx pw-aidlc doctor                        # must be clean
```

### Run a bolt

In Claude Code:

```
/bolt CHK-42
```

What happens:

1. **Intake** — resolves the story (from file or Jira, cached to `inputs/stories/`), config, requirements. Asks only about genuine gaps.
2. **Context** — scans your source for routes, validation rules, exact error strings, API calls, flags → `context/app-context.md`
3. **Plan** — explores the live app through the seed test, cross-checks against the code → `bolts/CHK-42/plan.md`
4. **GATE 1 — it stops.**

### What you do at Gate 1

This is the review that matters. You get a coverage table, a scenario list, and a **discrepancies** section. Spend your time on:

- **Coverage** — is anything important missing? Is anything here that should be a unit test?
- **Discrepancies** — where code and the app disagree. These are often real bugs, found before a test was written.
- **Assumptions** — anything the agent had to guess.

Then reply with approval or corrections. Corrections are cheap here and expensive later: a wrong plan produces a dozen wrong tests.

### After approval

Generation runs against the live app (every locator verified), the first heal pass fixes obvious breaks, then you are offered a run. Gate 2 is the review checklist. Then a PR.

### Expected first-bolt output

```
bolts/CHK-42/{intake.yml, plan.md, audit.md, manifest.json}
context/app-context.md
tests/e2e/CHK-42/*.spec.ts
results/summary.md
docs/traceability-matrix.md
```

---

## Greenfield — stories exist, app does not

Tests are written first, from requirements. They are **expected to fail** until the feature ships. That is the point, not a problem.

```bash
npx pw-aidlc init NewFeature --mode greenfield --src src
```

`app.url` is not required. Put stories in `inputs/stories/`, business documents in
`inputs/requirements/`, run `npx pw-aidlc ingest` if any of them are Word or PDF,
then `/bolt NEW-17`.

Documents matter more here than in any other mode: with no app and often no
source, they are the only grounding besides the story. Read what `ingest` reports
— `0 tables, 27 images` means the field rules are inside the screenshots and the
story is carrying the plan on its own.

### What differs

- No live exploration, so **locators cannot be verified**. They are generated from the plan and marked `// UNVERIFIED — greenfield`.
- Specs are tagged `@pending` so CI can exclude them until the feature lands.
- **Discrepancies still apply** wherever two sources disagree — a story against a requirements document, or against screenshots extracted from one. Only code-versus-live-app comparison is unavailable. In practice this is where greenfield earns its keep: a story claiming three flows are "identical" when the process document shows one carrying an extra mandatory field is a defect found before a line of code exists.
- **No healing.** Failures are expected, not defects.

### When the feature ships — rebind, do not re-run the bolt

Point `app.url` at the new build, switch the mode to `brownfield`, put real
credentials in `.env.local`, and make `tests/seed.spec.ts` sign in. Then:

```bash
npx pw-aidlc rebind --bolt NEW-17     # preflight: inventory and blockers
```

```
/rebind NEW-17
```

**Not `/bolt NEW-17`.** A finished bolt's last completed step is "PR opened", so
resuming it does nothing at all — there is no remaining step, and the specs still
carry locators nobody has ever observed.

`/rebind` keeps Gates 1 and 2 approved — the coverage was settled and is not
reopened — and asks only whether the application matches them. It replaces every
`// UNVERIFIED` locator with one observed live, drops `@pending` from fully bound
specs, runs them, and stops at **Gate R** with a per-test table.

Failures here are meaningful for the first time, and the classification is the
whole point: *the app is wrong* (a defect — report it, do not touch the test),
*the plan was wrong* (a Gate 1 misunderstanding — say so), or *the test is wrong*
(bind it properly, or hand it to `e2e-heal`). Getting the first two wrong in the
direction of the third silently erases defects.

Run the preflight before starting. Unset credentials do not error — they answer
with a login page, where a diligent agent will bind every locator on the wrong
screen and report success.

**Honest expectation:** greenfield produces useful *plans* and roughly-right tests. The locators will need a pass once the app exists. The value is in agreeing the acceptance criteria in testable form before the code is written, not in getting the selectors right in advance.

---

## Characterization — app exists, no usable requirements

The common legacy case. Nobody knows what it is supposed to do; you need a safety net before you change anything.

```bash
npx pw-aidlc init Legacy --mode characterization --url https://staging.acme.io --src src
```

No stories needed. Run `/bolt LEGACY-CHECKOUT` — use a descriptive ID, since there is no ticket.

### What differs

- The plan describes **what the app does**, organised by user journey, not by acceptance criteria.
- **Nothing is called a bug.** There is no requirement to judge against, so odd behaviour goes under `## Observations for the team` and a human decides whether it is a defect or a feature.
- Gate 1 asks a different question: *is this an accurate description of current behaviour, and is it behaviour we want to lock in?*

That second half matters. A characterization test freezes today's behaviour, including its bugs. Approving one means "do not change this without noticing", not "this is correct".

### The usual sequence

Characterize first, then refactor with the safety net, then move to `brownfield` once real requirements exist.

---

## Running tests and capturing results

At the end of generation the agent offers to run the tests. You can also run them yourself:

```bash
npx pw-aidlc results                    # whole suite
npx pw-aidlc results --grep @smoke      # tag filter
npx pw-aidlc results --bolt CHK-42      # one bolt
npx pw-aidlc results --no-run           # re-summarise the last run
```

Every run writes `results/run-<timestamp>.json` and `results/summary.md`, with per-test status, duration and the first error line for each failure. `results/` is gitignored except `summary.md`.

Or in Claude Code: `/results`.

---

## When tests fail

```
/heal
```

The healer **classifies before it repairs**:

| Class | What happens |
|---|---|
| Product bug | **Reported, not patched.** The test stays red. |
| Test defect | Repaired — locator or wait only |
| Environment | Reported; fix the environment, not the test |
| Flake | The race is fixed, never masked with a retry |

It will never modify an assertion, delete a test, or add a skip to make a suite green. Three attempts per test, then it stops. If more than a third of the suite fails at once it stops immediately — that is a deploy or environment problem, not thirty independent defects.

Heals go on a branch as a PR labelled `test-heal`, with the classification and evidence in the body. Review the classification, not just the diff.

---

## Release visibility

```bash
npx pw-aidlc matrix
```

Writes `docs/traceability-matrix.md`: story → scenario → test → last run result, plus gaps.

Every row carries a **Matched by** column saying what it rests on, and the headline
separates the two things it can claim:

| Matched by | Means |
|---|---|
| `header + title` | the spec declares this scenario id **and** a test inside it matches by name |
| `header` | the spec declares the id but names no single test — one longer test covering several scenarios. Counted as present, not as a test of its own |
| `title only` | **no spec declares this id.** A similarity guess, which has bound the wrong test before. Verify before quoting |

Two caveats for a release conversation. A bolt whose plan parses to zero scenarios
is reported as a **parser failure** in the file — do not read its absence as
"nothing planned". And a matched row proves a test exists, never that it asserts
anything meaningful; only Gate 2 review establishes that.

---

## Everyday commands

| Command | When |
|---|---|
| `npx pw-aidlc init <name>` | Once per project |
| `npx pw-aidlc init --yes` | After pulling a new kit — refreshes skills, leaves config and tests alone |
| `npx pw-aidlc ingest` | Whenever a `.docx` or `.pdf` lands in `inputs/` |
| `npx pw-aidlc testcases --export <ID>` | Hand test cases to testers as Excel + CSV (also stamps provenance) |
| `npx pw-aidlc testcases --import <file>` | Bring an edited sheet back, with a diff |
| `npx pw-aidlc testcases --check <ID>` | Have the source documents changed since the cases were written? |
| `npx pw-aidlc testcases --stamp <ID>` | Record what those cases were written from |
| `npx pw-aidlc doctor` | Before your first bolt; whenever something feels wrong |
| `npx pw-aidlc context` | After a significant source change |
| `npx pw-aidlc impact --since <ref>` | After a code change, to find uncovered behaviour |
| `npx pw-aidlc story-diff <ID>` | After a **story** changes, to find specs it made stale |
| `npx pw-aidlc story-diff <ID> --snapshot` | Reset the approved baseline (done for you at Gate 1) |
| `npx pw-aidlc results` | After generation, or any time you want a run |
| `npx pw-aidlc matrix` | Before a release conversation |
| `/testcases <ID>` | Manual test cases from a story — no app, credentials or requirement docs needed |
| `/bolt <ID>` | Author tests for a story — **one story per session** |
| `/revise <ID>` | The story changed — update the specs it made stale |
| `/rebind <ID>` | Bind greenfield specs once the app is reachable |
| `/heal` | Something is red |
| `/results` | Run and summarise |
| `/matrix` | Coverage report |

**Skills are copied per project.** Pulling a new kit does not update a project
that already exists — `pw-aidlc init --yes` does, and `doctor` tells you when it
is needed. Use `--yes`, not `--force`: `--force` also rewrites `e2e.config.yml`
and `tests/seed.spec.ts` from templates.

---

## Troubleshooting

**"The agent ignored the gates."** `CLAUDE.md` is missing the kit section, or the skills are not installed. Run `npx pw-aidlc doctor` — it checks both. This is the most common failure, and it fails silently: you get a normal-looking agent with no governance.

**"It planned scenarios for things that do not exist."** The story was thin and there was no source grounding. Check `source.path` is set and `npx pw-aidlc context` produced a real file. With `frontend_only: true`, add an OpenAPI contract to `inputs/contracts/`.

**"Locators are brittle."** Your app has no test IDs and no accessible roles. `npx pw-aidlc context` warns about this. No agent can produce durable locators against div-soup — fix the source first, or accept ongoing heal churn.

**"Tests pass locally, fail in CI."** Usually a feature flag or seeded data difference. Record flag state in the bolt intake and environment quirks in `knowledge/project/environment-notes.md`.

**"Gate 1 takes too long to review."** The bolt was too big. Cap at 12–15 scenarios for high-risk areas. If review runs past twenty minutes, split the next one.

**"The healer keeps fixing the same test."** That is a signal about the app, not the test. Check the audit logs — a test healed three times usually means an unstable component, not three unlucky selector changes.

**"Can I use this if tests live in a separate repo?"** Yes, but point `source.path` at a sibling checkout of the app. Without it you lose code grounding entirely and degrade to live-app-only planning — no discrepancy detection.
