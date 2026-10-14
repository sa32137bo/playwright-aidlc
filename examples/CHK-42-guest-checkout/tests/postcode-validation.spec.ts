// covers: src/checkout/validation.ts, src/checkout/PostcodeField.tsx
// routes: /checkout
// app-commit: a3f21c9
// spec: specs/CHK-42.md § 3
// seed: tests/seed.spec.ts
// bolt: CHK-42
// generated: 2026-09-02

import { test, expect, type Page } from '../../fixtures';

async function reachCheckoutWithSavedAddress(page: Page) {
  await page.goto('/checkout');
  const email = page.getByLabel('Email');
  await email.fill('returning@example.com');
  await email.blur();
  await page.waitForResponse((r) => r.url().includes('/api/addresses') && r.ok());
  await page.getByRole('radiogroup', { name: 'Saved addresses' }).getByRole('radio').first().check();
}

test.describe('Postcode validation', () => {
  test.beforeEach(async ({ page }) => {
    await reachCheckoutWithSavedAddress(page);
  });

  // 3.1 Empty postcode
  test('empty postcode blocks submission', async ({ page }) => {
    // Fail the test if a request escapes — the guard must hold, not just warn.
    let orderPosted = false;
    await page.route('**/api/orders', (route) => {
      orderPosted = true;
      return route.abort();
    });

    await page.getByLabel('Postcode').clear();
    await page.getByRole('button', { name: 'Place order' }).click();

    // Expected: exact message from validation.ts:12
    await expect(page.getByText('Postcode is required')).toBeVisible();

    // Expected: submission was actually blocked
    await expect(page).toHaveURL(/\/checkout$/);
    expect(orderPosted).toBe(false);
  });

  // 3.2 Postcode does not match the selected country
  test('postcode not matching country blocks submission', async ({ page }) => {
    let orderPosted = false;
    await page.route('**/api/orders', (route) => {
      orderPosted = true;
      return route.abort();
    });

    await page.getByLabel('Country').selectOption('United Kingdom');
    await page.getByLabel('Postcode').fill('12345');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(
      page.getByText('Postcode is invalid for the selected country'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/checkout$/);
    expect(orderPosted).toBe(false);
  });

  // 3.3 Postcode over the length limit
  // BLOCKED — see specs/CHK-42.md § Discrepancies. validation.ts:26 caps at 12
  // characters, but AddressForm.tsx:71 sets maxlength=10, so a 13-character
  // value cannot be entered through the UI and this rule is unreachable.
  // Not generated until the team decides which value is correct.
  test.fixme('postcode over the length limit shows a message', async () => {});
});

test.describe('Order submission errors', () => {
  test.beforeEach(async ({ page }) => {
    await reachCheckoutWithSavedAddress(page);
  });

  // Error paths are mocked. Never break a shared environment to test a 500.
  test('server error keeps the order recoverable', async ({ page }) => {
    await page.route('**/api/orders', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'internal' }) }),
    );

    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Something went wrong. Your order was not placed.',
    );
    // Still on checkout, entered data intact, and retry is possible.
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByLabel('Email')).toHaveValue('returning@example.com');
    await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  });

  test('duplicate order returns a conflict message', async ({ page }) => {
    await page.route('**/api/orders', (route) =>
      route.fulfill({ status: 409, body: JSON.stringify({ error: 'duplicate' }) }),
    );

    await page.getByRole('button', { name: 'Place order' }).click();

    // Exact string from SubmitButton.tsx:47
    await expect(page.getByRole('alert')).toHaveText('This order was already placed');
    await expect(page).toHaveURL(/\/checkout$/);
  });
});
