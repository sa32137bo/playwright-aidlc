// A drop-in replacement for `import { test, expect } from '@playwright/test'`
// that signs in automatically. Generated specs keep the exact same shape —
// `test('...', async ({ page }) => { ... })` — with zero syntax change; the
// `page` fixture itself is already signed in by the time the test body runs.
//
// Overrides the built-in `page` fixture rather than adding a new named one
// (`authenticatedPage`) on purpose: every spec across every real run reviewed
// signs in via `page` directly, in `beforeEach` or as the test's first line.
// Standardizing that as the default removes the boilerplate instead of
// asking every generated test to reference a differently-named fixture.
//
// Consistent with the kit's own non-negotiable: every test still signs in for
// itself rather than restoring a session (see playwright.config.ts's own
// comment on storageState — no bolt has tested whether it would even work
// against CrewHub), this just removes the repeated line.
import { test as base, expect } from '@playwright/test';
import { signIn, dismissCookieNotice } from './clc';

export const test = base.extend({
  page: async ({ page }, use) => {
    await signIn(page);
    // The cookie-consent modal loads with the post-sign-in page and intercepts
    // pointer events on everything under it — including the header's airline
    // dropdown, the first control most specs touch. Missing here cost a full
    // 488s timed-out run before this fixture had it (bolt US-CLC-001,
    // 2026-09-21): documented in environment-notes.md, applied ad hoc during
    // exploration, but never wired into the fixture every generated spec
    // actually depends on.
    await dismissCookieNotice(page);
    await use(page);
  },
});

export { expect };
