# Getting Started — Developer Walkthrough

The exact commands, in order, with what you should see after each one. Windows /
PowerShell throughout; macOS and Linux equivalents are noted where they differ.

This walks the **first** project on a machine. For your second and later
projects, skip to [Setting up another project](#setting-up-another-project) —
it's much shorter.

- [Part 1 — One-time machine setup](#part-1--one-time-machine-setup)
- [Part 2 — Create a project](#part-2--create-a-project)
- [Part 3 — Add your inputs](#part-3--add-your-inputs)
- [Part 4 — Preflight](#part-4--preflight)
- [Part 5 — Run the bolt](#part-5--run-the-bolt)
- [Part 6 — Regression testing, when the code changes](#part-6--regression-testing-when-the-code-changes)
- [Setting up another project](#setting-up-another-project)
- [What's global vs per-project](#whats-global-vs-per-project)
- [Common stumbles](#common-stumbles)

---

## Part 1 — One-time machine setup

Do this once. Never again on this machine.

### 1.1 Check Node

```powershell
node -v
npm -v
```

Node 18 or later. Anything current is fine.

### 1.2 Extract the kit

Put it somewhere permanent — not Downloads, not a temp folder. The global command
points back at this location, so moving it later breaks things.

```powershell
cd C:\AI-SDLC-Playwright
Expand-Archive .\playwright-aidlc-kit-v2.zip -DestinationPath . -Force
cd .\playwright-aidlc-kit
```

### 1.3 Register the CLI globally

```powershell
npm link
```

Expected:

```
added 1 package, and audited 3 packages in 1s
found 0 vulnerabilities
```

### 1.4 Verify

```powershell
pw-aidlc help
```

You should get the command list — `init`, `ingest`, `testcases`, `doctor`,
`context`, `impact`, `story-diff`, `results`, `matrix`, `rebind`. If PowerShell
says the command isn't recognised, see [Common stumbles](#common-stumbles).

**`ingest`, `testcases` and `rebind` in that list are how you know the kit is
current.** None of them exists in earlier copies, so if they are missing you are
running a stale global link — re-run `npm link` from the kit folder you actually
pulled.

**macOS / Linux:** `unzip playwright-aidlc-kit-v2.zip && cd playwright-aidlc-kit && npm link`

---

## Part 2 — Create a project

The kit installs *into* an application repo — it doesn't run standalone.

> **Shortcut:** `.\scripts\new-project.ps1 -Name MyApp -Mode greenfield` does
> steps 2.1 through 2.4 in one command. The manual steps are below so you know
> what it did.

### 2.1 Project folder

```powershell
cd C:\AI-SDLC-Playwright
mkdir greenfield-demo
cd greenfield-demo
git init
npm init -y
```

`git init` is not optional. The audit trail, the credential-leak check in
`doctor`, and the ship step all expect a repo.

### 2.2 Playwright

```powershell
npm init playwright@latest
```

Answer the prompts:

| Prompt | Answer | Why |
|---|---|---|
| TypeScript or JavaScript? | **TypeScript** | what the generated specs assume |
| Where to put your end-to-end tests? | **`tests`** (Enter) | the kit expects `tests/seed.spec.ts` |
| Add a GitHub Actions workflow? | **No** | the kit writes its own, with the seed gate and lint checks |
| Install Playwright browsers? | **Yes** | a few minutes now beats blocking mid-bolt |

Expected: `Success! Created a Playwright Test project at ...`

### 2.3 Playwright's official agents

```powershell
npx playwright init-agents --loop=claude
```

Expected:

```
  Using project "chromium" as a primary project
  specs\README.md            - directory for test plans
  tests\seed.spec.ts         - default environment seed file
  .claude\agents\playwright-test-generator.md
  .claude\agents\playwright-test-healer.md
  .claude\agents\playwright-test-planner.md
  .mcp.json                  - mcp configuration
  Done.
```

**Verify it worked** — this is the step most likely to fail quietly:

```powershell
dir .claude\agents
```

Three files. If the folder is empty or missing, the bolt won't run properly.

### 2.4 Scaffold the kit

Pick the line matching your situation:

```powershell
# Greenfield — stories exist, app does not
pw-aidlc init GreenfieldDemo --mode greenfield --src "" --yes

# Brownfield — stories and a running app
pw-aidlc init OrdersUI --mode brownfield --url http://localhost:3000 --src src --yes

# Characterization — running app, no usable requirements
pw-aidlc init Legacy --mode characterization --url https://staging.acme.io --yes
```

Drop `--yes` for an interactive walkthrough that explains each mode as it asks.

Expected: a run of ✓ lines ending with `Done. <name> is set up in <mode> mode`,
then five numbered next steps.

### 2.5 Choose how much of the code it reads

You just told it where your source is with `--src`. Now decide how deeply to read
it. This is **the single biggest lever on how long a bolt takes to reach Gate 1**,
and the one setting worth understanding before your first run.

Open `e2e.config.yml` and find:

```yaml
source:
  path: "src"
  grounding: "scan"          # off | scan | deep
```

| Option | What actually happens | Time | Pick it when |
|---|---|---|---|
| `off` | The source is ignored. Planning uses the running app only. | none | You have no source, or the app is all you care about |
| `scan` | A mechanical scan pulls out routes, `data-testid`s, aria-labels, form fields, API calls, exact error messages and feature flags. **Nobody reads your files.** | seconds | **The default. Start here.** |
| `deep` | Everything `scan` does, then the agent opens the files to work out validation rules, screen states, permissions and timing behaviour. | minutes, and grows with the tree | Dense validation logic, high-risk areas, regulated work |

**What you give up at `scan`.** Discrepancy detection — the kit noticing that your
code and your live screen disagree — drops from full to **partial**. Wrong wording,
a missing field or a moved route are still caught. A conflict that only shows up
in validation logic is not. Gate 1 always tells you which depth ran and what it
did not cover, so this is visible rather than silent.

**If you leave `--src` blank**, grounding is `off` automatically. No error, nothing
to configure — the kit just plans from the URL.

#### Three ways to set it

```yaml
# 1. Project default — e2e.config.yml
source:
  grounding: "scan"
```
```yaml
# 2. One bolt only — bolts/<ID>/intake.yml
grounding: "deep"
```
```powershell
# 3. One command
pw-aidlc context --depth deep --paths "src/checkout/**"
```

A bolt marked `risk: "high"` in its intake is escalated to `deep` automatically,
and says so at Gate 1. Routine bolts stay fast; the ones that matter stay thorough.

#### The trick worth knowing

**Deep is cheap when the scope is small.** Reading one folder in depth is usually
both faster *and* better than scanning your whole application:

```powershell
pw-aidlc context --depth deep --paths "src/checkout/**"
```

Set `scope.source_paths` in a bolt's intake and it does this for you.

`pw-aidlc doctor` prints the depth it resolved, why, and how many source files are
in range — so you can see whether a bolt will be slow before you start it.

### 2.6 Tidy up

```powershell
Remove-Item .\specs -Recurse -Force
```

Playwright's `init-agents` creates `specs/` for its plans. The kit keeps plans at
`bolts/<ID>/plan.md` instead, next to that bolt's intake, audit log and manifest.
The folder is harmless but unused.

Do **not** delete `.claude\agents\` or `.mcp.json`.

---

## Part 3 — Add your inputs

### 3.1 Stories

The **filename stem becomes the bolt ID**, so name files after the ticket:

```powershell
copy C:\path\to\stories\*.md .\inputs\stories\
Rename-Item ".\inputs\stories\CLC_Customer Creation_UserStory (1).md" "US-CLC-CUST-001.md"
```

`US-CLC-CUST-001.md` → `/bolt US-CLC-CUST-001`. Avoid spaces, `(1)` suffixes
and version numbers — they end up in folder and branch names.

### 3.2 Requirements

```powershell
copy C:\path\to\requirements\*.md .\inputs\requirements\
```

**Word and PDF need converting — one command does it:**

```powershell
pw-aidlc ingest
```

No model, no tokens, nothing to prompt. A `.docx` is a ZIP of XML and a `.pdf`
has a text layer, so both are mechanical to read. It walks `inputs/`, writes a
`.md` beside each document, extracts embedded images to `<document>.media/`, and
prints what it found:

```
  CLC_CustomerCreate_Business_Process_Flow.docx
  ✓ CLC_CustomerCreate_Business_Process_Flow.md — 40 headings, 124 paragraphs
  ✓ 27 image(s) -> CLC_CustomerCreate_Business_Process_Flow.media/
  ! no tables, but 27 image(s) — if this document carries field rules, formats
    or limits in tables, they are inside those images and are NOT in the Markdown
```

**The `.md` is the artifact that matters.** You read it before Gate 1, git diffs
it when the business reissues the document, and the audit trail points at it. An
agent reading the binary directly leaves nothing anyone can check — which is why
the kit converts rather than reading `.docx` in place.

`--force` re-converts, `--dir <path>` narrows the scan, `--file <path>` does one
document. Originals stay where they are as provenance.

**Read that last warning line.** It is the most useful thing ingest tells you. A
business-process document that is mostly screenshots has its field rules inside
the pictures — `0 tables, 27 images` means the Markdown carries the *flow* but
not the *rules*, and your story is doing all the grounding work. Expect the plan
to have gaps, and expect it to say so under open questions. If it flags nothing,
be suspicious rather than pleased.

**Scanned PDFs** have no text layer at all. Ingest refuses to write a near-empty
file that would look like success, and tells you to have Claude Code read the
pages visually instead.

### 3.3 Credentials — skip for greenfield

Edit `.env.local` (already gitignored). Never put a credential in
`e2e.config.yml`; it references them by variable name only.

### 3.4 Seed test — skip for greenfield

Open `tests\seed.spec.ts` and make it sign in and reach a usable state. Every
generated test inherits its shape, so this is the ten minutes with the highest
return in the whole setup.

```powershell
npx playwright test tests/seed.spec.ts
```

Must pass before any bolt.

---

## Part 4 — Preflight

```powershell
pw-aidlc doctor            # brownfield / characterization
pw-aidlc doctor --no-run   # greenfield — no app for the seed test to reach
```

A healthy greenfield run:

```
Configuration
  ✓ GreenfieldDemo — greenfield / webapp
Toolchain
  ✓ Node 24.19.0
  ✓ Version 1.62.1
Playwright agents
  ✓ planner, generator, healer installed
Kit
  ✓ 11 skills installed
  ✓ CLAUDE.md contains the kit section
Secrets
  ✓ .env.local is gitignored
  ✓ no credential files tracked by git
  ! .env.local has no values set yet — auth will fail
Inputs
  ✓ 1 story file(s) in inputs/stories/
Source code grounding
  ! no source.path configured — planning is document-only. Expected in greenfield.
Application
  ✓ greenfield mode — a running app is not required yet

  Ready, with 2 warning(s).
```

Red ✗ blocks you and prints the fix. Yellow `!` is informational — the two above
are normal for greenfield.

In **brownfield**, the same section reports the depth you chose in step 2.5 and
how much code is in range:

```
Source code grounding
  ✓ source at src
  ✓ grounding: scan — e2e.config.yml source.grounding: scan
  · 412 source file(s); discrepancy detection is PARTIAL — strings, test IDs,
    form fields and routes, not deeper logic
```

Switch to `deep` against a large tree and it warns you before you lose the time:

```
  ! deep grounding over 412 source files — expect a slow run to Gate 1
      fix: scope it per bolt: set scope.source_paths in intake.yml, or run
           pw-aidlc context --depth deep --paths "src/<area>/**"
```

This is the check to run whenever a bolt feels slow — it tells you the depth, the
reason it was chosen, and the size of the tree, before you spend anything.

---

## Part 5 — Run the bolt

```powershell
code .
```

Open as a **folder**, not a file. Claude Code reads `.claude/skills/` and
`CLAUDE.md` from the workspace root.

Confirm it loaded, in the Claude Code panel:

```
What mode is this project in and what E2E skills are available?
```

Expect: your mode, ten `e2e-*` skills, and Gate 1 described as a hard stop. If
it can't answer, the workspace root is wrong and nothing else will behave.

Then:

```
/bolt US-CLC-CUST-001
```

### Test cases first, if there is no app yet

If you have a story but no reachable application — no URL, no credentials —
`/bolt` will still produce a plan and `@pending` specs, but nothing you can
execute. Manual test cases are the thing that delivers value on that day:

```
/testcases US-CLC-CUST-001
```

No app, no source, no credentials. **And no requirement documents needed** — a
story with acceptance criteria is enough on its own. An empty
`inputs/requirements/` is a normal project, not a missing prerequisite; a BRD
sharpens the exact messages and boundaries when you have one.

It stops at a gate showing the case count, coverage of every acceptance
criterion, what it judged not automatable and why, and which documents and
screenshots it actually read. With no requirement documents it says that too, so
you can see the cases were grounded in the story alone — anything the story left
unstated is listed under open questions rather than guessed. Then:

```powershell
pw-aidlc testcases --export US-CLC-CUST-001 --format both
```

You get `test-cases/US-CLC-CUST-001.md` (the source of truth, diffable in a PR),
a `.xlsx` filled into your team's own template, and a `.csv` for a
test-management tool. Execution columns — Actual Result, Status, Executed By —
are deliberately blank; they belong to whoever runs the test.

When a tester edits the workbook:

```powershell
pw-aidlc testcases --import test-cases/US-CLC-CUST-001.xlsx
```

It shows every change and applies nothing until you confirm.

**Exporting also stamps the file** with the content hashes of the documents the
cases were written from. Later, when someone edits the story:

```powershell
pw-aidlc testcases --check US-CLC-CUST-001
```

```
✗ inputs/stories/US-CLC-CUST-001.md — content changed

  These cases may not cover the change. Re-run /testcases US-CLC-CUST-001,
  or re-stamp if you have reviewed them.
```

`pw-aidlc doctor` reports the same thing without being asked. It compares content
rather than timestamps deliberately — cloning the repo rewrites every modification
time, so a timestamp check would cry wolf on a fresh checkout and stay silent on a
real edit made in place.

**An approved test-case file changes what `/bolt` does.** Instead of inventing
scenarios it reconciles: every acceptance criterion mapped to a case or reported
as a gap, every `Automation Candidate: No` respected, every step it had to add
declared. Gate 1 gets shorter and points at what is missing.

### One story, one session — same project folder

**Start a new Claude Code session for each story.** Same project folder, same
`inputs/`, same skills — a fresh session.

A bolt is one story by design, and the reason is not tidiness. Everything a
previous bolt read stays in the session: the last story's acceptance criteria,
its screenshots, its plan. The next bolt then plans partly from material that
belongs to a different feature, and the failure is quiet — a scenario that cites
the wrong flow, a "discrepancy" that is really a difference between two stories,
an assertion carried over from a screen this story never touches. Nothing errors.
You just get a plan that reads well and is subtly about the wrong thing.

It also costs you the budget. Screenshots and requirement documents are the
expensive part of a document-grounded bolt, and carrying three stories' worth of
them into a fourth is how a session runs out before Gate 1.

Resuming is safe across sessions — that is what `bolts/<ID>/audit.md` is for. A
new session reads it and continues from the last completed step, so you lose
nothing by closing one and opening another.

```
Session 1:  /bolt US-CLC-CUST-001     -> Gate 1 -> generate -> PR
Session 2:  /bolt US-CLC-CUST-002     -> Gate 1 -> generate -> PR
Session 3:  /bolt US-CLC-DRV-001      ...
```

What you should *not* do is create a project per story. Bolts share the seed
test, the knowledge base, the traceability matrix and the specs directory — that
sharing is what makes the matrix meaningful and lets one story's plan reference
another's.

### What happens

1. **Intake** — resolves the story, config and requirements; asks about genuine gaps only
2. **Context** — scans source (skipped when `source.path` is empty)
3. **Plan** — writes `bolts/<ID>/plan.md`
4. **Gate 1 — it stops and waits for you**

### At Gate 1

This is the review that matters. Correcting the plan costs one message;
regenerating a dozen specs afterwards costs an afternoon. Check:

- Does every acceptance criterion map to a scenario, or get an explicit
  "not covered, because…"?
- Are generated IDs handled as pattern assertions plus a consistency check,
  rather than hard-coded values?
- Are permission negatives planned — what a restricted role *cannot* do?
- Are gaps listed as open questions instead of quietly invented?

Reply with approval or corrections. Then generation, an offered run, healing,
the Gate 2 checklist, and a PR.

### Greenfield expectations

Specs carry `// UNVERIFIED — greenfield` and are tagged `@pending`. They are
**expected to fail** until the feature is built — judging the run by whether they
pass is judging the wrong thing. The plan is the deliverable.

### When the app arrives — `/rebind`, not `/bolt`

Re-running the bolt does **nothing**. Its last completed step is "PR opened", so
resuming finds no remaining step — while the specs still hold locators nobody has
ever seen. Binding them is a separate job:

```powershell
# 1. e2e.config.yml:  mode: "brownfield"  and  app.url: "https://..."
# 2. .env.local:      real credentials, plus any TEST_* the specs read
# 3. make tests/seed.spec.ts actually sign in
npx playwright test tests/seed.spec.ts

npx pw-aidlc rebind --bolt US-CLC-CUST-001
```

The preflight prints the inventory and every blocker before you spend a session:

```
To bind
  01-navigation.spec.ts                5 unverified  @pending
  helpers.ts                          12 unverified  helper

  7 spec(s), 36 unverified locator reference(s)

5 blocker(s) — do not start
  ✗ E2E_USER is still a placeholder ("CHANGE_ME") — the app will answer with a
    login page and every locator bound will be the wrong one
  ✗ TEST_CUSTOMER_ID is not set in .env.local
```

**That credential check is the one that earns its keep.** Unset credentials do not
error — they land you on a login screen, where an agent will diligently bind every
locator on the wrong page and report success.

When it is clean, in Claude Code:

```
/rebind US-CLC-CUST-001
```

Gates 1 and 2 stay approved — the coverage was settled and is not reopened. The
only question is whether the application matches it. Each `// UNVERIFIED` locator
is replaced with one observed live, `@pending` comes off fully bound specs, the
tests run, and it stops at **Gate R** with a per-test table.

A locator that cannot be found is a **finding**, not a gap to fill in — classified
renamed, missing or moved, never resolved by substituting the nearest plausible
element. And failures are classified three ways: *the app is wrong* (a defect —
report it, do not touch the test), *the plan was wrong* (a Gate 1 miss), or *the
test is wrong*. Calling the first two the third is how generated suites quietly
erase defects.

### 5.1 See what you have across every bolt

```powershell
pw-aidlc matrix
```

Writes `docs/traceability-matrix.md` — acceptance criterion → scenario → test →
last result, for every bolt in the project. Run it after each bolt, and before any
release conversation.

**Read the "Matched by" column before quoting a number.** `header + title` and
`header` are anchored to the `// scenarios:` line in each spec and are reliable;
`title only` is a similarity guess and has bound the wrong test before. A bolt
whose plan parsed to zero scenarios is reported as a **parser failure** — do not
read its absence as "nothing planned".

```
**54/65 planned scenarios map to a named test**, across 4 bolt(s).
11 more are claimed by a spec file that does not name them individually.
```

The second line matters: one long journey test legitimately covering five
scenarios is not five tests, and the headline refuses to pretend otherwise.

---

## Part 6 — Regression testing, when things change

Parts 1–5 cover a story arriving. This part covers the other half of the job:
something changed after the tests were written, and you need to know what to
retest. Two things can change — the **code** (6.1–6.5) and the **story** (6.6).

**Run everything from your project folder** — the one with `e2e.config.yml`.

### 6.1 The two questions

Regression is really two questions, and the kit answers them separately:

| Question | Command | What it tells you |
|---|---|---|
| Do the tests I already have still pass? | `pw-aidlc results` | Which tests broke |
| Did the change add behaviour nothing tests? | `pw-aidlc impact --since <ref>` | Where you have **no** coverage |
| Did the **requirement** change under tests that still pass? | `pw-aidlc story-diff <ID>` | Which criteria moved, and what they made stale |

The third one needs no access to the application source at all — see 6.6.

Most teams only ever ask the first. The second is the one that quietly matters,
because a passing suite over untested new code looks exactly like a healthy one.

### 6.2 Find out what moved

```powershell
pw-aidlc impact --since v2.3.0
```

`--since` takes any git ref — a release tag, `main`, `HEAD~5`. Omit it and the
kit uses the commit your `app-context.md` was last built at.

Expected:

```
Change impact
  ✓ 3 file(s) changed since v2.3.0 — 3 under src/
  ! 1 spec(s) cover code that changed — run these first
  · tests/e2e/CHK-42/guest-checkout.spec.ts  ←  src/checkout/validation.ts
  ! 2 changed file(s) have no covering spec — this is the regression gap
  · src/payments/RefundPanel.tsx
  · src/payments/refund.ts

  ✓ results/impact.md — 1 impacted, 2 uncovered, 0 unknown
```

The full report lands in `results/impact.md`. Three lists, and each means
something different:

| List | What to do |
|---|---|
| **Run these first** | Existing tests over changed code. Highest chance of a real finding |
| **Regression gap** | Changed code **no test covers**. This is where new scenarios come from |
| **Unknown impact** | Specs with no `covers:` header. Treat as untested until checked — *not* as safe |

Nothing is remembered between runs. It reads git and your spec files each time,
so you can run it as often as you like and get the same answer.

### 6.3 Run the affected tests

```powershell
pw-aidlc results --bolt CHK-42      # the impacted bolt first
pw-aidlc results                    # then the whole suite
```

Anything red → `/heal` in Claude Code. It classifies before repairing: product
bug, test defect, environment or flake. A genuine product change — like a
postcode limit moving from 12 to 10 — is **not** something to patch away. It goes
back to the team.

### 6.4 Cover the gap

For changed code nothing tests, scope a bolt to it:

```powershell
pw-aidlc context --depth deep --paths "src/payments/**"
```

Then in Claude Code:

```
/bolt REFUND-1
```

**Use `deep` here even though your project default is `scan`.** The scope is two
files, so the expensive read costs almost nothing. Depth should follow the size
of the scope, not the project policy.

### 6.5 If your tests live in a separate repo

`source.path` can point at a sibling checkout:

```yaml
source:
  path: "../orders-app/src"
```

`impact` handles this — it finds the repository that actually holds your source
and diffs *there*, then reports paths relative to your test project:

```
  · source lives in a separate repository — diffing .../orders-app
```

One thing to remember: **`--since` refs resolve in the source repo**, not your
test repo. `--since v2.3.0` means the application's tag. If the ref does not
exist there, the error message says so.

### What makes this work

Impact analysis reads a `covers:` line that the generator writes into each spec:

```ts
// bolt: CHK-42
// covers: src/checkout/CheckoutForm.tsx, src/checkout/validation.ts
// app-commit: a3f21c9
```

Specs generated before this existed have no such line, so they appear under
**unknown impact** until regenerated. That is deliberate — calling them
unaffected would hide a gap rather than report one.

### 6.6 When the story changes, not the code

Everything above needs `source.path`. On a project where you were never given
the application code, `impact` has nothing to diff — but the **story** is still
something you can see change, and it is often the only thing you can.

This matters more than it first sounds. A spec written from a criterion that was
later reworded or retired **does not fail**. It passes, asserting a rule nobody
wants any more. Running the suite will never tell you; only comparing the
documents will.

**Step 1 — the developer or BA sends a revised story.** Overwrite
`inputs/stories/<ID>.md` with it. Nothing is lost: the kit snapshotted the
approved version at Gate 1.

> Given a file named something else, like `US-CLC-CUST-001-v2.md`? Rename it, or
> point at it with `--story "inputs/stories/US-CLC-CUST-001-v2.md"`. The tool
> will list near-miss filenames but will never pick one for you.

**Step 2 — see what moved:**

```powershell
pw-aidlc story-diff US-CLC-CUST-001
```

```
Story drift — US-CLC-CUST-001
  · now:      inputs/stories/US-CLC-CUST-001.md
  · baseline: bolts/US-CLC-CUST-001/story.snapshot.md
  ! 3 of 5 acceptance criteria moved
  ·   ~ AC-3→AC-2 reworded → tests/e2e/US-CLC-CUST-001/postcode.spec.ts
  ·   + AC-4 added → no coverage
  ·   - AC-2 (was) removed → tests/e2e/US-CLC-CUST-001/customer-create.spec.ts
  ·   1 renumbered (text identical — not a change)
  ! test-cases/US-CLC-CUST-001.md was written from an older version of this story

  ✓ results/story-diff-US-CLC-CUST-001.md
```

Read that as: one spec asserts a rule that has changed, one new criterion has no
test at all, and one test covers something the story no longer asks for. The
renumbered one is noise and is labelled as such.

**Step 3 — update the tests, in Claude Code:**

```
/revise US-CLC-CUST-001
```

It stops **once**, with the drift, the exact edit it proposes for each
criterion, what to do about the retired one, and — because the sheet is stale —
whether to update `test-cases/` too. Approve, and it edits only the affected
specs and runs only those.

> **Say no to the test-case question and the specs are still updated.** They are
> generated from the story, not from the sheet. The sheet is reported as
> known-stale and the revision carries on.

**Step 4 — confirm the loop closed:**

```powershell
pw-aidlc story-diff US-CLC-CUST-001
```

Must now say **current** and exit 0. If it still reports drift, the snapshot was
not refreshed and every future check will keep reporting the same thing.

#### What this costs

Far less than a re-run of `/bolt`, deliberately:

| What moved | What it does | Browser |
|---|---|---|
| a reworded criterion, same screen | edits the assertion and the plan line above it | **none** |
| a reworded criterion, new element | one scoped live check | one short session |
| a new criterion | explore → plan → generate, for that one criterion | one session |
| a retired criterion | reports it. Never deletes anything. | none |

Locators were verified live at the original Gate 1 and recorded in `plan.md`, so
a wording change does not require re-exploring the app. Past about five drifted
criteria it tells you this is a re-plan and sends you back to `/bolt`.

#### If a bolt predates this feature

It has no snapshot. `story-diff` falls back to `plan.md`'s coverage table, says
so, and refuses to claim rewordings from it — the planner had already summarised
those criteria, so any comparison would report a difference every time. One
command fixes it permanently:

```powershell
pw-aidlc story-diff US-CLC-CUST-001 --snapshot
```

#### Git is not required

The baseline is a literal copy at `bolts/<ID>/story.snapshot.md`, not a git ref.
A team that edits a story with no commit and no remote gets exactly the same
result — which is the normal case on a client machine.

---

## Setting up another project

Machine setup (Part 1) is done forever. Per project you still need Playwright,
because **it is a local devDependency, not a global tool** — every repo needs its
own copy and its own `.claude/agents/`.

### The one-command version

```powershell
cd C:\AI-SDLC-Playwright
.\playwright-aidlc-kit\scripts\new-project.ps1 -Name OrdersUI -Mode brownfield -Url http://localhost:3000 -Src src
```

macOS / Linux:

```bash
./playwright-aidlc-kit/scripts/new-project.sh OrdersUI brownfield http://localhost:3000 src
```

That does: git init, npm init, install Playwright + chromium, write
`playwright.config.ts`, install the three agents, scaffold the kit, remove the
unused `specs/` folder.

Then you only do the parts that are actually yours:

1. Stories → `inputs\stories\`
2. Requirements → `inputs\requirements\`
3. Credentials → `.env.local` (skip for greenfield)
4. Make `tests\seed.spec.ts` real (skip for greenfield)
5. `pw-aidlc doctor`
6. `code .` → `/bolt <ID>`

### The manual version

If you'd rather not use the script, or you're adding the kit to an **existing**
repo that already has Playwright:

```powershell
cd C:\path\to\existing-repo
npx playwright init-agents --loop=claude          # if .claude\agents is missing
pw-aidlc init MyProject --mode brownfield --url http://localhost:3000 --src src --yes
```

For an existing repo, check Playwright is 1.56+ first (`npx playwright --version`)
— the official agents don't exist below that. `pw-aidlc init` never overwrites an
existing config without `--force`, and it writes `.gitignore` before anything
else, so it's safe to run against a live repo.

---

## What's global vs per-project

| | Where | How often |
|---|---|---|
| Node / npm | machine | once |
| The kit + `npm link` | machine | once |
| `pw-aidlc` command | machine | available everywhere after `npm link` |
| **Playwright** | **project** (`node_modules`) | **every project** |
| **`.claude/agents/`** | **project** | **every project** |
| `.claude/skills/`, config, folders | project | every project (`pw-aidlc init`) |
| Stories, requirements, credentials | project | every project |
| `knowledge/org/` baseline | copied per project | edit centrally, re-copy with `--force` |

The common misconception: "Playwright is installed, so I can skip it next time."
It isn't — it lives in each project's `node_modules`. Same for the three agent
definitions, which `init-agents` writes into the project's `.claude/agents/`.

---

## Common stumbles

**`pw-aidlc: command not recognized`** — `npm link` didn't take, or you moved the
kit folder afterwards. Re-run `npm link` from the kit folder. If your machine
blocks global links, use the full path instead:
`node C:\AI-SDLC-Playwright\playwright-aidlc-kit\bin\pw-aidlc.mjs <command>`.

**PowerShell won't run `new-project.ps1`** — execution policy. Either
`powershell -ExecutionPolicy Bypass -File .\new-project.ps1 ...` or run the
manual commands.

**Claude Code ignored the gates** — `CLAUDE.md` is missing the kit section, or you
opened a file instead of the folder. `pw-aidlc doctor` checks the first; the
second shows up as Claude not knowing what mode the project is in. This fails
*silently*: you get a normal-looking agent with no governance, which is worse
than an error.

**`.claude\agents` is empty** — `init-agents` didn't complete. Re-run
`npx playwright init-agents --loop=claude` and check for errors. Needs
Playwright 1.56+.

**Doctor says stories are missing but the file is there** — check the extension.
It looks for `.md`, `.txt` or `.json` in `inputs/stories/`. A `.docx` doesn't
count, by design.

**The plan invented behaviour that doesn't exist** — thin story, no source
grounding. In brownfield, confirm `source.path` is set and `pw-aidlc context`
produced a real file. In greenfield this is the known trade-off: documents are
all it has.

**The bolt takes forever to reach Gate 1** — almost always source grounding over
too large a tree. `pw-aidlc doctor` now prints the resolved depth and the file
count. In order of effect:

1. Narrow it: set `scope.source_paths` in the bolt's intake, or
   `pw-aidlc context --depth deep --paths "src/checkout/**"`. Deep over one
   subtree is usually faster *and* better than scan over everything.
2. Drop `source.grounding` to `scan` in `e2e.config.yml` — the default, and
   enough for most bolts.
3. Add `--if-stale` so an unchanged tree is not rescanned.

**A question was asked that nobody on the team could answer** — that is a bug in
the question, not in you. Every question should offer concrete options and a
recommended default, and "Not sure — use your recommendation" is always available
and never blocks: it picks the default and surfaces it at Gate 1 as an
assumption. Reword the offending question in
`knowledge/org/interview-guide.md`; the skills read that file, so no skill needs
editing.

**Gate 1 takes too long to review** — the bolt was too big. Cap at 12–15
scenarios for high-risk areas. Past twenty minutes of review, split the next one.
