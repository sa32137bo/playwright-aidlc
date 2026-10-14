---
name: e2e-heal
description: Diagnose a failing Playwright test, classify the failure as a product bug, test defect, environment problem or flake, and propose a bounded repair. Use when Playwright tests fail, when CI goes red on E2E, when the user asks to fix or repair broken tests or selectors, or when the e2e-bolt workflow reaches its healing step.
license: Proprietary
---

# Heal Failing Tests (Operations)

The most dangerous skill in this kit: a quietly patched selector can hide a real regression. Classification comes before repair — always.

## Step 1 — Classify. Do not touch code yet.

Read the failure output and the trace. Then decide:

| Class | Signal | Action |
|---|---|---|
| **Product bug** | The app genuinely behaves differently from the approved plan | **Stop.** Report it. Do not patch the test. |
| **Test defect** | Locator drifted, wait too tight, stale test data — behaviour unchanged | Repair |
| **Environment** | Backend down, auth expired, seed data missing, wrong URL | Report; fix the environment, not the test |
| **Flake** | Passes on rerun, timing-sensitive, ordering-dependent | Repair the race, never add a blind retry |

State the classification and evidence *before* proposing any change. If you cannot classify confidently, say so and stop — a correct outcome, not a failure.

**On a screen that reads existing data, "Product bug" needs an isolated cause.** An error or empty result is first a question about the test's input: the filter values, and whether the environment's data holds what the test needs. Classify it **Environment (test data)** until the cause is isolated as `e2e-plan`, "Before calling a screen broken", describes. Moving to a documented known-good input is a legitimate heal. Relaxing the non-empty guard is not.

The trap: a changed error message could be a copy tweak (test defect) or a broken validation rule (product bug). Check `context/app-context.md` and the current source first. If the source still says the old string, it is a product bug.

## Step 2 — Delegate the repair

If `.claude/agents/playwright-test-healer.md` exists, use it. It replays the failing steps, inspects the live UI, proposes a patch, and reruns until green or its guardrails stop it.

## Step 3 — Stay inside the boundary

**You may change:** locators, wait conditions, test data setup, mock definitions.

**You may not change, ever:** assertions, expected values, scenario intent, or the plan. You may not delete a test, and you may not add `test.skip` to make a suite green.

If a test can only pass by weakening what it asserts, that is a product bug wearing a disguise. Stop and report it.

**Stopping with the test still red is a correct outcome, not a failed heal.** When the red is the finding, leave it red. A guard that requires data to exist ("at least one row of the kind under test") is an assertion: when it fires because the environment's data moved, you may move the test to other data (a test-data heal), but you may not remove or relax the guard (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: attempt 3 diagnosed a report ignoring its filter, changed nothing — correct).

## Step 4 — Bounds

- Three attempts per test, then stop and report.
- One failure at a time. Do not batch-heal; it masks a systemic cause.
- If more than a third of the suite fails at once, stop immediately. That is a deploy, an auth, or an environment problem, not thirty independent test defects.

## Step 5 — After the delegate's attempts are exhausted

With explicit owner authorization, a bounded manual pass is allowed after the three delegated attempts stop:

1. State the diagnosis before touching code.
2. Take one fresh accessibility snapshot of the failing state.
3. Re-derive every locator flagged as ambiguous or wrong from that single snapshot, and apply them as one batch — not one trial-and-error edit per retry.

**Bounded means bounded: up to two corrected diagnoses within this sweep, each recorded, never silently redone — the third wrong diagnosis stops the sweep and reports it unresolved,** as with the delegate's three-attempt limit. Step 3 still applies: fix locators and waits, never assertions.

## Step 6 — Report

Every heal produces this, per test, in the PR body or the conversation:

```markdown
### <test name>
- **Classification:** test defect
- **Evidence:** button accessible name changed "Submit" → "Place order"; git log shows the copy change in src/checkout/SubmitButton.tsx
- **Change:** locator only
- **Assertions touched:** none
- **Attempts:** 1
- **Trace:** <path>
```

"Assertions touched: none" should be true on essentially every heal. If it is not, escalate rather than merge.

## Step 7 — Write the lesson back to the right place

A heal's root cause is a fact about either *this application* or *Playwright/testing-library behavior in general*. Decide which first:

- **App-specific** (a locator convention, a UI quirk, known test data) → `knowledge/project/*.md`, the same place `e2e-plan`'s discrepancies land.
- **General** (true of any Playwright suite, not particular to this app) → `knowledge/org/*.md` — `assertion-catalog.md` for an assertion gotcha, `locator-policy.md` for a locator one.

**The test: would this exact sentence still be true if you swapped in a different application built on the same underlying tools?** If yes, it's general — write it once, in `knowledge/org/`, so every project benefits. If it needs application-specific nouns to make sense, it's app-specific.

- *General*: "`page.evaluate(() => el.innerText)` proves an element exists, not that it is visible." Goes in `knowledge/org/locator-policy.md`, not only in a `clc.ts` comment (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: produced two wrong conclusions in a row).
- *App-specific, for contrast*: "CrewHub's Reporting filter panel starts collapsed on UAT and expanded on QA." Names a specific screen and environments → `knowledge/project/clc-known-flaky-areas.md`.
- **Genuinely unsure — write it in both, each phrased at its own level.** A `react-select` quirk might go in `knowledge/org/` as "watch for this in any `react-select` field" (general to the *library*) and ALSO in `knowledge/project/` as "confirmed present on these specific application fields" (which fields, observed when). Splitting costs one paragraph; guessing wrong means a future project or bolt does not find it.

If a heal touches a genuinely reusable helper in `tests/support/*.ts`, the code fix and the knowledge-file entry describing it are two different artifacts — writing one does not excuse skipping the other.

## Greenfield

Do not heal greenfield specs before the feature exists. Their failures are expected, not defects. Say so and stop.

## Never

- Never auto-merge a heal. It goes on a branch, in a PR, labelled `test-heal`, for a human.
- Never heal a test whose failure you classified as a product bug.
- Never add a retry, an increased timeout, or a `waitForTimeout` as a first response to flake. Find the race — the missing wait-for-response, the animation, the optimistic update — and wait for the real condition.
- Never heal quietly. The classification is the deliverable; the diff is secondary.
