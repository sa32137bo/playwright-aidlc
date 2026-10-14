---
name: e2e-plan
description: Explore a running web application in a real browser and write a reviewable Markdown test plan grounded in both the live UI and the application source code. Use when the user wants a test plan, test scenarios, test cases, or E2E coverage designed before any code is written, or when the e2e-bolt workflow reaches its planning step.
license: Proprietary
---

# Test Plan (Inception)

Output: `bolts/<ID>/plan.md`. Human-readable, precise enough to generate from. No code.

## Delegate, do not reimplement

If `.claude/agents/playwright-test-planner.md` exists (created by `npx playwright init-agents --loop=claude`), **use it**. Microsoft maintains that agent against the current Playwright tool surface; hand it the seed test, the app URL and the context below rather than driving the browser yourself.

If it does not exist, tell the user to run `npx playwright init-agents --loop=claude`, then explore directly with Playwright MCP or `playwright-cli`.

## Before another live exploration pass — check for reusable code first, then knowledge/project

Live exploration is consistently a bolt's most expensive part, far larger than suite execution. Before spending a pass to discover something, check, in this order:

1. **A shared support module** (e.g. `tests/support/clc.ts`, or the project's equivalent), when one exists. If a navigation path or interaction is already a *callable function*, call it instead of re-deriving the clicks live; a written description still costs re-deriving and re-verifying.

   From a plain CommonJS `.explore/*.js` script (see `explore-harness.js`, when provisioned), **call the shared module, do not retype it**: `require('tsx/cjs'); const { someHelper } = require('../tests/support/clc.ts');`. One limitation: a helper built on `page.evaluate` cannot be called this way (see `explore-harness.js`'s bottom-of-file note and `knowledge/org/exploration-notes.md`). (GHC run-6: a helper was hand-copied into an exploration script instead of called, risking silent drift.)

2. **`knowledge/project/*`**, for everything not yet promoted to code: exact required-field messages, menu quirks, locator overrides. If it is recorded there, cite the knowledge file in the plan instead of re-observing it live.

This does not replace verification. If live behaviour contradicts a knowledge/project finding, or a helper's assertion fails as if the app changed, report a discrepancy; never trust stale knowledge or code over what you just observed. Skip re-*discovering*, not checking.

**When generation resolves something new and genuinely reusable (not specific to this bolt's scenario), add it to the shared module, not just this bolt's file.** An `openX` function kept local saves the next bolt nothing.

## Batch exploration passes — sign-in cost is real and does not amortize across script runs

Sign-in costs real time (~25s for an SDK-driven IdP widget on one project, ~7s for a form login on another; this project's figure is in `playwright.config.ts`'s timeout comment). Whether `storageState` amortizes it across separate script runs is app-specific: check `playwright.config.ts`'s note before assuming either way. That question is about *restoring* a session in a new process, never about one continuous session.

**Write one exploration script that signs in once and walks through several related steps in that session (several `dump()` calls, several navigations), not one script per step.** Start a fresh script only for a genuinely separate investigation. (GHC run-6: 15 separate `.explore/*.js` files, each signing in, ~15 × 25s of wasted login.)

**Dump a full inventory of a screen the moment you arrive, before interacting with anything:** every placeholder, every accessible name, every field's enabled/disabled state, **and whether any list or grid is paginated (a result count, a page control, an "N of M" summary)**. A batched pass that fails partway re-pays the whole journey, and a snapshot of visible rows cannot show pagination. With `explore-harness.js`, call its `dumpPager()` unscoped on arrival; it says when a "no match" is inconclusive. (GHC run-11: one journey re-run four times for three locator issues one snapshot would have shown. Bolt `US-CLC-003`, 2026-09-20: an unnoticed "1 - 10 of 108 items" grid survived three heal attempts.)

**A write performed during exploration becomes a fixture the next run depends on.** Record every exploration write as an assumption in the plan, like a deliberately chosen QA fixture: what was created, and why the scenario needs an existing record rather than creating its own. (Bolt `US-CLC-003`, 2026-09-20: an early exploration record later collided with a generated spec.)

**When a create/submit flow ties its record to a specific business entity (a crew member, a hotel, an account) and the app has no visible delete path, probe once during exploration whether a SECOND submit for the same entity saves — before Gate 1, not after.** Repeat the same submit immediately, same entity, and read the result. A single-use-per-entity limit is a product constraint no test change can fix; found during healing it costs a full generate→run→heal cycle. Found here, the plan states it as a known constraint (and the Gate 2 checklist's "not achievable — product constraint" outcome) from the start. State a negative result ("saved twice, limit does not apply") as a checked fact too. (Bolt `US-CLC-002`, 2026-09-22: exploration's one submit used up the only attempt; 3 heal-bound attempts burned.)

**If the second submit fails for a reason unrelated to the entity, the probe did not run — re-probe, do not record the result.** Before writing "confirmed reusable" or "confirmed single-use", confirm the second attempt was a fair repeat of the first. (Bolt `US-CH-MENT-001`, 2026-09-22: the form cleared after submit, so the "repeat" submitted an empty form.)

**After two failed attempts at the same interaction, stop varying it and instrument it instead.** Switch from guessing to reading what is happening — a network capture, a DOM dump — as `e2e-heal` does with "classify before repairing". (Bolt `US-CLC-002`, 2026-09-21: four guessed retries failed; one network capture found a widget request-ordering bug.)

**A discrepancy cited once in a plan must be applied everywhere in the plan it is relevant.** A read-back will not catch the gap, because the citation is in the text. Before approving a plan, re-check every cited discrepancy against every step that touches the same data or control. (Bolt `US-CLC-002`, 2026-09-21: pagination was honoured when choosing a hotel, then ignored when verifying the save.)

## Elapsed-time awareness during exploration

State your elapsed exploration time out loud once it passes roughly 20 minutes, so anyone watching sees a time budget at risk before Gate 1, not only afterwards in the audit log. This is a visibility signal, not a hard stop — do not abandon a pass mid-way because of it.

## Mode changes what you do

| Mode | How you plan |
|---|---|
| `greenfield` | No live app. Plan entirely from stories, requirements and (if it exists) source. Mark every locator expectation as unverified. Report discrepancies **only if you have two sources to compare** — a story and a requirements document can disagree, and that is worth surfacing. |
| `brownfield` | Both sources. Explore the live app through the seed test, cross-check against `context/app-context.md`, and report every disagreement. |
| `characterization` | No stories. Explore the app and describe what it does. Organise by user journey. **Do not call anything a bug** — you have no requirement to judge against. Record surprising behaviour under `## Observations for the team` instead. |

## What you feed it

Three things, in this order of authority:

1. `context/app-context.md` — what the code says should happen
2. the bolt's `intent` and `acceptance_criteria` — what the business asked for
3. the live application at `app_url`, entered through `seed_test`

The seed test runs global setup, fixtures and auth, and every generated test follows its shape. Explore *through* it, never around it.

## HARD LIMIT — how much source you may read

**Read the `code_grounding:` field in the front matter of `context/app-context.md` before planning anything.** It states the depth this bolt was given, and it binds you.

| `code_grounding:` | What you may read |
|---|---|
| `deep` | `app-context.md` **and** the source files it references |
| `scan` | **`app-context.md` only.** Do not open source files |
| `off` | The live application only |

**At `scan` and `off`, opening source files is a defect, not diligence.** The depth was chosen deliberately, usually for speed; a bolt that exhausts its limit before Gate 1 has produced nothing.

If `app-context.md` has no front matter or no `code_grounding:` field, treat it as `scan` and say so in the plan.

**This is a code-reading limit only.** `code_grounding: off` does not mean skip Knowledge Assistant; `e2e-intake` step 4a evaluates that on its own gate before this skill runs.

### When you need something you were not given

At `scan` you will not have validation logic, state machines, authorization rules or async behaviour. That is expected. Do **not** read the source to fill the gap. Instead:

- plan from what the scan gave you — routes, test IDs, form fields, API calls and the **exact user-facing strings**, which is enough for real coverage of most flows
- put what you could not determine under `## Open questions`, naming the surface
- state in the plan that a deeper pass would add validation-rule coverage, and how to get it: re-run with `--depth deep`, or mark the bolt `risk: high`

An honest plan with a named gap is a good Gate 1 outcome; the reviewer can approve a deeper pass in one line. Do not burn the session closing it yourself.

## When test cases already exist — reconcile, do not re-plan

If the intake records `test_cases:`, a human has already written and approved the
specification. **Do not invent scenarios.** Each test case becomes one scenario,
keeping its ID, and `plan.md` becomes a **reconciliation report** — the thing a
test-case sheet has no room for.

Lead the plan, and Gate 1, with what is *missing*. "14 test cases → 14 scenarios ✓" gets approved
without thought. Open with the gaps:

```markdown
## Reconciliation — test-cases/US-CLC-CUST-001.md

**3 things need your attention before the rest is worth reading.**

| Gap | Detail |
|---|---|
| AC-6 has no test case | server-side pricing rule — no case covers it, and none can from the UI |
| TC_CUSTCREATE_009 cannot be automated | needs a real email inbox. Marked `Automation Candidate: No` and excluded |
| TC_CUSTCREATE_004 assumes a step that is not written | it opens a customer without saying how one is selected. I added the search step and am telling you |

Then: 14 cases → 13 scenarios, 1 excluded.
```

Four obligations:

1. **Every acceptance criterion → the test case covering it, or the gap.** Sheets
   written from a story follow the happy path, so missing negatives and error states
   are the norm. This is the most valuable thing you produce here.
2. **Respect `Automation Candidate: No`.** List those cases, do not plan scenarios
   for them, and say why each was excluded. They remain valid manual tests.
3. **Declare every step you add** (navigating, waiting, dismissing a banner).
   Silently expanded steps make the specs disagree with the sheet the QA team governs.
4. **Do not silently improve a case.** If an expected result is unassertable
   ("the record is saved"), raise it as an open question; a rewrite stops testing
   what the approved sheet says.

Everything else in this skill still applies — discrepancies, grounding depth,
open questions and the locator worksheet all live in `plan.md`.

## Coverage obligation

Every acceptance criterion gets at least one scenario, or an explicit line saying why it is not covered by an E2E test (many belong in unit tests — say that rather than padding the plan).

**Before excluding a symptom as "not testable", look for an independent reference:** another screen or field that records the same fact, so the vague symptom becomes a comparison. Check `knowledge/project/` and the shared support module for one, and name what you checked in the exclusion's "Why" (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: "some show just one crew" was excluded, though the Reservation Detail Report's Occupancy column made it testable).

Beyond the happy path, plan from **what `app-context.md` actually contains** for:

- each validation rule **it records**, asserting the exact message given there
- each state the screen can reach — including empty and error, which exploration alone will not find
- each non-2xx response class the UI handles, driven by route mocking rather than by breaking the backend
- each role that sees a different control set
- boundaries recorded in the context: max lengths, numeric limits, required combinations

At `scan` several of those will be absent. Cover what is there, list the rest as open questions, and move on.

Do not plan scenarios for behaviour you could not confirm in either the context file or the live app. Speculative coverage, which asserts your guesses, is worse than none.

## Discrepancies

A discrepancy is **any two sources of truth disagreeing**, not only code versus a
running app. What you can compare depends on the mode:

| Mode | Sources | Typical finding |
|---|---|---|
| `brownfield` | code, live app, story | a validation rule that does not fire |
| `greenfield` | story, requirements document, extracted screenshots | an acceptance criterion that contradicts the process document |
| `characterization` | the app alone | nothing to compare — use `## Observations for the team` |

Do not skip greenfield discrepancies: a story calling three flows "identical" when
the process document gives one an extra mandatory field yields one test where three
were needed, and is caught at Gate 1 or never.

When the code and the live app disagree — a validation rule that does not fire, an error message that differs from the string in source, a state the code can produce but the UI never shows — do not resolve it yourself. Write it into `## Discrepancies` in the plan and in the bolt state file. These are often real bugs; surfacing them at Gate 1 is a main return of this approach.

**Compare only what you were given.** At `scan` the comparison is between `app-context.md` and the live app — exact message strings, test IDs, form fields and routes. Deeper logic conflicts are out of reach, and the plan must say so:

```markdown
## Discrepancies (code vs live app)
> Grounding: scan — comparison covers strings, test IDs, form fields and routes.
> Validation logic, state machines and authorization were not derived, so
> conflicts in those areas would not appear here.
```

Never open source files to hunt for more. A stated limit is honest; an exhausted session is not.

## Before calling a flow blocked

A control that looks disabled or unresponsive is not automatically a bug. First check for a second, different-looking instance of it (e.g. a disabled read-only summary copy beside an enabled inline-edit copy). Clicking a permanently-disabled element hangs for the full idle timeout, which looks like a blocked flow. Confirm the control you used is the live one — enabled, in the active form, not a decorative duplicate — before writing a discrepancy that says a flow is unreachable.

Apply the same re-check to a "blocked" finding reported back by `.claude/agents/playwright-test-planner.md` before it goes in the plan.

## Before writing that a UI element is absent

A plan may not state that something does not appear — a toast, a message, an element — unless the same exploration session either (a) observed the contrary state present, so the two can be compared, or (b) checked for it with a selector derived from a live DOM read of this specific screen, not a generic list of likely candidates. "I looked and did not find it" is not "it is not there". (Bolt `US-CLC-001`, 2026-09-17: generic toast selectors missed `.custom-toast`; "no message appears" reached Gate 1 as fact.)

**`page.evaluate` reads are existence checks, not visibility checks** (`knowledge/org/locator-policy.md`, "Existence is not visibility"). Neither "it isn't there" nor "it's there after all" may go into a plan, or to the owner, on an `evaluate` read alone.

## Before Gate 1 — open every in-scope screen at least once

**Every screen, report or flow the plan puts in scope must have been opened, and driven to its first real output, at least once before Gate 1.** One smoke pass per screen is enough: navigate there, submit or search with plausible input, and record what came back (a grid, a form, an error, an empty result). Batch the smoke passes into one script. This is a hard rule, not an efficiency suggestion. (Bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: one of five reports verified; the other four failed, and Gate 1 was re-presented, ~20 minutes lost.)

**Record each screen's output as you actually saw it:** the column headers exactly as the grid or export shows them, and how the thing under test appears in them (for example, "a shared room shows as two IDs in one cell, `123456/12345`"). Sibling screens in one module do not share a layout. Generation writes checks from this record alone (see `e2e-generate`, "Never assert on output nobody has seen").

If a smoke pass shows a screen is broken — an error, or no data — follow "Before calling a screen broken" below before writing anything. At Gate 1 the owner decides whether a broken screen gets a red test, a `test.fixme`, or nothing, and needs the screen opened and its cause isolated to decide.

If time genuinely does not allow it, the Gate 1 header must list each unopened screen by name as the **first** "thing I want you to look at", not an open question further down.

## Before calling a screen broken — isolate the cause

"I ran it and it errored" tells you about your input, not yet about the screen. A plan may call something a **product defect** only after one of these:

1. **It was bisected from a working input.** Start from input known to work (`test_data:` in `intake.yml`, the ticket's own reproduction values, or the narrowest combination the screen accepts). Then widen **one filter at a time** until it breaks. The last change before it broke is the finding, e.g. "errors when Hotel is blank" rather than "does not load".
2. **A domain expert confirmed it** does not work for input they know should work.

Changing only the filters the story mentions does not count. **Every filter on the screen is a variable**, including ones left on a broad default such as "All Stations" or a blank hotel. If neither 1 nor 2 is possible within the bolt, write it as **"no output yet, cause not isolated"**, list the filters never varied, and put it first in the Gate 1 header. Do not call it a defect. (Bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: four reports called defects after varying only airline and month; all loaded next day with station and hotel set.)

## Test data comes from intake, not from exploration

For any scenario over data the tests did not create, the plan carries a **test data table**, one row per screen: the named slice or every filter value, the source (slice, ticket, domain expert, or `bolt-chosen (unverified)`), and what the result must contain. Take it from `test_data:` in `intake.yml` (see `e2e-intake` step 5a); cite a slice by name, never by copying its values.

Two checks during exploration, both before Gate 1:

- **The input returns output.** It does not error, and it is not empty.
- **The output contains the condition under test.** A bug re-test about shared rooms needs shared-room rows in the result; a window with only single rooms proves the report loads and says nothing about the bug. If the input lacks the condition, that is a Gate 1 item ("the data I have cannot show this bug either way"), not something to paper over with a vacuous pass. (Re-check after bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-25: supplied known-good inputs loaded all five reports, but three had no shared-room rows.)

## A filter the story depends on — verify it actually filters

When a scenario relies on a filter (an airline, a station, a date window) narrowing the output, confirm during exploration that it does — read a column that should reflect the filter, or compare two filter values. Never infer it from the control showing the right value. This applies to a screen's own filters (read the station and hotel columns back), not only the global ones. **A global selector does not mean the screen's own filters are set:** open the screen's filter panel and set every filter there to the test-data value, even when the header already shows it. Only a screen that stays unscoped *with its own filters set* ignores them, and that belongs in `## Discrepancies`. (Bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24/25: a 5J session's report showed Airline Id `OY` because the report's own Airline filter was empty, and it was filed as an airline-scoping defect.)

## Format

```markdown
# <App / feature> — Test Plan
Bolt: <ID>  |  Seed: tests/seed.spec.ts  |  App: <url>  |  Context: context/app-context.md

## Application overview
<2–4 sentences on what this surface does>

## Coverage of acceptance criteria
| Criterion | Scenario(s) | Notes |

## Test scenarios

### 1. <Group>
#### 1.1 <Scenario title>
**Priority:** smoke | regression
**Preconditions:** <state, data, role>
**Steps:**
1. <one user-visible action per line>
**Expected results:**
- <one observable, assertable outcome per line>
**Source:** <where the rule came from — cite app-context.md, or file:line only if
             you were given `deep` and actually read it. Omit rather than guess.>

## Not covered by E2E
| Behaviour | Why | Where it should be tested |

## Discrepancies (code vs live app)
| Code says | App does | File | Impact |

## Assumptions
```

## Style rules for steps

Write what a user does and sees, never how Playwright does it. `Enter "abc" in the email field` — not `page.fill('#email', 'abc')`. No selectors, no API names, no code. A locator guessed at plan time is one the generator will trust and get wrong.

Keep expected results observable. "The order is saved" is not assertable. "A success banner reads 'Order #1234 created' and the row appears in the orders table" is.

## Size

Cap a single plan at about 25 scenarios. Beyond that, split the bolt — review quality collapses on long plans, and Gate 1 is the gate that matters most.
