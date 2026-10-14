# Guest Checkout — Test Plan

Bolt: CHK-42 | Seed: tests/seed.spec.ts | App: http://localhost:3000 | Context: testing/app-context.md
Status: **AWAITING GATE 1 APPROVAL**

## Application overview

Checkout is a three-step flow reached from the cart without signing in. A guest who has ordered before is offered saved addresses looked up by email; postcode is validated client-side against the selected country before submission is allowed. On success the browser navigates to a confirmation route showing the order number.

## Coverage of acceptance criteria

| # | Criterion | Scenario(s) | Notes |
|---|---|---|---|
| 1 | Guest reaches checkout without signing in | 1.1 | |
| 2 | Saved addresses appear in a picker and one can be selected | 2.1, 2.2 | 2.2 covers the no-saved-addresses branch, which the story omits |
| 3 | Invalid postcode blocks submission with a field-level message | 3.1, 3.2, 3.3 | Three rules found in source, not one |
| 4 | Confirmation shows the order number | 4.1 | |

## Test scenarios

### 1. Reaching checkout

#### 1.1 Guest proceeds from cart to checkout
**Priority:** smoke
**Preconditions:** 2 items in cart, no session
**Steps:**
1. Open the cart
2. Click "Checkout"

**Expected results:**
- The checkout page loads at `/checkout`
- No sign-in prompt is shown
- The order summary lists both cart items with the cart's total

**Source:** `src/checkout/CheckoutGate.tsx:24` — guard allows anonymous when `new_checkout` is on

---

### 2. Saved addresses

#### 2.1 Saved addresses appear and one can be selected
**Priority:** smoke
**Preconditions:** guest email `returning@example.com` has 2 saved addresses
**Steps:**
1. Enter "returning@example.com" in the email field
2. Move focus out of the email field

**Expected results:**
- An address picker appears listing exactly 2 addresses
- Selecting the second address fills the address fields with its values
- The "Place order" button becomes enabled

**Source:** `src/checkout/AddressPicker.tsx:41` — lookup fires on blur, debounced 300ms

#### 2.2 No saved addresses — manual entry
**Priority:** regression
**Preconditions:** email with no saved addresses
**Steps:**
1. Enter "brand-new@example.com" and blur the field

**Expected results:**
- No address picker is rendered
- Address fields are empty and editable
- No error is shown — an unknown email is a normal case

**Source:** `src/checkout/AddressPicker.tsx:58` — empty array renders null

---

### 3. Postcode validation

> The story says "an invalid postcode". Source has **three** distinct rules with three different messages. Each is tested separately.

#### 3.1 Empty postcode
**Priority:** regression
**Steps:**
1. Select a saved address, clear the postcode field, click "Place order"

**Expected results:**
- The message "Postcode is required" appears beneath the postcode field
- The URL is still `/checkout`
- No POST to `/api/orders` is made

**Source:** `src/checkout/validation.ts:12`

#### 3.2 Postcode does not match the selected country
**Priority:** regression
**Steps:**
1. Select country "United Kingdom"
2. Enter "12345" as the postcode
3. Click "Place order"

**Expected results:**
- The message "Postcode is invalid for the selected country" appears
- The URL is unchanged and no order request is made

**Source:** `src/checkout/validation.ts:19`

#### 3.3 Postcode over the length limit
**Priority:** regression
**Steps:**
1. Enter a 13-character postcode and click "Place order"

**Expected results:**
- The message "Postcode must be 12 characters or fewer" appears

**Source:** `src/checkout/validation.ts:26` — **see Discrepancies**

---

### 4. Successful order

#### 4.1 Order completes and confirmation shows the order number
**Priority:** smoke
**Steps:**
1. Complete checkout with a valid saved address
2. Click "Place order"

**Expected results:**
- The browser navigates to `/checkout/confirmation`
- A heading reads "Order confirmed"
- An order number matching `ORD-` followed by 6 digits is displayed
- The cart badge shows 0 items

**Source:** `src/checkout/SubmitButton.tsx:33`

## Not covered by E2E

| Behaviour | Why | Where it belongs |
|---|---|---|
| Postcode regex per country (14 countries) | 14 browser runs to test a pure function | Unit test on `validation.ts` |
| Address lookup debounce timing | Timing-sensitive, unreliable through the UI | Unit test on the hook |
| Payment authorisation | Third-party redirect, out of bolt scope | Separate bolt with a sandbox provider |

## Discrepancies (code vs live app)

| Code says | App does | File | Impact |
|---|---|---|---|
| Max postcode length is 12 (`MAX_POSTCODE = 12`) | UI `maxlength` attribute is 10, so 13 characters cannot be typed | `validation.ts:26` vs `AddressForm.tsx:71` | 3.3 is unreachable through the UI. Either the input attribute or the constant is wrong — **needs a decision before I generate 3.3** |
| `409 Conflict` renders "This order was already placed" | Not reachable by clicking; only via a duplicate submit race | `SubmitButton.tsx:47` | Planned as a mocked scenario, not a real duplicate submit |
| Address picker limits to 5 entries | Test account has 2, so the limit is unverified | `AddressPicker.tsx:44` | Not covered — would need a 6-address fixture |

## Assumptions

- `new_checkout` is on. With it off, `CheckoutGate` redirects to sign-in and every scenario here fails by design.
- The test account `returning@example.com` keeps exactly 2 saved addresses. Scenario 2.1 asserts a count of 2 and will break if the fixture changes.
- Order numbers are `ORD-` plus 6 digits; asserted as a pattern, not a fixed value.

## Open questions

1. Postcode max length — 10 or 12? Blocks scenario 3.3.
2. Should an unknown email show anything at all, or is silence correct? Code says silence; confirm that is intended.
