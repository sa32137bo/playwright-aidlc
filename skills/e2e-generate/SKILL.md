---
name: e2e-generate
description: Turn an approved Markdown test plan into executable Playwright spec files, verifying every locator against the live application as it goes. Use when the user asks to generate, write, or implement Playwright tests or spec files from a plan, or when the e2e-bolt workflow reaches its generation step after plan approval.
license: Proprietary
---

# Generate Specs (Construction)

Input: an **approved** `bolts/<ID>/plan.md`. Output: `<paths.tests>/<ID>/*.spec.ts`, one file per scenario group.

## Precondition

Check the bolt state file for a recorded Gate 1 approval. If there is none, stop and ask for it. Generating from an unapproved plan is the failure mode this whole workflow exists to prevent.

## Delegate

If `.claude/agents/playwright-test-generator.md` exists, use it. It replays each scenario in a real browser and derives locators from the DOM it observed at every interaction. That live verification is the whole point — never write specs from the plan text alone.

Without it: drive the browser through Playwright MCP or `playwright-cli`, performing each step before you write the line that automates it.

## Rules — check these first, before anything else below

**Check `knowledge/project/*-overrides.md` and `*-known-flaky-areas.md` for the specific field before writing its locator or interaction — don't rely on having read them once, earlier.** If the field or interaction matches something already documented, apply the documented fix now; don't wait to rediscover it as a heal. This is the most expensive miss on record (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: airline-scoping defect recorded for two screens, never checked on a third).

**The same check applies to session state a fixture is responsible for, not only to a field's own locator or interaction.** Before writing the first spec, confirm that everything exploration did by hand between sign-in and its first real action (e.g. dismissing a post-sign-in modal) also happens in the `page` fixture every generated test runs through (bolt `US-CLC-001`, 2026-09-21: documented modal dismissal missing from the fixture cost a full timed-out run).

**Never call a dropdown/`selectOption` with no explicit match on a list that hasn't been confirmed safe.** A dropdown's first entry can be a destructive or unrelated action, not a real value (CrewHub: Manual Entry's Cost Center lists the literal "Not Used" first). `selectOption` in `tests/support/clc.ts` throws instead of silently picking a first entry, but still check the first entry during exploration rather than relying on the throw. See `knowledge/org/review-checklist.md` item 25.

**Never assert on output nobody has seen.** A check on a screen's results (a column, a row shape, a placeholder value) must use the headers and encoding the plan records for **that** screen, observed from its real output (an exploration snapshot or a real export) — never borrowed from a sibling screen. If a screen was never seen returning output, generate up to the last step that was observed, then stop the test with `test.fixme(true, '<screen>: output never observed — <why>')` and list it at Gate 2 as unverified. Do not write the rest from a guess (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: four report specs borrowed a sibling report's columns; all four would have failed).

**When a real output file exists, check the assertions against it before the live run.** If the plan or `test_data:` points at a real export for the same input (`known_good_output`), run the spec's own row-reading and predicate code over that file first: a short script or a no-browser test using the project's reader (e.g. `tests/support/xlsx.ts`). A wrong column name or shared-row rule then fails in seconds, not after a full journey. Keep a file that holds real customer data out of git, and record only its path and headers.

## Other rules

**Every locator must be observed.** Perform the step, read the accessibility snapshot, then write the locator. Never transcribe a selector from the plan, from `app-context.md`, or from memory of a similar app.

**Follow the locator policy** in `knowledge/org/locator-policy.md`. Role and accessible name first, `data-testid` second, CSS and XPath effectively never.

**Prefer importing an existing constant from `fixtures.ts` over declaring an equal-looking local one.** If a value matches something `fixtures.ts` exports, import it, so a later fixture correction reaches every spec.

**Follow the assertion catalog** in `knowledge/org/assertion-catalog.md`. Prefer web-first assertions with auto-retry. Assert the exact strings recorded in `app-context.md`, not paraphrases.

**Mirror the seed test.** Same fixture import, same structure, same conventions. `tests/seed.spec.ts` is the template.

**No manual waits.** No `waitForTimeout`, no arbitrary sleeps. Wait for the observable condition — the request, the element state, the URL. If you genuinely cannot express the wait, record it as an open question instead of sleeping.

**A page can accept an interaction before it is actually ready — typing or clicking alike.** Two shapes, neither fixed by a sleep:

- **Typing.** Some forms rebuild state asynchronously after their visible render, silently discarding input typed in that window (a real product bug on an earlier project, measured 6-8.5s). Wait for an observable readiness signal (a field gaining a required-marker, a rebuild-in-progress indicator clearing) before the first interaction. If input still vanishes, report a product bug; do not retry blindly.
- **Clicking.** A control can pass every actionability check while its script is still loading, so the click lands and does nothing. With no signal to wait for, re-issue the action inside `expect(...).toPass()` until its effect appears, never a longer timeout on one click: `knowledge/org/locator-policy.md`, "A click can be accepted before its handler is bound", has the pattern.

**Deterministic data.** Generate unique data per run for anything that must not collide. Never depend on data another test created, and never depend on ordering between spec files.

**Traceability header.** Every generated file starts with:

```ts
// spec: bolts/<ID>/plan.md § <section>
// scenarios: 1.1, 1.2, 1.3
// test-cases: TC_CUSTCREATE_001, TC_CUSTCREATE_002
// seed: tests/seed.spec.ts
// bolt: <ID>
// covers: src/checkout/CheckoutForm.tsx, src/checkout/validation.ts
// routes: /cart, /checkout
// app-commit: <short sha>
// generated: <ISO date>
```

`spec` / `seed` / `bolt` are what let a reviewer six months later find the requirement behind a failing test.

**`scenarios:` is not optional and not prose.** A bare comma-separated list of the plan's scenario ids this file implements, exactly as the plan writes them — `1.1, 1.2, 1.3` or `S-02, S-03`. Ranges are allowed: `1.1-1.4`. `pw-aidlc matrix` binds plan to specs by this line; without it, it falls back to matching titles against test names, which has reported the wrong test as coverage — worse than a gap, which gets investigated. Write the ids even when one long test covers several scenarios; the matrix then reports the file as covering them instead of inventing per-scenario tests.

**`test-cases:` when the bolt has them.** Same shape, listing the manual test case IDs this file automates. Omit the line when the bolt has no test-case document. It completes the chain `acceptance criterion → test case → spec → result`.

### Generating from test cases

When `plan.md` reconciles a test-case document, the manual case is the contract:

- **Never automate a case marked `Automation Candidate: No`.** It was excluded for a stated reason.
- **Assert the case's Expected Result, not a convenient approximation of it.** If it is not assertable as written, raise it in the plan's open questions; never quietly rewrite it — the QA team governs the sheet.
- **Keep the case's exact strings.** A quoted error message is quoted for a reason, including any product typo.

**`covers:` is what makes regression analysis possible at all.** List the source files and directories these scenarios were grounded in — the ones `app-context.md` names for the surfaces you tested. `pw-aidlc impact --since <ref>` matches changed files against this line to find which specs a change touches and which changed files nothing covers.

Rules for `covers:`:

- **Only list what actually grounded the tests.** It declares provenance; over-claiming makes a changed file look covered when nothing checks it.
- A directory is a valid entry when the scenarios genuinely span it.
- **Omit the line entirely if grounding was `off`.** A spec written from the live app alone has no source provenance. `impact` reports those as *unknown*, never as unaffected.
- `app-commit` records the source revision the grounding came from, so a stale claim is detectable.

**Comment the plan steps.** Keep the plan's numbered steps and expected results as inline comments above the code implementing them. That makes Gate 2 review fast.

## Order matters — cheap scenarios before the expensive journey

Generate and live-verify spec files in ascending cost order, not plan order, using each scenario's step count in `plan.md` as the cost proxy. Do short files first so an interruption still leaves reviewable output; a long journey (sign-in, multi-step wizard, several saves) can take most of a session. **Log this once, before generating the first file** — the chosen order and which file is the expensive one — to `bolts/<ID>/audit.md`. One entry, not per-scenario commentary.

This applies whether you drive the browser yourself or hand scenarios to `.claude/agents/playwright-test-generator.md` one at a time — the ordering decision is yours either way.

## Structure

```ts
// spec: bolts/CHK-42/plan.md § 1
// seed: tests/seed.spec.ts
// bolt: CHK-42
// generated: 2026-09-02

import { test, expect } from '../../fixtures';

test.describe('Guest checkout', () => {
  test('completes with a saved address @smoke', async ({ page }) => {
    // 1. Open the cart
    await page.getByRole('link', { name: 'Cart' }).click();

    // Expected: cart shows 2 items
    await expect(page.getByRole('listitem')).toHaveCount(2);
  });
});
```

Tag `@smoke` or `@regression` from the plan's priority field so CI can select subsets.

## Mocking

For non-2xx and timeout scenarios use `page.route` to shape the response. Never test error handling by breaking a shared environment. Keep mocks inside the test that needs them.

## When a step will not generate

If a scenario cannot be automated reliably — a CAPTCHA, a third-party redirect, an element with no stable handle — do not force it or fabricate a locator. Write the test with `test.fixme()` and a one-line comment saying exactly what blocks it, and list it in your Gate 2 report.

## Test data

Follow `data/README.md`. Every test creates what it needs with a unique key (`test_data.unique_key_strategy` in config). Never depend on records that happen to exist, and never assert a count over data you did not create.

**Read-only screens are the exception, and the exception has rules.** A report or search cannot create its own data. Take the filter values from the plan's test data table. When it names a slice, **import it** (e.g. `import { REPORT_SLICE_CRK_SEP26 } from '../../support/fixtures'`) and record which one the test used with `test.info().annotations.push({ type: 'test-data', description: '<SLICE> (verified <date>)' })`, so a red test shows the data it ran on. Otherwise put the values in one named constant per screen with a comment giving their source. Never write a filter value as a literal inside a test, and never pick one there. Keep the non-empty guard (`assertion-catalog.md`). A value marked `bolt-chosen (unverified)` is said to be unverified in the test's own failure message, so a red test on it does not read as a product defect.

## Greenfield

There is no app to verify locators against yet. Generate from the plan, mark every locator with `// UNVERIFIED — greenfield`, tag the specs `@pending`, and state clearly that these tests are expected to fail until the feature ships. On the first run against a real build, treat locator failures as expected and re-verify rather than healing.

## After generating

Run the suite. Report pass/fail per test. Do **not** edit assertions to make things green — hand failures to `e2e-heal`.
