// Seed test — the single highest-leverage file in this setup.
//
// It bootstraps auth, fixtures and global state, and every generated test
// inherits its shape. The planner runs it to reach a usable starting point.
// A lazy seed test degrades everything downstream.
//
// It MUST pass before any bolt runs:  npx playwright test tests/seed.spec.ts

import { test, expect } from '@playwright/test';

test('seed', async ({ page }) => {
  await page.goto('/');

  // TODO: replace with whatever a real test needs to start.
  //
  // Typical shape — sign in once and persist the session so no test ever
  // handles a password:
  //
  //   await page.getByLabel('Email').fill(process.env.E2E_USER!);
  //   await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  //   await page.getByRole('button', { name: 'Sign in' }).click();
  //   await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  //   await page.context().storageState({ path: '.auth/user.json' });
  //
  // Credentials come from .env.local. Never hard-code them here.

  await expect(page).toHaveTitle(/.+/);
});
