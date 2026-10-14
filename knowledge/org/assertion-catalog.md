# Assertion Catalog

Assertions are where AI-generated suites fail quietly. A weak assertion does not go red — it just stops catching regressions, and nobody notices for a year. Review them harder than you review locators.

## Use web-first assertions

`expect(locator).toBeVisible()` retries until the timeout. `expect(await locator.isVisible()).toBe(true)` snapshots once and races. Always the first form.

## Common assertions

| Intent | Assertion |
|---|---|
| Element present | `await expect(loc).toBeVisible()` |
| Exact copy | `await expect(loc).toHaveText('Order confirmed')` |
| Partial copy | `await expect(loc).toContainText('confirmed')` |
| Field value | `await expect(input).toHaveValue('venu@example.com')` |
| Disabled state | `await expect(button).toBeDisabled()` |
| List size | `await expect(rows).toHaveCount(3)` |
| List contents | `await expect(rows).toHaveText([...])` |
| Navigation | `await expect(page).toHaveURL(/\/confirmation/)` |
| Structure | `await expect(loc).toMatchAriaSnapshot(...)` |

## Strength rules

**Assert the exact string when the string is the requirement.** Validation messages, confirmation copy and error text come from `testing/app-context.md`, quoted from source. `toContainText('error')` passes on the wrong error.

**Assert absence too.** After a successful submit, assert the error region is gone, not just that the success banner appeared: many "it looks fine" bugs are state that failed to clear.

**Assert the negative case is actually blocked.** For a validation scenario, assert both the message *and* that submission did not happen: URL unchanged, no request fired, no row added. A message alone does not prove the guard held.

**One scenario, one behaviour.** Multiple assertions are fine; multiple behaviours in one test are not, so a failure says what broke without opening the trace.

**When a save fires more than one network call, wait for the one that actually persists — not the first one that resolves, and not a pre-check.** A validation or existence check can return before the real write, and asserting against it proves nothing about the save. Identify which call's response body is the source of truth before writing the wait (bolt `US-CLC-002`, 2026-09-21: `ValidateOverlap` returned `200 []` at once; the real `Create` POST came 12s later).

## Banned

- `expect(true).toBe(true)` or any assertion that cannot fail
- Asserting only that a page loaded
- Assertions on auto-generated class names or internal state
- `toBeTruthy()` on a locator — say what you actually mean
- Regexes so loose they match the error case as well as the success case
- Screenshot comparison as the only assertion for a functional scenario

## Dynamic data

Do not assert on values you cannot control. Order numbers, timestamps and generated IDs get pattern assertions:

```ts
await expect(page.getByTestId('order-number')).toHaveText(/^ORD-\d{6}$/);
```

Then capture the value and assert it *stays consistent* across the rest of the flow.

Freeze time with `page.clock` rather than loosening a date assertion.

## `toHaveText` normalizes whitespace for a string, not for a regex

`toHaveText('1 to 1 of 1')` collapses the element's internal whitespace/newlines before comparing. `toHaveText(/1 to 1 of 1/)` does not: a regex is matched against raw text content, so an element that renders each token on its own line (an ag-Grid pager: `1\nto\n1\nof\n1`) never matches, healthy or not. Fix it whitespace-tolerant, not loosened: `/1\s+to\s+1\s+of\s+1/` still requires the exact count. When a regex assertion on rendered text fails and the values look right in a screenshot, check this before suspecting the locator or the app (a real heal on an earlier project on this kit).

## A native dialog is lost, silently, without a registered handler

Playwright auto-dismisses a native `window.alert`/`confirm`/`prompt` the instant it appears, in every browser, unless a `page.on('dialog', ...)` handler is already registered. No error is raised, so a test on an app that reports results through native dialogs passes with the message unread. Register the handler **before** the triggering action, capturing the message before accepting it; a handler added after is too late (bolt `US-CLC-002`, 2026-09-21: confirmation and every validation error arrived as native dialogs).

## A fixed-width message field makes the surrounding whitespace data-dependent

When a message interpolates a value into a padded or fixed-width slot, the whitespace around it changes with the value's length, so a literal copied from one run fails for another record with a diff of two identical-looking strings.

```ts
// Fragile: correct for a 4-digit id, wrong for a 5-digit one.
expect(msg).toBe(`The Manual Entry for the EmployeeID ${id} was created correctly.`);

// Robust: the whole sentence, anchored, with only the padding normalised.
expect(msg).toMatch(new RegExp(`^The Manual Entry for the EmployeeID\\s+${id}\\s+was created correctly\\.$`));
```

This is not loosening. Anchor both ends and keep the interpolated value exact; only the padding, which was never the requirement, is relaxed (bolt `US-CH-MENT-001`, 2026-09-24: healed when the employee id went from 4 to 5 digits).

## A test over existing data needs a guard that fails on empty

A test that checks "every row of kind X is correct" passes vacuously when there are no rows of kind X. On a report, a search, or any screen reading data the test did not create, assert **first** that at least one row of the kind under test is present, then assert on those rows:

```ts
const shared = rows.filter((r) => r.occupancy === 'D');
expect(shared.length, 'no rows of the kind under test — the test would pass on nothing').toBeGreaterThan(0);
for (const r of shared) expect(r.lastName).not.toMatch(/^(0|NA|)$/);
```

Expect the guard to fire: shared environments' data moves (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: 1,700 rows at planning, empty an hour later). **When it fires, that is an environment finding, not a test defect — never remove or relax the guard to get green.** Moving the test to a different window is a legitimate test-data heal; deleting the guard is weakening an assertion.

## A red test can be the correct result

When the requirement is real and the product does not meet it — a report that will not load, a screen that ignores its filter — the right test asserts the requirement and fails. Tag it `@known-defect` so CI can select or exclude it deliberately, record the product defect it is blocked by, and report the suite as **mixed by design**, not as a failed bolt, in plain English (`e2e-bolt`, "6. Run"). `test.fixme` is the alternative when the owner prefers a green run; offer it, but it is their call, and a declined `fixme` is not a problem to be fixed.

**A red test is only as good as the isolation behind it.** `@known-defect` is for a defect whose cause was isolated: the screen was bisected from a working input, or a domain expert confirmed it (see `e2e-plan`, "Before calling a screen broken"). Anything less is `@unconfirmed`, and its failure message names the filters that were never varied. Do not write "product defect" in a failure message for an unisolated cause (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: all four "defective" reports loaded next day on UAT with a station and hotel chosen).

## Sibling screens do not share an output layout

Reports in one module, or searches on one menu, look alike but are built separately: column names, order and encoding of the thing under test all differ. Write every check on a screen's output from **that** screen's observed output. The rule and what to do instead are in `e2e-generate`, "Never assert on output nobody has seen"; CrewHub's five report layouts are in `knowledge/project/clc-known-flaky-areas.md`.

## An expected value is only as good as the state it was derived from

An expected value must come from the same source, and the same state, the assertion will meet at run-time — being correct at write-time is not enough (bolts `US-CLC-001` and `US-CH-MENT-001`, 2026-09-22: one of each case below).

- **Wrong API.** Text copied from `innerText()` carries CSS `text-transform` and collapsed padding; `toHaveText` compares raw DOM textContent. Derive the expected value with the same API the assertion reads: for `toHaveText`, read the DOM text back, not the rendered text.
- **Wrong moment.** A dialog *count* observed during exploration can change when a conditional dialog appears (e.g. an overlap confirmation caused by exploration's own writes). Never assert by count on a screen with conditional dialogs; assert that the *required* message is present with `waitForDialog()` (or equivalent).

Both are heals, not locator problems. When "the right thing happened but the assertion says otherwise", check for a *different* reading path or a *different* moment before touching the locator or the interaction.

## The review question

For every assertion, ask: **if this feature broke tomorrow, would this line go red?** If the honest answer is "maybe", it is too weak. That question catches most of what is wrong with generated suites.
