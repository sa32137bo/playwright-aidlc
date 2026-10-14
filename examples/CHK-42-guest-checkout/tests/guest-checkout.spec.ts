// spec: specs/CHK-42.md § 1, § 2, § 4
// seed: tests/seed.spec.ts
// bolt: CHK-42
// covers: src/checkout/CheckoutPage.tsx, src/checkout/AddressPicker.tsx, src/cart/CartSummary.tsx
// routes: /cart, /checkout
// app-commit: a3f21c9
// generated: 2026-09-02

import { test, expect } from '../../fixtures';
import { addToCart } from '../../fixtures/cart';

test.describe('Guest checkout', () => {
  test.beforeEach(async ({ page }) => {
    await addToCart(page, ['SKU-1001', 'SKU-1002']);
  });

  // 1.1 Guest proceeds from cart to checkout
  test('guest reaches checkout without signing in @smoke', async ({ page }) => {
    // 1. Open the cart
    await page.getByRole('link', { name: 'Cart' }).click();

    // 2. Click "Checkout"
    await page.getByRole('button', { name: 'Checkout' }).click();

    // Expected: checkout page loads at /checkout
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    // Expected: no sign-in prompt
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeHidden();

    // Expected: order summary lists both items with the cart total
    const summary = page.getByRole('region', { name: 'Order summary' });
    await expect(summary.getByRole('listitem')).toHaveCount(2);
    await expect(summary.getByTestId('order-total')).toHaveText('$74.98');
  });

  // 2.1 Saved addresses appear and one can be selected
  test('saved addresses appear and can be selected @smoke', async ({ page }) => {
    await page.goto('/checkout');

    // 1. Enter the returning guest email  2. Blur the field
    const email = page.getByLabel('Email');
    await email.fill('returning@example.com');
    await email.blur();

    // The lookup is debounced 300ms — wait for the response, never a sleep.
    await page.waitForResponse(
      (r) => r.url().includes('/api/addresses') && r.ok(),
    );

    // Expected: picker lists exactly 2 addresses
    const picker = page.getByRole('radiogroup', { name: 'Saved addresses' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('radio')).toHaveCount(2);

    // Expected: selecting the second fills the address fields
    await picker.getByRole('radio').nth(1).check();
    await expect(page.getByLabel('Address line 1')).toHaveValue('42 Bridge Street');
    await expect(page.getByLabel('Postcode')).toHaveValue('EC1A 1BB');

    // Expected: Place order becomes enabled
    await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  });

  // 2.2 No saved addresses — manual entry
  test('unknown email shows no picker and no error', async ({ page }) => {
    await page.goto('/checkout');

    const email = page.getByLabel('Email');
    await email.fill(`new-${Date.now()}@example.com`);
    await email.blur();

    await page.waitForResponse(
      (r) => r.url().includes('/api/addresses') && r.ok(),
    );

    // Expected: no picker, empty editable fields, and — importantly — no error
    await expect(page.getByRole('radiogroup', { name: 'Saved addresses' })).toBeHidden();
    await expect(page.getByLabel('Address line 1')).toHaveValue('');
    await expect(page.getByLabel('Address line 1')).toBeEditable();
    await expect(page.getByRole('alert')).toBeHidden();
  });

  // 4.1 Order completes and confirmation shows the order number
  test('order completes and confirmation shows the order number @smoke', async ({ page }) => {
    await page.goto('/checkout');

    const email = page.getByLabel('Email');
    await email.fill('returning@example.com');
    await email.blur();
    await page.waitForResponse((r) => r.url().includes('/api/addresses') && r.ok());
    await page.getByRole('radiogroup', { name: 'Saved addresses' }).getByRole('radio').first().check();

    // Click "Place order"
    await page.getByRole('button', { name: 'Place order' }).click();

    // Expected: navigates to confirmation
    await expect(page).toHaveURL(/\/checkout\/confirmation/);
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();

    // Expected: order number matches ORD-nnnnnn. Dynamic, so assert the pattern,
    // then assert it stays consistent across the page.
    const orderNumber = page.getByTestId('order-number');
    await expect(orderNumber).toHaveText(/^ORD-\d{6}$/);
    const value = await orderNumber.textContent();
    await expect(page.getByTestId('confirmation-email-notice')).toContainText(value!);

    // Expected: cart is emptied
    await expect(page.getByTestId('cart-badge')).toHaveText('0');
  });
});
