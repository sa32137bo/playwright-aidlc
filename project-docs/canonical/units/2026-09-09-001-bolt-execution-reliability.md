# Bolt Execution Reliability — 30 Minutes, Reliably

Scoped from the 9/15 MDUI/GHC target: "script writing bolt running in 30 mins or
less, reliably i.e. always 30 mins or less." This unit is about the
plan-through-heal pipeline for the script-writing bolt (`/bolt`) specifically —
not the test-case-writing bolt (already fast, no live app) or the migration bolt
(its own unit, static translation only in Stage 1).

**Narrowed, 2026-09-09 — the 30-minute target is Bolt B (a single-AC,
DRV-002-shaped bolt), not every bolt.** A CUST-001-sized multi-scenario bolt is
explicitly out of scope for this target. This matters: DRV-002's own real
timing (40 min in GHC run-4, 45 min in run-5) is now the number that matters,
not CUST-001's 92-minute run — the gap to close is real but roughly 1.5x, not
the 3x it looked like when this unit assumed both shapes needed to fit.

**"Reliably" is the harder half of this, not "30 minutes."** A bolt that's fast
nine times and blows the budget on the tenth is worse for a live demo than one
that's a consistent 35 — the goal is a number a person can commit to out loud
before running one, not a best-case figure.

## Groundwork confirmed before writing this unit

Checked directly against real MDUI bolt runs (CC and GHC run-4), not assumed:

- **Automation execution time is not the bottleneck.** Every real run's actual
  Playwright suite executed in under two minutes — CC CUST-001's full suite
  1.4–1.5m, CC DRV-002's 1.2–1.3m, GHC CUST-001's captured run 1.7m. If a bolt
  blows 30 minutes, it isn't the test run doing it.
- **Live exploration is the dominant, measured cost.** GHC run-4's audit has
  real clock timestamps: intake through `plan.md` written took **57 minutes**
  (18:18–19:15Z), of which **40 minutes** was live exploration alone
  (8 scripted passes). CC's audits don't log clock time at all, so its
  equivalent cost is unmeasured — itself a finding, see BR-1.
- **A known, unresolved bug directly threatens the budget.** Both CC and GHC
  workspaces carry `knowledge/project/mdui-known-flaky-areas.md` recording that
  the Playwright MCP browser tool hangs for **~30 minutes** on MDUI's
  multi-level menus. Every real run so far has avoided it entirely by using
  standalone Node scripts instead of the MCP tool for live exploration — a
  workaround, not a fix. Any future path that re-introduces call-by-call MCP
  navigation through that menu risks consuming the *entire* budget in one step.
- **Scope size is the one lever already proven to work.** DRV-002 (1 acceptance
  criterion, 5 exploration passes) was measurably cheaper than CUST-001
  (8–9 acceptance criteria, 6–8 exploration/generation passes) on every count
  available. Nothing here is a new idea — `e2e-plan`'s own 25-scenario cap
  already exists for a related reason (review quality) — but nothing today
  ties bolt *scope* to a *time* budget explicitly.
- **The measurement infrastructure needed to even know if this unit succeeded
  didn't exist until this session** — `skills/e2e-bolt/SKILL.md` and
  `skills/e2e-ship/SKILL.md` were just changed to log real ISO timestamps on
  every stage transition and on `<gate> presented` / `<gate> approved`
  separately (uncommitted as of this unit's creation). BR-1 depends on that
  fix having actually landed and been used in a real run.

---

## Epic: Measure Before Optimizing

---

### BR-1: Confirm real per-stage timing from the audit-log fix, on a real bolt

**Type:** reference
**Status:** proposed
**Epic:** Measure Before Optimizing

**As a** QA lead deciding whether this unit is working,
**I want** one real MDUI bolt run entirely under the new timestamp-logging
rules (`GATE 1 presented`/`approved`, `GATE 2 presented`/`approved`, a
timestamped `## Timeline` on every stage), with per-stage durations computed
directly from `audit.md`/`manifest.json` rather than estimated from run
summaries after the fact,
**so that** every other story in this unit has a real number to improve, and
"30 minutes" isn't measured by guesswork the way CC's run-4 audits were.

**Acceptance Criteria:**
- [ ] A real MDUI bolt (any story) is run with the timestamp changes to
      `e2e-bolt`/`e2e-ship` in place, and every stage transition in the
      resulting `audit.md` carries a real ISO timestamp — verified by reading
      the file, not assumed from the instructions being present.
- [ ] Per-stage duration (intake, context, plan/exploration, Gate 1 wait,
      generate, run, heal, Gate 2 wait) is computed and reported as a table —
      this is the baseline BR-2 through BR-5 measure against.
- [ ] If any stage still has no usable timestamp (an instruction followed
      inconsistently), that's reported as a finding here, not silently
      patched over in the reporting.

**Notes:**
- **Partial evidence already exists, 2026-09-09, predating the timestamp
  fix.** GHC's real `US-MDUI-DRV-002` run (Bolt B) independently carried
  enough clock precision (`audit.md`'s `[HH:MM]` entries, `manifest.json`'s
  own `gate1_approved_at`, and `results/`'s internal run timestamps) to
  compute a real span: `08:38Z` config-read to `09:18Z` final captured run —
  40 minutes, corroborating the team's own report. That's not this story
  done — it predates the `e2e-bolt`/`e2e-ship` instruction change, isn't a
  full per-stage breakdown (no separate generate/heal/run timestamps), and
  CC's equivalent run still has **zero** clock timestamps anywhere in its
  artifacts, so the cross-tool comparison stays one-sided. Still open: a
  bolt run genuinely produced under the new logging rule, on both sides.
- **Much richer evidence, 2026-09-09 (`aidlc-gitcopilot-run-5`), still independent of the shipped fix.** Two bolts, both with a full `[HH:MM]` timeline covering every stage — the first real per-stage breakdown seen, not just start/end. Neither this repo's timestamp-logging change nor the earlier `gate1_presented_at`/`gate2_*` manifest fields could have produced it: every push attempt this session has failed on a dead VPN, so nothing shipped here has ever reached the team. `manifest.json` in this run carries `gate1_approved_at` (the field the *original*, pre-session template already had) but not `gate1_presented_at` — confirms this is the team's own pre-existing discipline, not evidence of the new fields. Real per-stage numbers, both bolts:

  | Stage | US-MDUI-CUST-001 | US-MDUI-DRV-002 |
  |---|---|---|
  | Intake | ~1 min | instant (pre-existing `intake.yml`) |
  | Context | skipped | skipped |
  | Plan (incl. exploration) | ~46 min (25 min exploration) | ~27 min (20 min exploration) |
  | **Gate 1 wait** | **2 min** | **3 min** |
  | Generate | ~15 min | ~6 min |
  | Run + heal | 20 min (3 heal cycles) | 7 min (1 heal cycle) |
  | **Total** | **92 min** | **45 min** |

  Gate 1 wait itself is excellent both times (2–3 min, someone watching live) — a real, useful data point this unit didn't have before: the 30-minute problem is not human latency, it's bolt execution, exactly as BR-3's header framing already assumed but hadn't yet been measured this cleanly. Live exploration is again the dominant cost on both bolts, consistent with every prior run reviewed. Still open: this is evidence *for* the unit's diagnosis, not the AC itself — the AC asks for a run under the actual shipped instruction change, which still hasn't happened because nothing has pushed successfully yet.

---

## Epic: Reduce Live-Exploration Cost

The one cost every real run so far agrees is the largest.

---

### BR-2: Investigate the Playwright MCP browser tool's menu-hang bug

**Type:** tool
**Status:** proposed
**Epic:** Reduce Live-Exploration Cost

**As a** bolt author,
**I want** to know whether the ~30-minute MCP browser tool hang on MDUI's
multi-level menus is actually fixable (a timeout/config issue, a specific
menu-interaction pattern the tool mishandles) or is permanently
workaround-only,
**so that** this unit either removes the single largest time-risk in the whole
pipeline, or can stop treating "maybe it'll get fixed" as a plan and design
around it deliberately instead (BR-3/BR-5).

**Acceptance Criteria:**
- [ ] The hang is reproduced directly against the Playwright MCP tool (not the
      standalone-script workaround) on MDUI's Account & Customer Settings →
      Customer Actions → Driver IDs path — the exact menu already on record as
      triggering it twice.
- [ ] A real diagnosis is recorded — timeout configuration, a specific
      interaction sequence, a tool limitation with multi-level accessible-name
      concatenation (already noted as a testability defect in real audits) —
      not just "still hangs, moving on."
- [ ] A decision is recorded either way: fixable (with what change), or
      permanently workaround-only (and why) — this decision is what BR-5's
      guardrail design depends on.
- [ ] This story does not fix MDUI's own menu structure — that's the
      application's testability defect, already reported (D-4/D-1 in real
      audits). It fixes or characterizes the *tool's* behavior against it.

**Notes:**
- **Untried idea, flagged 2026-09-10, not yet actioned or turned into
  guidance:** `knowledge/project/mdui-known-flaky-areas.md`'s own fix for
  this hang is "perform the whole open-menu-and-click sequence as a single
  script/action instead" of separate tool calls — the standalone
  `.explore/*.js` script is offered as one way to do that, but a web search
  turned up that Playwright's official MCP server (`@playwright/mcp`, what
  `.mcp.json` here runs) also exposes a `browser_evaluate` tool that runs
  one function string atomically, in one call, inside the MCP session's
  own already-authenticated browser — which is a second way to satisfy
  that same "one script/action" fix, and one that costs zero additional
  sign-ins (the session is already live), unlike a standalone script which
  still pays for one sign-in per script. Deliberately **not** written into
  any skill as guidance yet: `browser_evaluate` runs raw JS in the page,
  not Playwright's locator API, which trades away the accessibility-based
  selector robustness `mdui.ts` is built on — plausibly fine for fixed
  connective navigation (open this exact menu), not a general substitute.
  This is exactly the kind of not-yet-measured idea BR-1's "measure before
  optimizing" principle argues against layering in immediately — worth
  investigating as part of this story's own reproduction work, not before.

---

### BR-3: Tie bolt scope to a time budget at Gate 1

**Type:** ux
**Status:** in-progress
**Epic:** Reduce Live-Exploration Cost

**As a** bolt owner approving Gate 1,
**I want** the plan to state an estimated total bolt time (not just "8 tests,
about 2 minutes to run" — that's suite execution time only, and real evidence
says it's not the bottleneck) and flag when the *planning-and-generation* cost
is likely to exceed 30 minutes, based on exploration-pass count and scenario
count,
**so that** "too big for the 30-minute SLA" is a decision made at Gate 1, in
writing, instead of discovered 40 minutes into a live demo.

**Acceptance Criteria:**
- [x] `e2e-plan`'s Gate 1 plain-English header (`skills/e2e-bolt/SKILL.md`)
      gains an estimated total time line, derived from BR-1's real per-stage
      baseline (exploration passes × observed per-pass cost, roughly), not
      invented — and clearly distinguishes this from suite execution time,
      which is already reported separately and is not the risk.
- [x] A plan whose estimate exceeds 30 minutes says so explicitly, with the
      likely cause (usually exploration-pass count) named, and suggests the
      DRV-002-style fix — narrowing to fewer acceptance criteria — as a
      concrete option, not just a warning with no next step.
- [x] This does not become a hard block — `e2e-bolt`'s non-negotiables already
      forbid a mode that skips Gate 1, and this unit doesn't add a second gate.
      It's information the human approving Gate 1 didn't have before.

**Notes:**
- **2026-09-09: instruction written into `skills/e2e-bolt/SKILL.md`'s GATE 1
  section**, including the explicit "these are two different numbers, never
  conflate them" framing between suite execution time and total bolt time.
  What's unverified: whether a real agent, given this instruction, actually
  produces a good estimate against real MDUI bolt sizes — that needs a live
  run to check, same gap as BR-1.

---

### BR-4: Reuse knowledge/project findings to skip redundant exploration passes

**Type:** tool
**Status:** in-progress
**Epic:** Reduce Live-Exploration Cost

**As a** bolt author,
**I want** `e2e-plan` to check `knowledge/project/*` for a navigation path,
locator, or field-level finding already recorded by an earlier bolt before
spending a live exploration pass re-discovering it,
**so that** a project's second, third, and fifth bolt get measurably cheaper
over time instead of paying the same live-exploration cost every run — the
exact effect already visible informally in CC's DRV-002 audit, which states
knowledge/project "materially shapes the plan," without this being a
formalized, checked behavior.

**Acceptance Criteria:**
- [x] Before a live exploration pass, `e2e-plan` checks whether the specific
      thing it's about to discover (a navigation path, a field's required-error
      behavior, a menu's accessible-name quirk) is already recorded in
      `knowledge/project/*`, and skips the live pass if so — citing the
      knowledge file rather than re-observing.
- [x] A knowledge/project finding used this way is still subject to the
      kit's own non-negotiable — if live behavior visibly contradicts it during
      generation, that's a discrepancy, not silently trusted stale knowledge.
- [ ] Measured on a real second bolt against the same MDUI project: fewer
      exploration passes than the first bolt needed for comparable scope,
      attributable to reuse — not asserted, checked against BR-1's baseline.

**Notes:**
- **2026-09-09: instruction written into `skills/e2e-plan/SKILL.md`.** The
  measurement AC needs a real second bolt run against a project whose
  `knowledge/project/` already holds findings from a first — not something
  this session can produce or fake.

---

### BR-7: Ship a pre-built MDUI framework, not just prose knowledge

**Type:** tool
**Status:** in-progress
**Epic:** Reduce Live-Exploration Cost

**As a** bolt author starting a *new* MDUI workspace,
**I want** `tests/support/mdui.ts` to arrive pre-populated with real,
live-verified navigation and locator helpers instead of empty,
**so that** exploration cost stops resetting to zero every time a new
workspace is provisioned — the gap BR-4 alone can't close, since
`knowledge/project/*` only accumulates *within* one workspace's own bolt
sequence, never *across* separately-provisioned workspaces (CC's vs GHC's,
or one GHC session vs the next).

**Acceptance Criteria:**
- [x] `mdui-framework/support/mdui.ts` built from real, cited sources —
      synthesized from five independently-run bolts (`aidlc-claudecode-run-4`,
      `aidlc-gitcopilot-run-4`, `aidlc-gitcopilot-run-4-boltb`,
      `aidlc-gitcopilot-run-5`), every locator copied verbatim from a
      live-verified `support.ts`, never invented — provenance in the file's
      own header. Strict `tsc --noEmit` clean.
- [x] One real, unresolved discrepancy between two independently-discovered
      `openDriverIds` implementations is flagged in code and in
      `mdui-framework/README.md`, not silently resolved by picking one and
      hiding the other existed.
- [x] Deployed by `scripts/unpack.ps1` (renamed 2026-09-10, formerly
      `provision-workspace.ps1`) — new Step 3 copy into `tests/support/mdui.ts`,
      documented in the script's own header the same way the
      `.mcp.json`/`.vscode/mcp.json` pair already is.
- [x] `e2e-plan` checks for a **callable helper** in the shared module before
      falling back to `knowledge/project/*` prose (BR-4) — updated
      `skills/e2e-plan/SKILL.md` to check code first, description second, and
      to promote a newly-discovered reusable helper to the shared module by
      default rather than leaving it bolt-local (the exact gap found in CC
      run-4's own `openDriverIds`, which stayed bolt-local and had to be
      rediscovered by GHC run-4-boltb and again by run-5).
- [~] Measured on a real bolt run (GHC run-6, 2026-09-10, both
      US-MDUI-CUST-001 and US-MDUI-DRV-002) — partially confirmed, partially
      not, see the dated note below. **Resulting-scripts reuse: confirmed
      strongly.** **Exploration-time reduction: not yet confirmed** — the
      mechanism that would have delivered it (calling `mdui.ts` from
      `.explore/*.js` instead of retyping it) was never exercised this run.

**Notes:**
- This is the concrete, buildable idea from the 9/15 exploration-time
  discussion — not a redesign, a packaging of what five real runs already
  independently proved works, shipped once instead of rediscovered five times.
- Deliberately kept as one file (`support/mdui.ts`), matching the real
  convention every source run already converged on independently, rather
  than a speculative multi-file structure nothing has asked for yet.
- **Expanded, 2026-09-09**, beyond the original single-file scope, after
  the user asked what else could (a) cut exploration time further and (b)
  make generated scripts simpler at runtime. Four more pieces, all real,
  all verified (strict `tsc --noEmit`, and — for `explore-harness.js`
  specifically — a real functional test: env-loading and redaction run
  against real fixture input in a scratch dir configured to match the
  actual deployed `"type": "commonjs"` context, not just syntax-checked):
  - `support/test.ts` — a drop-in `test`/`expect` that overrides the
    built-in `page` fixture to sign in automatically; generated specs keep
    the exact same `async ({ page }) => {...}` shape, zero syntax change.
  - `support/fixtures.ts` — dated, named constants for QA data facts
    multiple bolts have independently re-discovered live (a known-good
    licensee, a customer with drivers, `9999999999` vs `1234567890` for
    the unknown-customer-id fixture — run-5's own P-F finding).
  - `explore-harness.js` — env-loading, token redaction, and a snapshot
    writer for throwaway `.explore/*.js` scripts, so exploration only
    writes the new navigation, not boilerplate every prior run already
    wrote. One piece flagged honestly as unverified: reusing `mdui.ts`'s
    navigation helpers from this plain CommonJS harness needs a `tsx/cjs`
    require hook (documented in the file, `tsx` added to
    `mdui.package.json`) that has not been exercised against a live
    workspace.
  - `saveAndExpectPersisted`, `expectFieldError`, and a generalized
    `uniqueName()` added to `support/mdui.ts` itself — the first names the
    confirmed silent-save-failure product bug (P-A) in its own failure
    message rather than reading like an ordinary timeout; the assertion
    helper operationalizes `knowledge/org/assertion-catalog.md`'s own
    "assert the exact string when the string is the requirement" rule
    against MDUI's specific double-`.errorMssg`-node DOM shape, cross-
    checked against that file directly before writing it, not guessed. A
    second helper, `expectSubmissionBlocked`, was cut during the smell
    check below — it wrapped `toBeDisabled()` with no MDUI-specific
    handling, contradicting this same file's own stated principle.
  - `knowledge/project/mdui-locator-overrides.md`'s own "reusable
    framework" section was stale (referenced a nonexistent `openMenu()`
    helper) — rewritten to list everything above accurately, since that
    file, not this unit or the framework's own README, is what a bolt
    actually reads during intake/planning.
- **First real-world report card, 2026-09-10 (GHC run-6, both bolts, run
  before `scripts/pack.ps1`/`unpack.ps1` existed but after the framework
  itself shipped 2026-09-09)** — read directly, not taken from the audit's
  own self-report:
  - **Resulting scripts: strong pass.** All four generated spec files
    import `test`/`expect` from `support/test.ts` and 9-11 named helpers
    each from `support/mdui.ts`; both DRV-002 specs import
    `KNOWN_CUSTOMER_WITH_DRIVERS` from `support/fixtures.ts` directly into
    a `const CUSTOMER = ...`. Zero hand-rolled sign-in or duplicated
    locator logic in any final spec.
  - **`fixtures.ts` as a starting hypothesis: confirmed working as
    designed.** Both bolts' `## Assumptions` cite `fixtures.ts` by name and
    re-verify rather than blindly rediscover (`"Re-verified live during
    exploration rather than assumed (fixtures.ts, dated 2026-09-09)"`).
  - **Exploration-time reduction: did not materialize this run, and the
    reason is now understood precisely.** Zero `.explore/*.js` scripts
    `require()` `support/mdui.ts` — all 15 hand-retype their own sign-in
    and locators from scratch. `.explore/drv-01-open.js`'s hand-copy of
    `openDriverIds` matches `mdui.ts`'s real implementation almost line for
    line (down to matching comment reasoning), so the *knowledge* reuse
    worked — the agent read and correctly reproduced the known-good
    pattern — but the *mechanical* reuse (actually calling it) did not,
    because the `tsx/cjs` interop was still documented as unverified at the
    time, so nothing pointed the agent at it as a real option.
  - **A second, independent cost found and fixed**: every one of those 15
    `.explore/*.js` scripts signs in through Okta separately (~25s each,
    per `playwright.config.ts`'s own measured figure) — roughly 5-6 minutes
    of pure repeated-login overhead in this one run, for zero benefit.
    Checked whether `storageState` could amortize this before recommending
    anything: it can't — `playwright.config.ts` already has a measured
    finding that a restored `storageState` context loses its Okta SSO
    cookie and gets silently signed out within seconds, which is why the
    real suite signs in fresh per test today. That finding is about
    *restoring* a session in a new process, not about one continuous
    session doing several steps — so the fix is batching passes into fewer
    script runs, not storageState.
  - **The `tsx/cjs` interop was de-risked, not just left flagged.** Tested
    in an isolated sandbox (no live MDUI app available): a plain CommonJS
    script requiring a stand-in file with `support/mdui.ts`'s exact import/
    export shape got back real, callable functions and a correctly-
    preserved `RegExp` constant via `require('tsx/cjs')`, with no build
    step. The module-loading risk the README flagged is resolved; calling
    a loaded function against a real live `page` is still unverified
    (needs an actual workspace), and both files say so precisely rather
    than claiming more than was tested.
  - **Actioned as a result** (same session): `mdui.ts`'s `openDriverIds`
    discrepancy comment updated from "unresolved" to resolved (run-6 itself
    re-verified live which version holds — that just hadn't flowed back);
    `explore-harness.js` and the framework README updated to point at the
    verified interop instead of calling it unverified; `skills/e2e-plan/
    SKILL.md` given a concrete "call it via `tsx/cjs`, don't retype it"
    instruction plus a new "batch exploration passes, one sign-in per
    session" section with the measured reasoning inline; `skills/e2e-bolt/
    SKILL.md`'s timestamp requirement given a real negative example (DRV-002's
    own `audit.md` has zero timestamps anywhere in its Timeline, while
    CUST-001's — same run, same day — has one on every line), since the
    existing instruction alone was not enough to prevent this exact gap
    once. A stray `provision-workspace.ps1` reference in `mdui.ts`'s own
    header (pre-dating this session's rename to `unpack.ps1`) was also
    fixed while in the file.
  - **Still not measured**: whether any of this actually reduces
    exploration wall-clock time. That needs a next real bolt run, with the
    interop actually used and every timestamp present, to compare against.

---

## Epic: Guardrail the Budget

---

### BR-5: A stage-level time guard during exploration

**Type:** tool
**Status:** in-progress
**Epic:** Guardrail the Budget

**As a** bolt author,
**I want** live exploration to report elapsed time as it goes and stop to say
so once it's consumed a large share of the 30-minute budget, rather than
running silently for 40+ minutes the way GHC run-4's did,
**so that** a bolt that's going to blow the budget is visible while it's
happening, not only in hindsight from the audit log.

**Acceptance Criteria:**
- [x] Depends on BR-2's finding: if the MCP hang is fixed, this guard is a
      simple elapsed-time check; if it's permanently workaround-only, this
      story also has to bound the standalone-script exploration pattern
      itself, not just the MCP tool path. **Resolved by not depending on
      BR-2 at all** — the instruction added to `skills/e2e-plan/SKILL.md` is
      "state your own elapsed time," which the agent can do regardless of
      whether exploration is happening through the MCP tool or a standalone
      script. Whichever BR-2 finds, this guard already covers it.
- [ ] A soft threshold (~20 minutes into exploration) triggers a visible
      status line — not a hard stop. **Partially done:** written as a fixed
      number in the skill instruction, not an actual `e2e.config.yml`
      setting — "configurable" overstates what exists today. Left unchecked
      for that reason; making it a real config field is small remaining work
      if the fixed default proves wrong in practice.
- [x] Never silently extends the budget or hides the overrun in the eventual
      audit log — already true by construction once BR-1's timestamp logging
      is in place; a 45-minute bolt's `audit.md` timestamps say so whether or
      not this story's own status line fired.

---

## Epic: Validate

---

### BR-6: Five consecutive real Bolt-B-shaped MDUI bolts, each under 30 minutes end to end

**Type:** ux
**Status:** proposed
**Epic:** Validate

**As a** QA lead deciding whether this unit is done,
**I want** five real MDUI bolts, each scoped like `US-MDUI-DRV-002` (single
acceptance criterion, no multi-step journey) — **not** a CUST-001-sized
multi-scenario bolt, explicitly out of scope for this target as of 2026-09-09
— run end to end (intake through Gate 2, not just suite execution) with real
timestamps, all landing at or under 30 minutes,
**so that** "reliably" is demonstrated across five real Bolt-B-shaped runs,
not one lucky one.

**Acceptance Criteria:**
- [ ] All five runs use BR-1's timestamp logging; the actual per-stage numbers
      are reported, not just a pass/fail against 30 minutes.
- [ ] Each run is scoped to one acceptance criterion, the same shape as
      `US-MDUI-DRV-002` — real evidence already shows this shape at 40–45
      minutes twice (GHC run-4, run-5), the actual gap this story has to close.
      A CUST-001-sized multi-scenario bolt is out of scope for this target;
      do not hold this story to it.
- [ ] Any run that exceeds 30 minutes is diagnosed against this unit's other
      stories (was it the MCP hang, no knowledge reuse, exploration-pass count)
      rather than dismissed as a one-off.
- [ ] Gate 1 human-wait time is **excluded** from the 30-minute figure and
      reported separately — that's real human latency (GHC run-4's Gate 1 sat
      overnight), not something this unit can or should control.

---

## Closing this unit

- [ ] Every story above is `done`, `descoped`, or `parked`.
- [ ] BR-6 has actually run — a guardrail nobody has exercised against five
      real bolts has not demonstrated "reliably."
- [ ] `DEMO-RUNBOOK.md` states the real, evidenced time budget for a demo bolt,
      not an aspirational one.
- [ ] Rename this unit with the `[closed]-` prefix only once the above is true.
