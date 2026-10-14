# Example Heal Report — CHK-42, three weeks later

What `/heal` produces after a UI change breaks the suite. Classification comes first; two of these three are repaired and one deliberately is not.

## Suite run

```
Running 8 tests using 4 workers
  ✓  guest-checkout.spec.ts:15  guest reaches checkout without signing in
  ✘  guest-checkout.spec.ts:35  saved addresses appear and can be selected
  ✓  guest-checkout.spec.ts:63  unknown email shows no picker and no error
  ✘  guest-checkout.spec.ts:82  order completes and confirmation shows the order number
  ✘  postcode-validation.spec.ts:24  empty postcode blocks submission
  ✓  postcode-validation.spec.ts:47  postcode not matching country blocks submission
  -  postcode-validation.spec.ts:70  postcode over the length limit (fixme)
  ✓  postcode-validation.spec.ts:88  server error keeps the order recoverable

3 failed, 4 passed, 1 skipped
```

---

### 1. `order completes and confirmation shows the order number`

- **Classification:** test defect
- **Evidence:** `getByRole('button', { name: 'Place order' })` resolved 0 elements. Live snapshot shows a button with accessible name "Complete order". `git log -p src/checkout/SubmitButton.tsx` has commit `a3f21c9` "copy: Place order → Complete order" from 4 days ago. The behaviour behind the button is unchanged.
- **Change:** locator name only, in 3 places.
- **Assertions touched:** none
- **Attempts:** 1
- **Trace:** `test-results/.../trace.zip`

```diff
- await page.getByRole('button', { name: 'Place order' }).click();
+ await page.getByRole('button', { name: 'Complete order' }).click();
```

---

### 2. `saved addresses appear and can be selected`

- **Classification:** test defect (race, not a locator)
- **Evidence:** intermittent — passes on rerun. Trace shows the radio count asserted while the picker was mid-render; `AddressPicker` now renders a skeleton before the list. `waitForResponse` returns before React commits.
- **Change:** wait for the observable end state instead of the network response.
- **Assertions touched:** none — the count assertion of 2 is unchanged.
- **Attempts:** 1

```diff
- await page.waitForResponse((r) => r.url().includes('/api/addresses') && r.ok());
  const picker = page.getByRole('radiogroup', { name: 'Saved addresses' });
+ await expect(picker).toBeVisible();
  await expect(picker.getByRole('radio')).toHaveCount(2);
```

Note: no retry added, no timeout raised. The race was found and waited on.

---

### 3. `empty postcode blocks submission` — **NOT REPAIRED**

- **Classification:** **product bug**
- **Evidence:** the test failed on `expect(orderPosted).toBe(false)` — a POST to `/api/orders` *was* made with an empty postcode. The message "Postcode is required" still renders correctly, so a naive heal would see the visible message, call it a pass, and miss this entirely. `validation.ts:12` still contains the rule; commit `7b9e004` refactored `SubmitButton` to call `submit()` before awaiting `validate()`.
- **Change:** **none.** The test is correct and the application is wrong.
- **Action:** raised as a bug against `src/checkout/SubmitButton.tsx:29`. The test stays red until the app is fixed.

> This is the case the whole classification step exists for. The visible symptom looked fine; the assertion that submission was actually blocked is what caught it. An auto-healing setup that patched the locator and moved on would have shipped a checkout that accepts invalid addresses.

---

## Summary posted to the PR

| Test | Class | Repaired | Assertions touched |
|---|---|---|---|
| order completes… | test defect | yes | none |
| saved addresses… | test defect (race) | yes | none |
| empty postcode… | **product bug** | **no — bug raised** | none |

2 of 3 repaired. 1 escalated. No assertion was modified, no test was skipped.
