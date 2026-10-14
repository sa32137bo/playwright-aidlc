# Playwright AI-DLC Kit

A governance and grounding layer that turns Claude Code into a repeatable
end-to-end test authoring pipeline for Playwright.

You give it a user story. It reads your application's **source code** and your
**running application**, writes a reviewable test plan, stops for your approval,
generates Playwright specs with every locator verified against the live UI,
heals what fails, and opens a pull request — logging every question, decision and
assumption along the way.

> **Start here:** [`GETTING-STARTED.md`](GETTING-STARTED.md) — every command in
> order, with expected output, plus the short path for your second project.
>
> Also: [`INSTALL.md`](INSTALL.md) reference · [`RUNBOOK.md`](RUNBOOK.md) per-mode
> detail · [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) before you promise anything.

## What problem this solves

Asking an AI to "write me some Playwright tests" produces plausible-looking specs
built on invented selectors against behaviour nobody verified. They fail on first
run, or worse, pass while asserting nothing.

This kit constrains that into an auditable process: grounded inputs, a human gate
before any code is written, live-verified locators, classified failures, and a
paper trail a reviewer can check in ten minutes.

## Two grounding sources

| Pass | Source | Gives you |
|---|---|---|
| 1 | **Source code** | routes, validation rules, exact error strings, API calls, roles, feature flags |
| 2 | **Live application** | real DOM, accessibility tree, working locators, actual timing |

Code only → invented selectors. Live app only → smoke tests; clicking around
never finds the validation branch nobody exercises. **Both** → when they
disagree, that is a finding. A rule in code the UI does not enforce is a bug you
found before writing a test.

## Three modes

Mode is set in `e2e.config.yml` and decides what is authoritative.

| Mode | You have | Tests are |
|---|---|---|
| `greenfield` | stories, no app yet | written first, expected to fail until the feature ships |
| `brownfield` | stories **and** a running app | cross-checked against both; disagreements reported |
| `characterization` | a running app, no usable requirements | a description of current behaviour; nothing is called a bug |

## Flow

```
inputs/stories/CHK-42.md  ─┐
e2e.config.yml            ─┤
knowledge/                ─┴─▶ intake ─▶ context ─▶ plan ─▶ [GATE 1: you approve]
                                                                    │
                                          generate (live-verified) ◀┘
                                                   │
                                     run ─▶ heal ─▶ [GATE 2: checklist]
                                                   │
                                            PR ─▶ [GATE 3: review] ─▶ merge
```

One bolt = one story = one PR. Gate 1 is a hard stop under every autonomy
setting, because a wrong plan produces a dozen wrong tests.

**One story per Claude Code session, all in the same project.** A session that
has already read one story's requirements will plan the next one partly from
them — a scenario citing the wrong flow, a "discrepancy" that is really a
difference between two stories. Nothing errors; the plan just reads well and is
about the wrong thing. Resuming across sessions is safe, which is what
`bolts/<ID>/audit.md` exists for.

## What's in this repository

This repo is the **kit itself**, not a test suite. It installs *into* an
application repo; it does not run standalone.

| Path | What it holds |
|---|---|
| `bin/pw-aidlc.mjs` | CLI entry point — `init`, `ingest`, `doctor`, `context`, `results`, `matrix`, `impact`, `story-diff`, `rebind` |
| `lib/` | CLI implementation: `init`, `doctor`, source `context` scanner, `ingest` (docx/pdf), `impact`, `storydiff`, `rebind`, `report` (results + matrix), shared `util` |
| `skills/` | The ten Claude Code skills that drive each phase of a bolt |
| `commands/` | Slash commands surfaced in Claude Code: `/bolt`, `/testcases`, `/revise`, `/rebind`, `/heal`, `/matrix`, `/results` |
| `templates/` | What `init` scaffolds — `e2e.config.yml`, the `CLAUDE.md` section, org knowledge base, seed specs, CI workflow |
| `scripts/` | `new-project.ps1` / `new-project.sh` — one-command project bootstrap |
| `examples/` | A worked bolt (`CHK-42-guest-checkout`) and sample story/BRD inputs |

### The eleven skills

| Skill | Phase |
|---|---|
| `e2e-bolt` | Orchestrates the whole run; the one `/bolt` invokes |
| `e2e-intake` | Resolves config, story, requirements and contracts into `intake.yml` |
| `e2e-app-context` | Scans application source into `context/app-context.md` |
| `e2e-plan` | Explores the live app and writes the Gate 1 plan |
| `e2e-generate` | Turns the approved plan into spec files, verifying locators live |
| `e2e-testcases` | Writes manual test cases from stories; requirements enrich them when present |
| `e2e-heal` | Classifies a failure before repairing it |
| `e2e-rebind` | Binds a greenfield bolt's unverified locators to a live app |
| `e2e-revise` | Updates a shipped bolt when its **story** changes |
| `e2e-ship` | Commits to a branch and opens a reviewable PR |
| `e2e-matrix` | Regenerates the traceability matrix for release visibility |

## The commands

```bash
npx pw-aidlc init <name>    # scaffold: folders, config, knowledge, skills
npx pw-aidlc ingest         # convert .docx / .pdf inputs to Markdown (no model)
npx pw-aidlc testcases --export <ID>   # test cases to Excel and CSV
npx pw-aidlc testcases --import <file> # read an edited sheet back, with a diff
npx pw-aidlc testcases --check <ID>    # have the source documents changed since?
npx pw-aidlc doctor         # preflight — toolchain, secrets, inputs, app, seed
npx pw-aidlc context        # rebuild code-side grounding
npx pw-aidlc results        # run the suite, write results/summary.md
npx pw-aidlc matrix         # release visibility: story → scenario → test → result
npx pw-aidlc impact         # what a code change touches, and what it left uncovered
npx pw-aidlc story-diff <ID>  # which acceptance criteria moved since Gate 1 approved them
npx pw-aidlc rebind --bolt <ID>   # preflight for binding greenfield specs to a live app
```

In Claude Code: `/bolt <ID>`, `/testcases <ID>`, `/revise <ID>`, `/rebind <ID>`, `/heal`, `/results`, `/matrix`.
Run `pw-aidlc help` for the full flag list.

## Source analysis depth

Mode decides what is authoritative. **`source.grounding` decides how long you wait
for it** — it is the biggest lever on how long a bolt takes to reach Gate 1.

```yaml
source:
  path: "src"
  grounding: "scan"        # off | scan | deep
```

| Option | What runs | Time | Discrepancy detection |
|---|---|---|---|
| `off` | source ignored; planning from the live app only | none | disabled |
| `scan` | mechanical scan — routes, `data-testid`s, aria-labels, form fields, API calls, exact error strings, feature flags. No file reading. | seconds | **partial** |
| `deep` | everything `scan` does, then the agent reads the files for validation rules, screen states, authorization and async behaviour | minutes, grows with the tree | full |

**`scan` is the default.** A blank `source.path` resolves to `off` with no error —
so "point it at source and it uses it, otherwise it just uses the URL" is the
out-of-the-box behaviour, with nothing to configure.

**What `scan` costs you:** discrepancy detection drops from full to partial. Wrong
wording, a missing field and a moved route are still caught; a conflict that only
appears in validation logic is not. Gate 1 states the depth that ran and what it
did not cover, so the trade is visible rather than silent.

### Setting it

| Scope | Where |
|---|---|
| Project default | `source.grounding` in `e2e.config.yml` |
| One bolt | `grounding:` in `bolts/<ID>/intake.yml` |
| One command | `pw-aidlc context --depth deep` |
| Automatic | `risk: "high"` in a bolt's intake escalates to `deep`, and says so at Gate 1 |

Precedence runs highest-first down that list, with one override on top: no usable
`source.path` means `off` regardless.

### Deep is cheap when the scope is small

Reading one folder in depth is usually faster *and* better than scanning
everything:

```bash
npx pw-aidlc context --depth deep --paths "src/checkout/**"
```

Set `scope.source_paths` in a bolt's intake and it does this automatically.
`pw-aidlc doctor` prints the resolved depth, the reason, and the file count in
range — so you can see whether a bolt will be slow before starting it.

## Test cases, for people who will run them by hand

Not everything gets automated, and automation is not always what a team needs
first. `/testcases <ID>` writes reviewable manual test cases from a story and its
requirements — **no application, no source code, no credentials, no Playwright.**
It is the one command that works when the environment does not exist yet.

```
/testcases US-CLC-CUST-001
```
```bash
npx pw-aidlc testcases --export US-CLC-CUST-001 --format both
```

Output is `test-cases/<ID>.md` — the source of truth, diffable in a pull request —
plus a **filled copy of your team's own Excel template** and an RFC-4180 CSV for
whatever test-management tool the client runs. The workbook is filled, not
generated: styles, colour legend and instructions sheet are the ones your testers
designed, because a document people do not recognise is a document they do not use.

**Execution columns stay empty.** Actual Result, Status, Severity, Executed By,
Execution Date and Defect ID belong to whoever *runs* the test. Filling them would
manufacture a test result that lands in a test-management tool as a record nobody
can trace back.

**Upgrading an existing project.** `init` copies the workbook to
`test-cases/_template.xlsx`, and export prefers that copy — so a project set up
before the template moved to its current 18 columns still holds the old one.
Export refuses to write against it rather than filling the wrong columns; refresh
the copy with `npx pw-aidlc init --force`, or copy
`templates/test-case-template.xlsx` over it by hand.

**`Automation Candidate` is answered honestly**, with the reason. A case needing a
real inbox, a physical device or behaviour no document establishes is marked `No`
— and a bolt will not automate it.

When testers edit the workbook, `--import` brings it back:

```bash
npx pw-aidlc testcases --import test-cases/US-CLC-CUST-001.xlsx
```

It diffs against the Markdown, prints every change, and writes only on
confirmation. That is what stops the next regeneration silently discarding a
tester's corrections.

### Cases go stale, and the kit notices

A test-case document records the sources it was written from **and their content
hashes**, stamped on export or by `testcases --stamp <ID>`:

```yaml
sources:
  - inputs/stories/US-CLC-CUST-001.md sha256:bfd4da600365
  - inputs/requirements/CLC-CustomerCreate-BPF.md sha256:0f1e2d3c4b5a
```

`doctor` and `testcases --check <ID>` then report when a source has changed:

```
✗ inputs/stories/US-CLC-CUST-001.md — content changed
```

**By content, not by timestamp.** A clone, a checkout or a copied folder rewrites
every modification time, and an editor can rewrite a file without changing a byte
of it — either way a timestamp answers the wrong question. A file with no stamp is
reported as *unstamped*, never as current.

### And bolts use them, if they exist

`/bolt <ID>` looks for `test-cases/<ID>.md`. If it is there, a human has already
approved the specification, so the plan does not invent scenarios — it becomes a
**reconciliation report** that leads with what is missing:

```
3 things need your attention before the rest is worth reading.

  AC-6 has no test case             server-side rule, no UI surface
  TC_CUSTCREATE_009 not automatable needs a real email inbox
  TC_CUSTCREATE_004 assumes a step  I added the search step and am telling you
```

That is the check a hand-written sheet most often fails — a tester writing from a
story follows the happy path, so missing negatives are the norm. Gate 1 stays, but
gets shorter and points somewhere useful.

**If no test cases exist, nothing changes.** The feature is additive; planning from
the story is the normal path.

## Greenfield, then the app arrives

A greenfield bolt writes specs whose every locator is a statement of intent —
marked `// UNVERIFIED`, tagged `@pending`, excluded from CI. When the application
becomes reachable, **do not re-run the bolt.** Its last completed step is "PR
opened", so resuming finds nothing to do while the locators stay unverified.

```bash
npx pw-aidlc rebind --bolt CHK-42     # preflight: inventory and blockers
```
```
/rebind CHK-42
```

Gates 1 and 2 stay approved — coverage was settled and is not reopened. The only
question a rebind asks is whether the application matches it. Every `UNVERIFIED`
locator is replaced with one observed live, `@pending` comes off fully bound
specs, the tests run, and it stops at **Gate R**.

Two things make this more than a find-and-replace:

**A locator that cannot be found is a finding**, classified renamed, missing or
moved — never resolved by substituting the nearest plausible element, which is how
a test ends up passing against the wrong control.

**Failures are classified before they are fixed**: *the app is wrong* (a defect —
report it, do not touch the test), *the plan was wrong* (a Gate 1 miss), or *the
test is wrong*. Calling the first two the third is how a generated suite quietly
erases the defects it was built to find.

The preflight is deterministic because the failure it prevents is silent: unset
credentials do not error, they answer with a login page, and every locator bound
there is bound to the wrong screen.

## Business documents — Word and PDF

Requirements arrive as `.docx` and `.pdf`. No skill can read either, so they are
converted once, up front, by a command with no model in it:

```bash
npx pw-aidlc ingest
```

A `.docx` is a ZIP of XML; a `.pdf` has a text layer. Both are mechanical to
read, so this costs **no tokens** and produces something better than an agent
transcription: a `.md` a human can review before Gate 1, git can diff when the
business reissues the document, and the audit trail can cite.

Embedded images are extracted to `<document>.media/` and referenced inline as
`> [IMAGE: image-07.png - Groups section]`. Content that exists only as pixels is
**never guessed at** — it is marked, and the skills open only the placeholders
inside the current bolt's scope.

The report is the point:

```
✓ CustomerCreate_Business_Process_Flow.md — 40 headings, 124 paragraphs
✓ 27 image(s) -> CustomerCreate_Business_Process_Flow.media/
! no tables, but 27 image(s) — if this document carries field rules, formats
  or limits in tables, they are inside those images and are NOT in the Markdown
```

`0 tables, 27 images` tells you before you start that the document carries the
flow but not the rules. `doctor` fails soft on any `.docx` or `.pdf` with no
`.md` beside it, because an unconverted document contributes nothing silently.

A **scanned** PDF has no text layer. Ingest refuses to write a near-empty file
that would pass for a successful conversion, and says to read the pages visually
instead.

## Regression testing

A bolt is for a story arriving. Regression is the other half of the job: the code
changed, and someone has to work out what to retest.

**Grounding depth is the wrong lever here.** Depth answers *how deeply do we read
the code to design tests*. Regression asks *what moved, and what does nothing
cover* — two different questions, and the kit answers them separately.

| Question | Command | Answers |
|---|---|---|
| Do the tests I have still pass? | `pw-aidlc results` → `/heal` | which tests broke, and why |
| Did the change add behaviour nothing tests? | `pw-aidlc impact --since <ref>` | where you have **no** coverage |
| Did the **requirement** change under tests that still pass? | `pw-aidlc story-diff <ID>` → `/revise <ID>` | which criteria moved, and what they make stale |

Most teams only ask the first. The second is the one that quietly matters — a
passing suite over untested new code looks exactly like a healthy one.

```bash
npx pw-aidlc impact --since v2.3.0     # or main, or HEAD~5
```

```
Change impact
  ✓ 3 file(s) changed since v2.3.0 — 3 under src/
  ! 1 spec(s) cover code that changed — run these first
  · tests/e2e/CHK-42/guest-checkout.spec.ts  ←  src/checkout/validation.ts
  ! 2 changed file(s) have no covering spec — this is the regression gap
  · src/payments/RefundPanel.tsx
  · src/payments/refund.ts
```

Three lists, written to `results/impact.md`:

| List | Meaning |
|---|---|
| **Run these first** | existing tests over changed code |
| **Regression gap** | changed code no spec claims — where new scenarios come from |
| **Unknown impact** | specs with no `covers:` header. Unknown, **not** unaffected |

Then scope a bolt to the gap. Note the inversion — **`deep` is the right call
here even if your project default is `scan`**, because the scope is a diff rather
than an application:

```bash
npx pw-aidlc context --depth deep --paths "src/payments/**"
```

It works off a `covers:` line the generator writes into each spec, so impact is
computed from declared provenance rather than guessed from test names. Specs
generated before that existed carry no line and are reported as *unknown* until
regenerated. The command is stateless — it reads git and your specs on each run,
so it is safe to run as often as you like.

**Tests in a separate repo?** `source.path` may point at a sibling checkout;
`impact` finds the repository that actually holds your source, diffs there, and
reports paths relative to your test project. `--since` refs resolve in the
**source** repo in that case.

## The story changed — `/revise`

`impact` answers the code-side question. It needs `source.path`, so on a project
where you were never given the application source there is nothing for it to
diff. This is the other half, and the only half that works without the code.

**A spec written from a retired rule does not fail.** It passes, forever,
asserting something nobody wants any more. No test run will ever surface that,
so it has to be detected from the documents.

```bash
npx pw-aidlc story-diff CHK-42
```

```
Story drift — CHK-42
  · now:      inputs/stories/CHK-42.md
  · baseline: bolts/CHK-42/story.snapshot.md
  ! 3 of 5 acceptance criteria moved
  ·   ~ AC-3→AC-2 reworded → tests/e2e/CHK-42/postcode-validation.spec.ts
  ·   + AC-4 added → no coverage
  ·   - AC-2 (was) removed → tests/e2e/CHK-42/guest-checkout.spec.ts
  ·   1 renumbered (text identical — not a change)
  ! test-cases/CHK-42.md was written from an older version of this story

  ✓ results/story-diff-CHK-42.md
  update the tests for this drift: /revise CHK-42
```

Then in Claude Code:

```
/revise CHK-42
```

It presents the drift, the exact edit it proposes per criterion, and (if your
manual sheet is stale) the question of whether to bring that along — **in one
approval round**, not three. Nothing is regenerated until you approve.

### Where the baseline comes from

`/bolt` takes a snapshot at Gate 1, so the comparison is against *what you
approved*, not against yesterday's file:

```bash
npx pw-aidlc story-diff CHK-42 --snapshot   # written for you at Gate 1
```

It is a literal copy at `bolts/<ID>/story.snapshot.md`, not a hash — a hash
proves *that* a story changed, and only the old text says *which criterion*
changed and how. **No git required.** Teams drop in an edited file with no
commit and no remote, and this still works.

A bolt approved before this existed has no snapshot. `story-diff` falls back to
`plan.md`'s coverage table and says so: added and retired criteria are still
exact, but rewordings are reported as *cannot be compared*, because comparing a
planner's summary against its source reports a difference every time. Take one
snapshot and that is fixed permanently.

### What a revision costs

Proportional to what moved, which is the whole point:

| Drift | Work | Browser |
|---|---|---|
| reworded, same screen | the assertion, and the plan line above it | **none** |
| reworded, new element | one scoped live check | one short session |
| added | explore → plan → generate, for that criterion only | one session |
| removed | reported, never auto-deleted | none |
| renumbered | the coverage table. The spec is not opened. | none |

Locators were verified at the original Gate 1 and recorded in `plan.md`'s
locator worksheet — they have not moved because a sentence in a story changed.
So the common case, a reworded criterion, launches no browser at all.

Past about five drifted criteria, `/revise` says plainly that this is a re-plan
rather than a revision and points you back at `/bolt`.

### Naming: what file should the new story be?

**Overwrite `inputs/stories/<ID>.md` in place.** Nothing is lost — the snapshot
holds the approved version. There is no versioning convention to learn.

If a differently-named file turns up, `story-diff` names the near-misses and
**refuses to choose between them** — silently picking one of two candidate
requirement documents is the worst failure this tool could have:

```
✗ no story for CHK-42 under inputs/stories/
  Did you mean one of these?
      inputs/stories/CHK-42-v2.md   (modified 2026-09-11)
  Rename it to CHK-42.md (recommended — the snapshot keeps the old version), or run:
      pw-aidlc story-diff CHK-42 --story "inputs/stories/CHK-42-v2.md"
```

Either remedy works; to make a rename permanent, set `story_file:` in
`bolts/<ID>/intake.yml`.

### Manual test cases never block the scripts

If `test-cases/<ID>.md` was written from the old story, `/revise` says so and
offers to update it. **Answer no and the specs are still updated**, from the
story alone — the sheet is reported as known-stale and the revision proceeds.
`doctor` reports both kinds of staleness on every run.

## Requirements

| | |
|---|---|
| Node | 18 or later |
| Playwright | **1.56+** — Microsoft's official test agents ship in 1.56 |
| Claude Code | any recent version |
| A running app | not needed for `greenfield` mode |

## Getting the kit

```bash
git clone https://gitlab.prolifics.com/InnovationCenter/playwright-aidlc.git
cd playwright-aidlc
npm link          # registers the global `pw-aidlc` command
pw-aidlc help
```

Keep the clone somewhere permanent — `npm link` points back at this location, so
moving it later breaks the global command. To skip the global install, call
`node /path/to/playwright-aidlc/bin/pw-aidlc.mjs <command>` instead.

Then, in your application repo:

```bash
npm init playwright@latest                  # skip if already set up
npx playwright init-agents --loop=claude    # installs the three official agents
pw-aidlc init CLC --mode brownfield --url https://crewhub-qa.taconnections.com/ --src src
pw-aidlc doctor
```

Full walkthrough with expected output at each step: [`GETTING-STARTED.md`](GETTING-STARTED.md).

## What it gives you per bolt

```
bolts/CHK-42/intake.yml       resolved inputs
bolts/CHK-42/plan.md          the Gate 1 artifact
bolts/CHK-42/audit.md         every question, decision, approval, assumption
bolts/CHK-42/manifest.json    app commit, versions, config hash — reproducibility
context/app-context.md        code-side grounding
tests/e2e/CHK-42/*.spec.ts    generated specs, traceability headers
results/summary.md            run output
docs/traceability-matrix.md   coverage and gaps
```

## Design decisions worth knowing

**Delegates, does not reimplement.** The plan / generate / heal skills call
Microsoft's official Playwright agents. This kit is the layer around them:
intake, code grounding, modes, gates, audit, TDM, results, PR mechanics.

**Four layers, not one pile.** ~30 lines always-on in `CLAUDE.md`; skills loaded
on demand; config and knowledge as data; human docs the agent never loads.

**No LLM in CI.** AI runs when authoring and when healing. CI is plain
deterministic Playwright, so per-build cost is unchanged.

**Secrets first.** `init` writes `.gitignore` before creating anything else.
Config references credentials by variable name, never by value. `doctor` fails if
a credential file is tracked by git.

**Story text is data, not instructions.** A Jira description is requirements to
test, never directions to the agent.

**Classification before repair.** The healer sorts a failure into product bug /
test defect / environment / flake before touching anything. Product bugs are
never patched away, and no heal ever weakens an assertion.

## Cost shape

AI at authoring and repair time only. Published benchmarks: a 50-test plan around
340K tokens (~$4–7); first draft ~22 min versus ~4.5 hours manually; repair
~18 min versus ~2.5 hours. Order-of-magnitude, not a promise.

## Before you start

If your app has no `data-testid` attributes and no accessible roles or names, fix
that first. `npx pw-aidlc context` warns you. No agent produces durable locators
against div soup.

And read [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md). Generated tests are a
first draft needing human review, the healer can be confidently wrong, and none
of the gates are enforced by the model — they hold only because your reviewers
and branch protection make them hold.

## License

Proprietary — Prolifics Innovation Center. Internal use only.
