import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Sign-in seed for CLC QA (https://crewhub-qa.taconnections.com/).
 *
 * Every generated test follows this shape, and `planner_setup_page` /
 * `generator_setup_page` run it to reach an authenticated page.
 *
 * Credentials are read from the environment, which `playwright.config.ts`
 * loads from `.env.local` (gitignored). They are never written into this file,
 * into a plan, or into the audit log.
 *
 * Observed live, confirmed independently across two bolts (2026-09-17
 * "CLC_Automation" and 2026-09-18 "CLC_18_09"):
 *  - CrewHub authenticates with its own ASP.NET Identity form. `/` redirects
 *    to `/Identity/Account/Login` when signed out and serves the Home
 *    dashboard once signed in.
 *  - "Log In" must be matched exactly — "Log In SSO" is on the same screen.
 *  - Deep links DO work here: the server re-renders the whole page and the
 *    session survives, so tests may navigate by URL.
 *  - Sign-in takes ~7s — far cheaper than an Okta-style flow. Budget
 *    accordingly if this project's timeouts are ever re-tuned.
 */

const STORAGE_STATE = path.join(__dirname, '..', '.auth', 'user.json');

test('seed', async ({ page }) => {
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;

  expect(
    user,
    'E2E_USER is not set. Add it to .env.local (see .env.local.example).',
  ).toBeTruthy();
  expect(
    password,
    'E2E_PASSWORD is not set. Add it to .env.local (see .env.local.example).',
  ).toBeTruthy();

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Sign in only if we actually landed on the sign-in screen. This seed runs
  // both in a clean context (always challenged) and under the planner/
  // generator MCP tools, which may already carry a session.
  const emailField = page.getByRole('textbox', { name: 'Email Address' });
  const logoutButton = page.getByRole('button', { name: 'Logout' });

  // Wait for the app to settle into ONE of its two possible states rather
  // than guessing a timeout for a slow first render.
  await expect(async () => {
    const challenged = await emailField.isVisible();
    const authenticated = await logoutButton.isVisible();
    expect(challenged || authenticated).toBe(true);
  }).toPass({ timeout: 60_000 });

  if (await emailField.isVisible()) {
    await emailField.fill(user!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
  }

  // Asserting we have left the sign-in route matters: a rejected credential
  // re-renders the login page rather than failing loudly.
  await expect(page).not.toHaveURL(/\/Identity\/Account\/Login/, { timeout: 60_000 });
  await expect(logoutButton).toBeVisible({ timeout: 60_000 });
  await expect(emailField).toBeHidden();

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
});
