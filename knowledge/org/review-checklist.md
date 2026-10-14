# Gate 2 — Generated Test Review Checklist

Run every item. Report pass / fail / N/A per row with a one-line reason for anything not passing. Never waive a mandatory item silently.

## Mandatory

| # | Check |
|---|---|
| 1 | Every acceptance criterion maps to a scenario, or has an explicit written exclusion |
| 2 | Every locator follows `locator-policy.md` — no auto-generated classes, no XPath, no positional chains |
| 3 | No `waitForTimeout` or arbitrary sleep anywhere |
| 4 | Every assertion would go red if the feature broke (apply the review question) |
| 5 | Validation scenarios assert the exact message *and* that submission was blocked |
| 6 | No secrets, tokens, `storageState`, `.env` or real customer data committed |
| 7 | Every file carries the `// spec:` / `// seed:` / `// bolt:` traceability header |
| 8 | Tests are independent — no ordering dependency, no shared mutable data |
| 9 | Test data is unique per run where collision is possible. Third outcome, beyond pass/fail: **"not achievable — product constraint"**, when the application itself provides no unique key or cleanup path for the data in question (name a specific reason, not a shrug). Do not report a product limit as a plain FAIL (bolt `US-CLC-002`, 2026-09-22: one successful Manual Entry submit per crew member per workspace) |
| 10 | Every `fixme` / `skip` has a written reason and appears in the PR body |
| 11 | Discrepancies between code and live app are reported, not silently resolved |
| 12 | Suite passes twice in a row (run it again — once is not evidence of determinism). On an app with no delete/cleanup affordance, this doubles every creating test's permanent data cost — confirm the Gate 1 estimate already counted the second run, not just one pass (bolt `US-CLC-001`, 2026-09-21: estimated 3 permanent records, created 7) |
| 13 | Any file touched outside this bolt's own declared scope — another bolt's spec, a shared support module — is named and justified in this bolt's audit log |

## Quality

| # | Check |
|---|---|
| 14 | Tests mirror `seed.spec.ts` conventions and fixtures |
| 15 | Plan steps appear as inline comments above their implementation |
| 16 | `@smoke` / `@regression` tags present and sensible |
| 17 | Error-path scenarios use `page.route` mocking, not a broken environment |
| 18 | No copy-pasted setup that belongs in a fixture |
| 19 | Scenario names read as behaviour, not as implementation |

## Heal-specific (skip if no healing occurred)

| # | Check |
|---|---|
| 20 | Every heal has a recorded classification with evidence |
| 21 | **Assertions touched: none** on every heal — except a disclosed **"changed which element is asserted, expectation unchanged or tightened"**, when a heal moves the assertion to a different element without weakening what it checks (e.g. a widget's displayed label via `toHaveText` instead of a hidden input's `toHaveValue` that never held that text). Name the old and new assertion in the disclosure; plain PASS would hide the change, FAIL would call a fix a weakening (bolt `US-CLC-002`, 2026-09-22) |
| 22 | No failure classified as a product bug was patched |
| 23 | No test was skipped or deleted to make the suite green |

## Security

A bare "pass" on item 24 or item 25 is not acceptable — the report must name what
was actually checked, concretely enough to be wrong. A rubber-stamped "looks
fine" catches nothing.

| # | Check |
|---|---|
| 24 | No test artifact — trace, accessibility snapshot, `test-results/` error context, even one that's gitignored and never committed — captures a credential's live value. A sign-in helper should actively clear sensitive fields the moment they're no longer needed, not rely on the artifact directory never being committed. **Report which directories were actually inspected for the credential value** (e.g. "grepped `.explore/`, `test-results/`, `results/` for the literal password — no residue"), not just "no leak found." (Real incident on an earlier project: an error-context snapshot stored the password in plain text; CrewHub's sign-in form has the same shape.) |

## Additional quality

| # | Check |
|---|---|
| 25 | Every `selectOption`/dropdown interaction either matches an explicit value or pattern, or the default it falls through to has been deliberately verified safe — never left to "whatever exploration happened to click." `selectOption` in `tests/support/clc.ts` throws when a multi-option list gets neither `match` nor `first: true`, so check the diff specifically for `first: true`. **If it appears anywhere, quote what the first option's actual text is and confirm it's a real value, not an action** ("Create New...", "Add new..."; a real heal on an earlier project). On CrewHub, Manual Entry's Cost Center first option is the literal "Not Used" (see `MANUAL_ENTRY_CREW_5DIGIT` in `clc.ts`). |
| 26 | Every test that reads data it did not create (a report, a search, a list) asserts that at least one row of the kind under test is present **before** asserting on those rows, so it cannot pass on an empty result. Name the guard's line. See `assertion-catalog.md`, "A test over existing data needs a guard that fails on empty" |
| 27 | If the suite is not all-green, every red test is one of: healed and re-run, classified as a product defect and tagged `@known-defect` with the defect named (isolated, see item 29), tagged `@unconfirmed` with the unvaried filters named, or listed as unresolved. **State the suite's overall state in one plain-English sentence a tester can read without the JSON** ("2 tests check working behaviour and pass; 4 check reports that returned nothing with the filters used, and fail on purpose; the cause is not isolated") |
| 28 | Every check on a screen's output uses column names and row encoding observed from **that** screen's real output (name the snapshot or export it came from). A screen never seen returning output is `test.fixme`'d at its last observed step, not asserted on from a sibling's layout. Where a real export exists for the same input, the spec's row-reading code was run over it before the live run. See `e2e-generate`, "Never assert on output nobody has seen" |
| 29 | Every test over data it did not create takes its filter values from the plan's test data table: a named slice imported from the project's data constants, or one sourced constant per screen, never a literal in a test body. Each value's source is named, and `bolt-chosen (unverified)` values are flagged at Gate 2. Every `@known-defect` states how its cause was isolated (bisected from a working input, or confirmed by a domain expert). Otherwise it is `@unconfirmed`. See `e2e-plan`, "Before calling a screen broken" |

## Reviewer time budget

Aim for ten minutes on a twelve-scenario bolt. Spend it in this order: coverage table, assertions, locators, discrepancies. The step-by-step code is the least risky part of the diff and the easiest to over-read.

If review is taking more than twenty minutes, the bolt was too big. Split the next one.
