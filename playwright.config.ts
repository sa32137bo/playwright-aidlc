import { defineConfig, devices } from '@playwright/test';

import fs from 'fs';
import path from 'path';

/**
 * Load credentials from .env.local (gitignored) into process.env.
 *
 * Deliberately a few lines rather than a dotenv dependency: this project has no
 * runtime deps and the format in .env.local is plain KEY=value. Existing
 * environment variables win, so CI can inject its own without editing a file.
 */
function loadEnvLocal() {
  const file = path.resolve(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(rawLine);
    if (!match) continue;
    const value = match[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvLocal();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Inherited from the earlier (non-CLC) project this kit was built on, where
   * every test signed in through an SSO widget at ~25s alone. CrewHub's own ASP.NET
   * Identity sign-in has been measured at ~7s across two bolts (2026-09-17,
   * 2026-09-18) — this value is UNCONFIRMED for CrewHub and likely
   * over-conservative now. Not lowered here without a live measurement of a
   * real spec's own worst-case duration; the next bolt that has headroom
   * should re-measure and tighten this rather than carry the old number
   * forward indefinitely. */
  timeout: 120_000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Inherited from the earlier (non-CLC) project this kit was built on, where
   * concurrent SSO sign-ins were confirmed to contend with each other at
   * workers 4. CrewHub's sign-in is a plain ASP.NET
   * Identity POST, not an SDK-driven IdP widget — no equivalent contention
   * has been observed OR ruled out here, because both source bolts
   * (2026-09-17, 2026-09-18) ran at workers 1 without ever testing higher.
   * Left conservative rather than assumed safe; a future bolt with headroom
   * to spend on a live workers:2+ comparison should update this comment with
   * what it finds either way. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`.
     * BASE_URL in .env.local overrides app.url from e2e.config.yml. */
    baseURL:
      process.env.BASE_URL ||
      'https://crewhub-qa.taconnections.com/',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* The QA cluster serves an internally-signed certificate whose root is not in
     * the OS trust store, so TLS verification fails against a host that is
     * otherwise healthy. Accept it for test traffic only. */
    ignoreHTTPSErrors: true,
  },

  /* Configure projects for major browsers */
  projects: [
    /* Credential smoke check: signs in for real and writes .auth/user.json.
     * Runs before the suite so a bad password fails once, here, with a clear
     * message — instead of failing every test with a redirect nobody reads. */
    {
      name: 'setup',
      testMatch: /seed\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'chromium',
      testIgnore: /seed\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    /* NOTE: `storageState` is deliberately NOT set on the chromium project,
     * even though e2e.config.yml specifies auth.strategy: "storage_state".
     *
     * The original reason recorded here was specific to the earlier (non-CLC)
     * project this kit was built on (an SSO SDK that discarded its own
     * restored token within seconds) and does not apply to CrewHub's plain
     * ASP.NET Identity sign-in — neither source bolt tested restoring a
     * storageState against CrewHub, so there is no live evidence either way
     * for this app. Kept off regardless: every test signing in for itself is
     * this kit's own baseline convention (never restore a session that
     * hides what the test actually depends on), not a CrewHub-specific
     * workaround. Revisit only if a real cost (not a hypothetical one) makes
     * that convention worth trading away for this project specifically. */

    /* e2e.config.yml sets execution.browsers: ["chromium"]. Firefox and WebKit
     * are left defined but commented out so the two files agree on what runs. */
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
