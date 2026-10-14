# Locator Policy

Locator quality decides whether this suite survives six months. Nothing else in the generated code matters as much.

## Priority order

1. **Role + accessible name** — `getByRole('button', { name: 'Place order' })`. Survives restyling and refactors, and fails loudly when accessibility genuinely breaks.
2. **Label / placeholder / text** — `getByLabel('Email')`, `getByText('Order confirmed')`. Good for forms and copy you are asserting on anyway.
3. **`data-testid`** — `getByTestId('checkout-submit')`. Use when there is no meaningful role or name, or when the visible text is dynamic or localised.
4. **CSS** — only for a structural container with no other handle, and only with a comment saying why.
5. **XPath** — no.

## Banned

- Auto-generated class names (`.css-1x2y3z`, Tailwind chains, CSS modules hashes)
- Positional chains — `div > div:nth-child(3) > span`
- IDs that look framework-generated (`#mui-4821`, `#react-select-2-input`)
- Locators built by string concatenation from test data
- `page.locator('text=...')` where `getByRole` with a name would work

## Scoping

Scope before you select. `page.getByRole('row', { name: 'Order 1234' }).getByRole('button', { name: 'Cancel' })` — not a global search for the fourth Cancel button. Scoped locators say what they mean and do not break when a row is added.

Use `.filter()` for list disambiguation rather than `.nth()`. Index-based selection is a time bomb in any list whose order can change.

**Accessible names that share a common substring need `exact: true`.** "Volume Group ID" and "Card Group ID" both contain "Group ID"; without `exact: true` a role+name locator can resolve to the wrong field, or ambiguously. Use it as soon as two fields on a screen share wording, not only after a run proves it necessary.

**A disabled custom combobox (react-select and similar libraries) may expose no role at all.** The library can swap the input for an unlabelled placeholder when disabled, so a role locator that works while enabled resolves to 0 elements. If a scenario asserts a *disabled* state, verify the locator against the disabled DOM, not the enabled one used elsewhere in the file.

## Waiting

Never `waitForTimeout`. Playwright's locators auto-wait for actionability, and web-first assertions retry. If you need more than that, wait for the actual condition:

```ts
await page.waitForResponse(r => r.url().includes('/api/orders') && r.ok());
await expect(page.getByRole('status')).toHaveText('Saved');
```

A test that needs a sleep is a test that has not identified what it is waiting for.

**A click can be accepted before its handler is bound, and that failure is silent.** On a server-rendered page the control can be visible, enabled and hit-testable before its script loads: actionability passes, the click lands, nothing happens. Do not answer it with a sleep or a longer timeout — re-issue the action until its observable effect appears:

```ts
await expect(async () => {
  await tab.click();
  await expect(panelHeading).toBeVisible({ timeout: 10_000 });
}).toPass({ timeout: 60_000 });
```

This retries the *action*, not the assertion that matters, and self-limits on a fast render. (bolt `US-CLC-001`, 2026-09-20: tab click intermittently switched nothing.)

### Settle a control before reading it to decide whether to act on it

A guard that skips work when a control already holds the wanted value must read it — and a widget's wrapper is often readable before its real value is written. Read too early and the guard performs an action the framework answers with nothing:

```ts
// Wrong: `innerText()` may return '' or a stale value mid-render.
if ((await widget.innerText()).trim() === wanted) return;

// Right: settle it with a retrying assertion, THEN decide.
await expect(widget).toHaveText(/\S/, { timeout: 30_000 });
if ((await widget.innerText()).trim() === wanted) return;
```

Symptom: a full-timeout hang waiting for a change event the no-op never fires, with a snapshot showing the control already holding the wanted value. True of any widget library that only raises `change` on an actual change — most of them. (bolt `US-CLC-001`, 2026-09-24: 90s timeout; snapshot showed target already selected.)

### When the thing you assert on is a side effect, wait for its cause as well

A native dialog, a toast, a downloaded file — each is raised *by* a request. Wait only on the effect and "request failed", "never fired" and "was slow" all read as "timed out waiting for X".

```ts
// Wrong: the only signal is the effect, so a failure says nothing about why.
await submitButton.click();
await waitForDialog(dialogs, /created/i, 120_000);

// Right: wait for the cause too, registered BEFORE the action.
const created = page.waitForResponse((r) => /Create/.test(r.url()) && r.request().method() === 'POST');
await submitButton.click();
expect((await created).status()).toBe(200);
await waitForDialog(dialogs, /created/i, 120_000);
```

This adds an assertion rather than relaxing one — not a timeout increase in disguise. (bolt `US-CH-MENT-001`, 2026-09-24: zero dialogs in 120s; artifact could not say if create was called.)

### Existence is not visibility — and `page.evaluate` only proves existence

`page.evaluate(() => el.innerText)`, `locator.count()`, `textContent()` and `allTextContents()` all read hidden nodes — a `display: none` container still yields its children's text — so they prove presence in the DOM, not that a user can see or click it. For "the user can see this", use `isVisible()`, `toBeVisible()` or `waitFor({ state: 'visible' })`; when an element exists but will not become visible, walk the ancestor chain for `display: none`. (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: buttons in a collapsed panel; two wrong conclusions reached the owner.)

### `fill()` does not always replace — verify the value after entering it

A masked or script-managed input (date pickers especially) can re-apply its formatting and **append** instead of replace — wrong value, no error. Assert it back with `toHaveValue()` right after entering it; if it appends, select-all, delete, then type. (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: end date became `11/1/202611/30/2026`; reports looked empty.)

### A link with no `href` is not a link to `getByRole`

An `<a>` is role `link` only if it has an `href`. An `<a onclick=...>` without one matches neither `getByRole('link')` nor `getByRole('button')`. If a role lookup misses a visible control, check its tag and attributes first; fall back to `page.locator('a').filter({ hasText: ... })` with a comment saying why. (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24: "Export to Excel" was such an anchor; cost a run.)

## When the app fights you

If a flow has no roles, no labels and no test IDs, do not compensate with clever CSS. Say so, and recommend adding `data-testid` to the source. Brittle locators do not fail at authoring time — they fail every Tuesday for the next year, and the healer will keep patching them without ever fixing the cause.

**A modal that intercepts every screen's first click belongs in the session fixture, not in each test.** A cookie-consent dialog (or any once-per-session overlay) looks like a hung click on whatever the spec touched first. When a project's environment notes describe a per-session interstitial, put its dismissal in the `page` fixture the first time it is discovered — not per spec, and not left to exploration. (bolt `US-CLC-001`, 2026-09-21: working helper never added to the fixture; cost a 488s run.)

**A custom autocomplete's own dropdown option can shadow the real record it just created, and a locator matching on the record's visible text alone will resolve to the wrong one.** The option stays in the DOM, hidden, after selection, so a name or id match finds it first; the failure reads "element not visible", not "wrong element". Scope the follow-up locator to something the selection UI does not also carry — e.g. the created row `"SMITH,  JEFFREY ~ 1322 | COR | NA"` vs. the option `"SMITH,  JEFFREY ~ 1322 , Pos:CA"` differ only in the pipe-separated position code. (bolt `US-CLC-002`, 2026-09-21: `getByText` resolved to the hidden option.)

**Never verify a locator with a comma-separated OR selector.** `'#HotelKey, [name="HotelKey"]'` proves *one* alternative matched — not which, nor that the one you keep is it. Verify each candidate individually. (bolt `US-CLC-001`, 2026-09-22: match came from `name`; real id was `hotelKeyInput`; `#HotelKey` recorded anyway.)

**`click()` is hit-tested; `focus()` is not.** A popup raised by the control itself (a Kendo "no results" panel, a validation tooltip) can sit over the input and intercept `click()`, timing out as "element not interactable". `focus()` reaches the input regardless — when a field's own widget can pop something over itself, focus it rather than click it. (bolt `US-CLC-002`, 2026-09-22: `div.k-nodata` intercepted clicks for 120s; `focus()` fixed it.)

**A Kendo (or similar) dropdown's underlying input holds a CODE, while the widget displays a LABEL.** `toHaveValue()` against the label fails even when the right option was chosen (display `"DFW | Dallas/ Ft. Worth"`, input `"DFW"`). When the label is what matters, assert on the widget's displayed text (`.k-input`). (bolt `US-CLC-002`, 2026-09-22: station field.)

**In a tabbed single-page app, scope every by-text assertion to the active panel.** Hidden tabs often stay mounted, so an unscoped `getByText(...)` can hit another tab's hidden element — "wrong value" that is really "wrong tab". Locate the active panel once (e.g. `div.k-content.k-state-active` filtered to a control unique to the screen) and chain every by-text lookup through it. (bolt `US-CLC-002`, 2026-09-22: `getByText('Hotel Name', { exact: true })` hit a hidden `<th>`.)

## Page objects

Not required, and not worth it below roughly thirty tests. Introduce them when the same flow appears in five or more specs. Premature abstraction makes generated tests harder to review, and reviewability is the point.
