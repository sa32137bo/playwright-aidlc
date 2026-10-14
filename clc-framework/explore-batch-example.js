// Worked template for a BATCHED exploration pass — copy into .explore/ and
// edit, rather than starting a new pass from a blank file.
//
// Why this exists: signing in costs real time even on a fast app, and
// chaining unrelated screens into one script just to save a sign-in saves
// nothing if the two things were never going to run back-to-back anyway.
//
// Rule of thumb: one script per SESSION of related exploration, not one
// script per STEP. Start a new script (a new sign-in) only when beginning a
// genuinely separate investigation.
//
// Also demonstrates calling the shared module instead of retyping it: write
// against `clc.ts`'s own exports via the `tsx/cjs` interop below rather than
// hand-copying a function's body into a throwaway script — the two can drift
// apart silently otherwise.

// Paths below match this file's DEPLOYED location (.explore/<name>.js,
// copied from here), not its source location in clc-framework/ — same
// '../tests/support/...' every real .explore script already uses.
const path = require('path');
const { loadEnvLocal, launch, dump, dumpPager } = require('../tests/support/explore-harness.js');

require('tsx/cjs');
const { signIn, openAccountManagement, openHotelAdmin, openCreateHotelForm } = require('../tests/support/clc.ts');

loadEnvLocal(__dirname);

const BASE_URL = process.env.BASE_URL || 'https://crewhub-qa.taconnections.com/'; // .env.local wins, as in playwright.config.ts
const OUT = path.join(__dirname, 'out');

(async () => {
  const { browser, page } = await launch({ baseURL: BASE_URL });
  page.setDefaultTimeout(60_000);
  try {
    // --- one sign-in for the whole session ---------------------------------
    await signIn(page);
    console.log('[signed in]', page.url());

    // --- step 1: whatever is genuinely new about this pass ------------------
    await openAccountManagement(page);
    await openHotelAdmin(page);
    await dump(page, OUT, '01-hotel-admin');
    // Unscoped, on arrival, before assuming any grid on this screen shows
    // everything — see knowledge/org/exploration-notes.md and skills/e2e-plan
    // for why this is a first-arrival check, not an afterthought.
    await dumpPager(page, OUT, '01-hotel-admin');

    // --- step 2: continues in the SAME session, no second sign-in ----------
    await openCreateHotelForm(page);
    await dump(page, OUT, '02-create-hotel-form');

    // --- add further steps here as this pass's own investigation grows -----
    // Stop adding steps and start a new script (new sign-in) only when the
    // next thing to explore is not a continuation of this one.
  } finally {
    await browser.close();
  }
})();
