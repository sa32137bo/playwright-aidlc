// CLC shared interaction helpers — deployed by scripts/unpack.ps1 into every
// new CLC workspace at tests/support/clc.ts.
//
// CrewHub (https://crewhub-qa.taconnections.com/) is a server-rendered
// ASP.NET MVC app using Kendo UI widgets. Two consequences shape everything
// below:
//
//  1. Form inputs carry meaningful, stable `id`/`name` attributes but almost
//     no accessible names — their visible labels are plain text nodes, not
//     <label for>. `getByRole('textbox', { name })` cannot reach them. The
//     org locator policy's fallback applies: use the semantic id/name, with
//     a comment saying why. These are author-written names (`hotelName`,
//     `CrewRate`), not framework-generated hashes.
//  2. Kendo dropdownlists hide their real <input> and render a
//     `span.k-widget` with a popup list at `#<id>_listbox`. Some hold
//     thousands of options (Nearest Station has 2759), so they must be
//     filtered, never scrolled.
//
// Every locator and interaction pattern here was observed live against
// CrewHub, never invented — the same "never invent a locator" rule this
// whole kit holds every bolt to, applied to building the kit itself.
// Provenance is cited per section. A locator here can still go stale as the
// app changes — the next bolt that touches a given screen is expected to
// re-verify it live and update this file the same way it would its own
// generated spec, not trust it blindly forever.
//
// Sources synthesized:
//  - bolt US-CLC-001, run "CLC_Automation" (2026-09-17): full Hotel Admin
//    create journey, live-verified, all specs green — signIn,
//    dismissCookieNotice, kendoDropdown/kendoValue/kendoSelect,
//    globalAirline/selectGlobalAirline, openAccountManagement/openHotelAdmin,
//    hotelForm/openCreateHotelForm/fillHotelForm, the hotel toast and search
//    helpers, newHotelFixture.
//  - bolt US-CLC-001, run "CLC_18_09" (2026-09-18, exploration only — the run
//    paused after Gate 1 with nothing generated): independently reconfirmed
//    the ASP.NET Identity sign-in and the cookie dialog (the ~7s sign-in
//    timing is CLC_Automation's own measurement, not independently
//    reconfirmed here), plus the ambiguous "Minutes from Station"/
//    `#MilesFromStation` naming, and
//    the ten checkboxes sharing `id="maggFax"` in Contact Info — see
//    fillHotelForm's own comment on that below.
//  - bolt US-CLC-001, run "CLC" (2026-09-20): the first bolt to consume this
//    file rather than rewrite it from scratch, using knowledge/project/*
//    correctly throughout (its own retro: "this is the check that failed in
//    an earlier GHC run; it held here"). One heal (openHotelAdmin's
//    click-before-handler-bound race, fixed with a re-issued click inside
//    toPass()), and two new helpers it promoted here rather than keeping
//    local: submitHotelForm, hotelKeyCell.
//  - bolt US-CLC-003, same "CLC" workspace (2026-09-20, later that day):
//    reused openHotelAdmin's heal directly (its own retro: "the tab race...
//    was reused as openAccountTab, not rediscovered"), then generalised it
//    into openAccountTab for a second tab. Generalised kendoDropdown to wrap
//    a hidden <select> as well as <input>. Added a no-op guard to
//    selectGlobalAirline (Kendo raises no change event, and no request, when
//    the widget already shows the target value - waiting for one hangs for
//    the full timeout). Added the whole Alternate Hotel List section below
//    after a 3-attempt heal bound and an owner-authorized diagnostic sweep
//    found the real cause: the list grid is paginated, not capped.
//  - bolts US-CLC-001 and US-CLC-002, "CLC_21_09" workspace (2026-09-21): the
//    first re-run of US-CLC-001 against an already-populated clc.ts (1
//    exploration pass, down from 5-8) - and the first sign the airline-select
//    race (see openHotelAdminUnderAirline) is real rather than a one-off, an
//    intermittent failure across 6 controlled reproduction attempts. US-CLC-002
//    is new surface, Operations Management's Manual Entry screen, added below
//    as its own section after 7 exploration passes (4 spent on one lookup
//    quirk, D-8) and 3 heals.
//  - bolts US-CLC-001 and US-CLC-002, "CLC_21_09_1" workspace (2026-09-21,
//    later the same day): the second re-run of US-CLC-001 (1 exploration
//    pass, 0 heals - every helper held; the airline race did not reproduce
//    across 3 more journeys, still unresolved either way). US-CLC-002 this
//    time is Alternative Hotel List, not Manual Entry - a genuine repeat of
//    a screen already in this file, down to 3 exploration passes and 2 heals
//    from the first bolt's 8 and 3. Added altListEntriesByStation (the full
//    record set, including Comments, which has no grid column at all),
//    ALT_LIST_ADD, chooseUnlistedHotelKey and saveAltListEntry. Also added
//    pickupAirlineField, suggested by US-CLC-001's own retro but not
//    implemented by either bolt.
//  - bolts US-CLC-001 and US-CLC-002, "CLC_22_09" workspace (2026-09-22):
//    US-CLC-001 (Hotel Admin, 4 exploration passes, 2 heals) found
//    newHotelFixture()'s time fields had been silently wrong for five prior
//    bolts (a 12-hour value like '3:00 PM' was truncated by the Kendo
//    timepicker to '03:00' — 3 AM — because no earlier spec read a time field
//    back); fixed here, plus a hard `assert24HourTime` guard in
//    fillHotelForm so the same mistake cannot recur silently. US-CLC-002 is
//    new surface for a THIRD time — Transportation Manual Entry, a screen
//    unrelated to either of this bolt id's two prior uses — added below as
//    its own section after 7 exploration passes and 6 heals (4 applied). The
//    airline-propagation race reproduced on this second, unrelated screen,
//    confirming it as a property of the session switch rather than of Hotel
//    Admin specifically; openHotelAdminUnderAirline and
//    openTransportationManualEntryUnderAirline now share their retry logic
//    via openUnderAirline. Their two call sites were not actually identical
//    (Hotel Admin confirms the airline before the tab click, on an
//    intermediate page; Transportation confirms it on its own single
//    destination) — openUnderAirline takes that check point as a parameter
//    rather than forcing both screens into one shape, so each keeps its own
//    originally-verified behaviour.
//  - bolts US-CLC-001 and US-CH-MENT-001, "CLC_22_09_1_1" workspace
//    (2026-09-22): both known-screen estimates held (1 heal each). US-CLC-001
//    found the station dropdown's rendered text is uppercased by CSS while
//    its DOM text is mixed-case and padded — an expected literal copied from
//    `innerText()` fails `toHaveText`, which reads textContent. Fixed with
//    `STATION_DFW_TEXT`, an anchored case-insensitive regex, the same
//    hardening shape as `assert24HourTime`. US-CH-MENT-001 is Operations
//    Management's Manual Entry finally given its own bolt id (not a fourth
//    reuse of US-CLC-002) — confirmed this screen does NOT share the
//    Transportation screen's one-submit-per-crew-member limit, and added
//    `waitForDialog()` after finding this screen's confirmation can arrive
//    ~32s after Submit, plus a real conditional "Overlapping Layovers"
//    confirmation that a fixed dialog-count assertion cannot survive.
//
// This file is meant to grow. A bolt that discovers something new and
// genuinely reusable (not bolt-specific) should add it here, so a new
// workspace no longer starts from zero.

import { expect, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * True once sign-in has landed anywhere that is not the login form.
 *
 * Was a hard-coded `/crewhub-qa\.taconnections\.com\/?$/` until bolt
 * US-CLC-MISSINGCREWNAME-001 (2026-09-24) pointed `BASE_URL` at the UAT host
 * and every helper in this file stopped working — `signIn` waited 60s for a
 * hostname that could never appear. Expressed as "we have left the login page"
 * instead, which is the condition actually being waited on and is true on any
 * environment. `tests/seed.spec.ts` was unaffected because it does its own
 * sign-in, which is exactly why the breakage surfaced late.
 */
export const isAppReadyUrl = (url: URL): boolean =>
  !/\/Identity\/Account\/Login/i.test(url.pathname);

/**
 * Sign in through CrewHub's own ASP.NET Identity form — NOT an external IdP.
 * Confirmed independently in both source runs: `/` redirects to
 * `/Identity/Account/Login` when signed out, and back to `/` (Home) once
 * authenticated. Takes ~7s, far cheaper than an Okta-style flow — there is no
 * known reason yet to avoid `storageState`, unlike some other kit projects;
 * this still signs in per test regardless, per the kit's own non-negotiable.
 *
 * The email and password inputs DO expose accessible names, unlike most of
 * the rest of the application, so these are role+name per the locator
 * policy. "Log In" needs `exact: true`: the same page also carries a
 * "Log In SSO" button, and Playwright's name matching is substring by
 * default.
 */
export async function signIn(page: Page): Promise<void> {
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;
  if (!user || !password) {
    throw new Error('E2E_USER / E2E_PASSWORD are not set — add them to .env.local');
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Email Address' }).fill(user);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await page.waitForURL(isAppReadyUrl, { timeout: 60_000 });
}

/**
 * Dismiss the cookie notice.
 *
 * It renders as a modal dialog over the whole page and will intercept the
 * first click on anything underneath it. It re-appears on every full page
 * load, so this waits for it rather than probing once — a probe races the
 * dialog and loses on a slow render, and the interception that follows looks
 * like a broken locator rather than a missed dismissal.
 */
export async function dismissCookieNotice(page: Page): Promise<void> {
  const notice = page.getByRole('dialog').filter({ hasText: 'cookies' }).first();
  const appeared = await notice
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await notice.getByRole('button', { name: 'Close' }).first().click();
  await expect(notice).toBeHidden({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Kendo dropdownlist
// ---------------------------------------------------------------------------

/** The visible Kendo widget wrapping the hidden input or select with this id.
 * Kendo renders over either, depending on the field — Hotel Admin's dropdowns
 * wrap an `<input>`, the Alternate Hotel List's Hotel Key wraps a `<select>`. */
export function kendoDropdown(page: Page, id: string): Locator {
  return page.locator('span.k-widget').filter({ has: page.locator(`#${id}`) }).first();
}

/** The text the Kendo dropdown currently displays. */
export function kendoValue(page: Page, id: string): Locator {
  return kendoDropdown(page, id).locator('.k-input').first();
}

/**
 * Pick an option from a Kendo dropdownlist by the prefix its text starts
 * with — station codes render as "DFW | Dallas/ Ft. Worth", so an anchored
 * prefix is what makes "DFW" unambiguous in a 2759-entry list.
 *
 * The prefix is typed on the keyboard rather than filled into the popup's
 * filter box, and that is not a style choice. `fill()` scrolls its target
 * into view; the popup's filter sits above a list that is taller than the
 * viewport, so scrolling to it pushes the dropdown's own anchor off screen,
 * and Kendo closes a popup whose anchor has scrolled away. Observed live:
 * the filter applied (2759 options narrowed to 1) and the popup then closed
 * with that single option still in the DOM but invisible, which reads like a
 * missing element rather than a closed menu. Typing leaves the scroll
 * position alone.
 *
 * The list must be filtered, never scrolled: it is virtualised, so an
 * unfiltered option is not in the DOM to click.
 */
export async function kendoSelect(page: Page, id: string, prefix: string): Promise<void> {
  const widget = kendoDropdown(page, id);
  await widget.scrollIntoViewIfNeeded();
  await widget.click();
  await page.keyboard.type(prefix, { delay: 60 });
  const option = page
    .locator(`#${id}_listbox li`)
    .filter({ hasText: new RegExp(`^${prefix}`) })
    .first();
  await option.waitFor({ state: 'visible', timeout: 30_000 });
  await option.click();
  await expect(kendoValue(page, id)).toContainText(new RegExp(prefix, 'i'));
}

/**
 * The text a station Kendo dropdown actually holds once `DFW` is selected.
 *
 * The widget RENDERS "DFW   | DALLAS/ FT. WORTH" — uppercase, via a CSS
 * `text-transform` — but its DOM text is mixed case with padding spaces:
 * `"DFW   | Dallas/ Ft. Worth                       "`. `toHaveText` reads
 * textContent, so the rendered casing is NOT what it compares against, and an
 * expected string copied from a rendered/`innerText()` reading fails against
 * a screen that visibly shows exactly that text (confirmed live, bolt
 * US-CLC-001, "CLC_22_09_1_1" workspace, 2026-09-22 — one heal). Anchored and
 * case-insensitive, so it still asserts the full value rather than a loose
 * substring.
 */
export const STATION_DFW_TEXT = /^\s*DFW\s+\|\s+Dallas\/ Ft\. Worth\s*$/i;

// ---------------------------------------------------------------------------
// Global airline
// ---------------------------------------------------------------------------

/** The airline US-CLC-001 is written against. Verified present in the live list. */
export const AIRLINE_8C = '8C - Air Transport Int. (ATI)';

/**
 * The header's global airline Kendo dropdown, e.g.
 * "8C - Air Transport Int. (ATI)". Defaults to "2D - Eastern Airlines" on a
 * fresh session (confirmed live, CLC_18_09 exploration, 2026-09-18) — so a
 * bolt must select the airline it needs, never assume it is already set.
 */
export function globalAirline(page: Page): Locator {
  return page.locator('#MainAirline span.k-dropdown-wrap');
}

/**
 * Switch the global airline.
 *
 * Waits for `UpdateUsersSessionsAirline` rather than for the dropdown's own
 * text, and that distinction is load-bearing: the Kendo widget updates its
 * label immediately, but the airline only takes effect once the server has
 * recorded it against the session. Asserting on the label alone passes a
 * moment too early, and the next page load then renders under the PREVIOUS
 * airline — observed live as a pickup Airline field reading "2D" on a form
 * opened right after selecting "8C" (bolt US-CLC-001, CLC_Automation run,
 * first `navigation.spec.ts` execution).
 *
 * Selecting an airline also triggers a dashboard refresh, so callers must not
 * assume the page they were on survives this call.
 */
export async function selectGlobalAirline(page: Page, label: string): Promise<void> {
  // The widget's wrapper exists and is readable before Kendo has written the
  // session's real airline into it, so `innerText()` can return an empty or
  // stale value on a slow render. Settle it first, or the no-op guard below
  // decides on a value the widget was never actually showing — see the guard's
  // own note for why that particular misread hangs for the full timeout rather
  // than failing fast. Confirmed live as a heal (bolt US-CLC-001, 2026-09-24):
  // the failure snapshot showed the widget holding the target airline all
  // along, with the run stuck waiting for a switch request Kendo never sent.
  await expect(globalAirline(page)).toHaveText(/\S+\s+-\s+\S/, { timeout: 30_000 });

  // Kendo raises `change` only on an actual change, so no request is sent when
  // the widget already shows the wanted airline — waiting for one then hangs
  // for the full timeout (observed live, bolt US-CLC-003, 2026-09-20). There is
  // no race to guard against in that case: nothing is being switched.
  if ((await globalAirline(page).innerText()).trim() === label) return;

  const code = label.split(' - ')[0];
  await globalAirline(page).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`UpdateUsersSessionsAirline?airline=${code}`) && r.ok(),
      { timeout: 60_000 },
    ),
    page.locator('#GlobalAirline_listbox li').filter({ hasText: label }).first().click(),
  ]);
  await expect(globalAirline(page)).toHaveText(label);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Open Account Management.
 *
 * Navigated by URL rather than through the left rail on purpose, and this is
 * a live-verified decision rather than a shortcut: the rail's entries are
 * icon-only anchors whose labels are present in the DOM but not rendered
 * while the sidebar is collapsed — a click on the collapsed anchor was
 * observed to do nothing at all, confirmed independently in both source
 * runs (an accessibility defect, not something to route around silently: a
 * screen reader user hits the same empty-name problem). Deep links DO work
 * in CrewHub — the server re-renders the full page and the global airline
 * selection survives it.
 */
export async function openAccountManagement(page: Page): Promise<void> {
  await page.goto('/AccountManagement/Dashboard', { waitUntil: 'domcontentloaded' });
  await dismissCookieNotice(page);
  await expect(page.getByRole('tab', { name: 'Hotel Admin', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Click an Account Management tab and wait for its panel to actually appear.
 *
 * The tab strip renders and is clickable before its own click handler is bound:
 * a click that lands inside that window is accepted silently and switches
 * nothing — observed live (bolt US-CLC-001, 2026-09-20) as `Allocations` still
 * being the selected tab 60s after a successful click on `Hotel Admin`, with no
 * error of any kind (a heal, classified as a flake/race, not a product bug).
 * The click is therefore re-issued until the panel actually appears, rather
 * than waited out with a fixed sleep that would be wrong on both a fast and a
 * slow render. Generalised from that single-tab fix (bolt US-CLC-003,
 * 2026-09-20) once a second tab needed the identical guard.
 */
export async function openAccountTab(page: Page, name: string, panel: Locator): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(panel).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

/** Open the Hotel Admin tab within Account Management. */
export async function openHotelAdmin(page: Page): Promise<void> {
  await openAccountTab(page, 'Hotel Admin', page.getByRole('heading', { name: 'Hotel Admin', level: 1 }));
  await expect(page.getByRole('button', { name: 'Create New Hotel', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Reach a screen with a known global airline in effect, retrying the whole
 * select-then-navigate sequence until `navigate`'s own destination confirms it.
 *
 * Selecting the airline and then navigating is not enough on its own:
 * `UpdateUsersSessionsAirline` returning 200 was observed NOT to guarantee that
 * the next page renders under the new airline. First seen on Hotel Admin, bolt
 * US-CLC-001 (2026-09-21): a Create New Hotel form pre-filled its pickup
 * Airline with `2D` in a test that had switched to `8C` and waited for that
 * response — intermittently: once in a full suite run, never in six controlled
 * reproductions afterwards. Recurred on a second, unrelated screen
 * (Transportation Manual Entry, bolt US-CLC-002, "CLC_22_09" workspace,
 * 2026-09-22), confirming it is a property of the session switch itself, not
 * of either screen. This one function now holds the shared retry shape both
 * screens need — their two call sites differ (Hotel Admin confirms on the
 * intermediate Account Management page before switching tabs; Transportation
 * confirms on its own single destination), which is why `navigate` and the
 * optional post-confirmation `then` step are separate parameters rather than
 * one combined callback: collapsing them would have moved Hotel Admin's
 * proven, live-verified check point without any new evidence to justify it.
 *
 * The airline is confirmed on `navigate`'s destination, where it actually
 * matters, and the whole sequence is re-issued if it does not hold — the same
 * "re-issue the action until its observable effect appears" shape as
 * `openAccountTab` above, not a longer timeout on the same single attempt. If
 * this throws, the failure message names which airline was expected, which is
 * the one fact the original intermittent failure did not record.
 */
export async function openUnderAirline(
  page: Page,
  airlineLabel: string,
  navigate: () => Promise<void>,
  opts: { then?: () => Promise<void>; timeoutMs?: number } = {},
): Promise<void> {
  const { then, timeoutMs = 120_000 } = opts;
  await expect(async () => {
    await selectGlobalAirline(page, airlineLabel);
    await navigate();
    await expect(
      globalAirline(page),
      `Page rendered under the wrong global airline after selecting ${airlineLabel}`,
    ).toHaveText(airlineLabel, { timeout: 15_000 });
  }).toPass({ timeout: timeoutMs });
  if (then) await then();
}

/**
 * Reach Hotel Admin with a known global airline in effect.
 *
 * The airline is confirmed on Account Management — the page that renders
 * immediately after the airline switch — before the Hotel Admin tab is even
 * clicked, exactly as originally verified live (bolt US-CLC-001,
 * "CLC_21_09"/"CLC_21_09_1" workspaces, 2026-09-21); `openHotelAdmin` itself
 * runs once the airline is confirmed, not inside the retried block.
 */
export async function openHotelAdminUnderAirline(page: Page, airlineLabel: string): Promise<void> {
  await openUnderAirline(page, airlineLabel, () => openAccountManagement(page), {
    then: () => openHotelAdmin(page),
    timeoutMs: 90_000,
  });
}

// ---------------------------------------------------------------------------
// Create New Hotel form
// ---------------------------------------------------------------------------

/** The Create New Hotel form. Scope EVERY field lookup to this — the page
 * carries several other hidden forms reusing the same `name` attributes
 * (`FaxNumber1` alone resolves to two elements document-wide unscoped). */
export function hotelForm(page: Page): Locator {
  return page.locator('#hotelAdminForm');
}

/** Reveal the Create New Hotel entry form on the Hotel Admin tab. */
export async function openCreateHotelForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create New Hotel', exact: true }).click();
  await expect(hotelForm(page).locator('#hotelName')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
}

/**
 * The form's own pickup Airline field — `readonly`, pre-filled from the
 * global airline (discrepancy D-4: the story describes this as something the
 * user selects; it is not). Assert this holds the target airline's CODE
 * (e.g. `'8C'`, not the full label) wherever a spec needs to confirm the
 * header airline actually propagated to the form — the cheapest available
 * proof of the intermittent `openHotelAdminUnderAirline` race, which has not
 * reproduced on every run it was checked on (see
 * `knowledge/project/clc-known-flaky-areas.md`). Promoted here so this
 * assertion has one named home instead of being retyped as a raw id in every
 * spec that needs it (confirmed live, bolt US-CLC-001, 2026-09-21).
 */
export function pickupAirlineField(page: Page): Locator {
  return hotelForm(page).locator('#createHotelAirline');
}

/**
 * The Hotel Admin toast. Header and body are separate elements — the header
 * carries "Success" or "Invalid", the body carries the message text (e.g.
 * "Hotel Created.", or the generic "Error: Bad request" a rejected duplicate
 * name AND a rejected duplicate phone both produce — CrewHub gives no way to
 * tell the two apart from the toast alone). Hidden via a `d-none` class
 * rather than removal, so assert on visibility, not on presence.
 */
export const hotelToast = (page: Page): Locator => page.locator('#hotelAdminCustomToast');
export const hotelToastHeader = (page: Page): Locator => page.locator('#hotelAdminToastHeadertxt');
export const hotelToastBody = (page: Page): Locator => page.locator('#hotelAdminToastBody');

/** A unique suffix so records created by a run never collide with another's. */
export function uniqueStamp(): string {
  return String(Date.now());
}

/**
 * Submit the Create New Hotel form and resolve with the save response.
 *
 * The status is the only unambiguous signal of what happened: the toast
 * reports a rejection as header "Invalid" / body "Error: Bad request"
 * whatever the cause (discrepancy D-3 — a duplicate name and a duplicate
 * phone produce the identical toast), so a test that wants to know the save
 * was actually refused has to look at the request. Observed live
 * (2026-09-20): 200 on a unique hotel, 400 on a duplicate name.
 */
export async function submitHotelForm(page: Page) {
  const saved = page.waitForResponse(
    (r) => r.url().includes('/AccountManagement/HotelAdmin/SaveHotel') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Submit' }).click();
  return saved;
}

/**
 * The Hotel key cell of a search result row.
 *
 * Rows render as `<span>key</span><span>station</span><span><strong>name</strong>
 * </span><span>phone</span><button>EDIT</button>` — no accessible name on any
 * cell, so position within the row is the only handle. Observed live
 * (2026-09-20, exploration pass 2).
 */
export function hotelKeyCell(row: Locator): Locator {
  return row.locator('span').first();
}

// ---------------------------------------------------------------------------
// Hotel Admin lookups
// ---------------------------------------------------------------------------

/** "Search by Hotel Name : N hotels found." Absent entirely when nothing matched. */
export const searchResultCount = (page: Page): Locator => page.locator('#hotelsearchResultCount');

/** One result row. Hotel key is its first column; the name is the row's <strong>. */
export const searchResultRows = (page: Page): Locator =>
  page.locator('#hotelsearchResults > div.row');

/**
 * Run the Hotel Name lookup.
 *
 * The lookup buttons are all labelled "Search" — four of them on this screen —
 * with no accessible name to tell them apart, so each is reached through the
 * `input-group` holding its own input. That grouping is the org locator
 * policy's documented last resort for a control with no other handle.
 */
export async function searchHotelsByName(page: Page, term: string): Promise<void> {
  await page.locator('#txtSearchHotelByName').fill(term);
  await page
    .locator('div.input-group')
    .filter({ has: page.locator('#txtSearchHotelByName') })
    .getByRole('button', { name: 'Search' })
    .click();
}

/** Open a hotel record into the form via the Hotel key lookup. */
export async function openHotelByKey(page: Page, hotelKey: string): Promise<void> {
  await page.locator('#searchByHotelKey').fill(hotelKey);
  await page
    .locator('div.input-group')
    .filter({ has: page.locator('#searchByHotelKey') })
    .getByRole('button', { name: 'Go' })
    .click();
}

// ---------------------------------------------------------------------------
// Filling the Create New Hotel form
// ---------------------------------------------------------------------------

export interface NewHotel {
  /** Digits and spaces only. The field's own tooltip demands E.123 format
   * ("+16502001234") but its `pattern` attribute rejects the `+` — a real
   * usability defect (bolt US-CLC-001 discrepancy D-1), not something a
   * fixture should route around by "helpfully" stripping the plus sign. */
  phone: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  /** Station code prefix, e.g. "DFW". Used for both Nearest Station and pickup Station. */
  station: string;
  minutesFromStation: string;
  minutesFromRamp: string;
  checkInTime: string;
  checkOutTime: string;
  cancelDeadlineTime: string;
  currency: string;
  crewRate: string;
  corpRate: string;
  fboRate: string;
  commissionPercent: string;
  faxPrefix: string;
}

/**
 * Fill every field the Create New Hotel form needs to be submittable.
 *
 * Wider than the story's own field list, and deliberately so: the form also
 * requires Check Out Time, a cancellation deadline and Contact1–5 (the last
 * pre-filled as "Front Desk"), none of which the story mentions (discrepancy
 * D-4).
 *
 * `#MilesFromStation`'s visible label reads "Minutes from Station" — the
 * label and the underlying field name disagree on the unit, confirmed live
 * (CLC_18_09 exploration, D-3). Not resolved here: source grounding is off
 * for this project, so which one is actually wrong is a question for a
 * developer, not something this helper should guess at by converting units.
 *
 * The ten Fax/Email toggle checkboxes in Contact Info all share
 * `id="maggFax"` — invalid HTML, confirmed live (CLC_18_09 exploration,
 * D-4) — so they cannot be reached by id at all; this form only fills the
 * Fax/Email text inputs, never the checkboxes, for exactly that reason.
 */
/** Matches `HH:MM` in 24-hour time, e.g. `03:00` or `15:00`. */
const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

function assert24HourTime(fieldName: string, value: string): void {
  if (!TIME_24H.test(value)) {
    throw new Error(
      `${fieldName} must be 24-hour "HH:MM" (e.g. "15:00"), got "${value}". ` +
        `The Kendo timepicker silently truncates an "h:mm AM/PM" value instead ` +
        `of rejecting it — this shared fixture supplied "3:00 PM"-style values ` +
        `undetected for five prior CLC bolts (see clc-known-flaky-areas.md).`,
    );
  }
}

export async function fillHotelForm(page: Page, hotel: NewHotel): Promise<void> {
  assert24HourTime('checkInTime', hotel.checkInTime);
  assert24HourTime('checkOutTime', hotel.checkOutTime);
  assert24HourTime('cancelDeadlineTime', hotel.cancelDeadlineTime);

  const form = hotelForm(page);

  await form.locator('#hotelMainPhone').fill(hotel.phone);
  await form.locator('#hotelName').fill(hotel.name);
  await form.locator('#StreetAddressLine1').fill(hotel.street);
  await form.locator('#City').fill(hotel.city);
  await form.locator('#StateProvince').fill(hotel.state);
  await form.locator('#ZipCode').fill(hotel.zip);
  await form.locator('#CountryCode').fill(hotel.country);
  await kendoSelect(page, 'NearestStation', hotel.station);
  await form.locator('input[name="MilesFromStation"]').fill(hotel.minutesFromStation);
  await form.locator('input[name="MinutesFromRampOrFbo"]').fill(hotel.minutesFromRamp);

  // Choosing "Check In/Out" reveals a Check Out Time that is required but not
  // present beforehand — wait for it rather than assuming it rendered.
  await form.locator('#hotelAdminLayoverCode').selectOption({ label: 'Check In/Out' });
  const checkOutTime = form.locator('input[name="CheckOutTime"]');
  await expect(checkOutTime).toBeVisible();
  await form.locator('input[name="CheckInTime"]').fill(hotel.checkInTime);
  await checkOutTime.fill(hotel.checkOutTime);

  // Same shape: the deadline field only exists once a deadline cancel code is chosen.
  await form.locator('#hotelAdminCancelCode').selectOption({ label: 'By Deadline (same day)' });
  const cancelDeadline = form.locator('input[name="CancelDeadlineTime"]');
  await expect(cancelDeadline).toBeVisible();
  await cancelDeadline.fill(hotel.cancelDeadlineTime);

  await kendoSelect(page, 'StationCode', hotel.station);

  await form.locator('#faxEmailPanel input[name="FaxNumber1"]').fill(`${hotel.faxPrefix}1`);
  await form.locator('#emailsForValidation').fill('maag@example.com');
  await form.locator('#faxEmailPanel input[name="FaxNumber2"]').fill(`${hotel.faxPrefix}2`);
  await form.locator('#email2').fill('dcr@example.com');
  await form.locator('#faxEmailPanel input[name="FaxNumber3"]').fill(`${hotel.faxPrefix}3`);
  await form.locator('#email3').fill('adhoc@example.com');
  await form.locator('#faxEmailPanel input[name="FaxNumber4"]').fill(`${hotel.faxPrefix}4`);
  await form.locator('#email4').fill('recon@example.com');
  await form.locator('#faxEmailPanel input[name="FaxNumber5"]').fill(`${hotel.faxPrefix}5`);
  await form.locator('#email5').fill('commiss@example.com');

  await kendoSelect(page, 'CreditCardCurrencyCode', hotel.currency);
  await form.locator('#CrewRate').fill(hotel.crewRate);
  await form.locator('#StandardRoomRate').fill(hotel.corpRate);
  await form.locator('#Fborate').fill(hotel.fboRate);
  await form.locator('input[name="CommissionRate"]').fill(hotel.commissionPercent);
}

/**
 * A complete, valid hotel whose name and phone are unique to this call.
 *
 * The phone must vary per run, not just the name: CrewHub rejects a duplicate
 * hotel phone exactly as silently as a duplicate name (discrepancy D-3 in
 * plan.md — a different D-3 than fillHotelForm's field-label mismatch above;
 * both bolts numbered their own discrepancies independently).
 *
 * The three time fields are 24-hour `HH:MM`, not `h:mm AM/PM` — confirmed
 * live (bolt `US-CLC-001`, run-6, 2026-09-22). This fixture supplied
 * `'3:00 PM'`-style values for five prior bolts; the Kendo timepicker kept
 * only the `3:00` and silently dropped the AM/PM part, so every hotel any
 * CLC bolt has ever created has a 3 AM check-in, not 3 PM. Nothing caught it
 * because no earlier spec read a time field back — this bolt's was the
 * first to assert an entered value.
 */
export function newHotelFixture(overrides: Partial<NewHotel> = {}): NewHotel {
  const stamp = uniqueStamp();
  return {
    phone: `214${stamp.slice(-7)}`,
    name: `AIDLC-${stamp}`,
    street: '100 Test Parkway',
    city: 'Dallas',
    state: 'TX',
    zip: '75261',
    country: 'US',
    station: 'DFW',
    minutesFromStation: '15',
    minutesFromRamp: '20',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    cancelDeadlineTime: '18:00',
    currency: 'USD',
    crewRate: '100',
    corpRate: '120',
    fboRate: '130',
    commissionPercent: '10',
    faxPrefix: `21455500${stamp.slice(-1)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Alternate Hotel List
//
// Every locator below was observed live during bolt US-CLC-003 (2026-09-20,
// 8 exploration passes). Note the app's own spelling: the TAB is labelled
// "Alternative Hotel List" but the screen heading, the form id and the save
// endpoint all say "Alternate" (bolt US-CLC-003 discrepancy D-1).
// ---------------------------------------------------------------------------

/** The station search box on the Alternate Hotel List screen. */
export const altListStationSearch = (page: Page): Locator => page.locator('#searchHotelListByStation');

/** Open the Alternative Hotel List tab within Account Management. */
export async function openAlternateHotelList(page: Page): Promise<void> {
  await openAccountTab(page, 'Alternative Hotel List', altListStationSearch(page));
  await expect(page.getByRole('button', { name: 'Add New', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/** The Add New Hotel dialog's form. Scope every field lookup to it. */
export const altListAddForm = (page: Page): Locator => page.locator('#alternateHotelListAddNewForm');

/** The Kendo notification the save raises, e.g. "Hotel List Created." */
export const altListNotification = (page: Page): Locator => page.locator('.k-notification-success');

/**
 * One rendered list row.
 *
 * Rows carry no id, role or accessible name of any kind, so they are reached
 * structurally and then narrowed by the text of the record being checked — the
 * org locator policy's documented last resort. The selector matches more than
 * `div.row`: not every row of this grid carries that class (confirmed live —
 * a `div.row`-only selector found zero rows on a screen that was visibly
 * showing ten).
 */
export const ALT_LIST_ROW_SELECTOR = 'div.row, tr, [class*="row"]';

export function altListRow(page: Page, text: string): Locator {
  return page.locator(ALT_LIST_ROW_SELECTOR).filter({ hasText: text }).last();
}

/**
 * Search the list by station and return the Hotel Keys of EVERY entry already
 * on that station's list — not just the ones on screen.
 *
 * The grid is paginated at 10 rows a page ("1 - 10 of 108 items" for 8C/DFW),
 * so what is rendered is not what is listed. Choosing a hotel from the rendered
 * page alone picks one that is already listed roughly nine times out of ten,
 * and CrewHub answers a duplicate with a silent no-op that is indistinguishable
 * from a hung save (bolt US-CLC-003, D-4). The station search's own
 * `GetAlternateHotelList` response carries the full set, so that is the source
 * of truth used here. Keys are matched out of the payload by regex rather than
 * by parsing a shape nothing documents — verified against the real 57KB
 * response (2026-09-20).
 *
 * A bare key list is all this returns. Need any other field on a listed
 * entry (Comments, ListOrder, the rest) — use `altListEntriesByStation()`
 * below instead, which reads the same response's full record set. The two
 * are not yet folded into one function (bolt US-CLC-002's own suggestion,
 * "CLC_21_09_1" workspace, 2026-09-21 — a different bolt from the Manual
 * Entry US-CLC-002 below, despite the shared id) because
 * `chooseUnlistedHotelKey()` depends on this one's exact return shape and
 * folding them was not exercised live by that bolt — do that consolidation
 * with a live re-verification, not as a desk change.
 */
export async function searchAltListByStation(page: Page, station: string): Promise<string[]> {
  const responded = page.waitForResponse(
    (r) =>
      r.url().includes('/AccountManagement/AlternativeHotelList/GetAlternateHotelList') &&
      r.url().includes(`station=${station}`) &&
      r.ok(),
    { timeout: 60_000 },
  );
  await altListStationSearch(page).fill(station);
  await page.locator('#searchHotelListByStationBtn').click();
  const body = await (await responded).text();
  await expect(page.getByText('Order Description').first()).toBeVisible({ timeout: 60_000 });
  const keys = (body.match(/"HotelKey"\s*:\s*"?(\d+)"?/gi) || []).map((m) => m.replace(/\D/g, ''));
  return Array.from(new Set(keys));
}

/**
 * The Hotel Keys of the rows currently rendered — page 1 of the grid only.
 *
 * @deprecated Doubly outclassed as of bolt US-CLC-002, "CLC_21_09_1"
 * workspace (2026-09-21): for "is this hotel already listed?" use
 * `searchAltListByStation()`'s return value;
 * for any other field on a listed entry (Comments, ListOrder, ...) use
 * `altListEntriesByStation()`. Both read the same unpaginated search
 * response this one cannot see past page 1 of. The bolt that added those two
 * called this one "a trap for the next bolt" — kept rather than deleted only
 * because nothing has confirmed no generated spec still calls it; if a spec
 * search turns up none, delete it rather than carry it further.
 *
 * Read with `evaluate` because the rows carry no handle. A row reads
 * `<order> <order description> <hotel key> <hotel name> …`, and the description
 * is one or more words ("Short", "Short/Long", "Backup Hotels"), so the key is
 * matched by shape rather than by column position.
 */
export async function altListHotelKeys(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const visible = (e: Element) => !!(e as HTMLElement).getClientRects().length;
    return Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      .map((t) => /^\d+ (?:\S+ ){1,3}?(\d+) /.exec(t))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]);
  }, ALT_LIST_ROW_SELECTOR);
}

/** Open the Add New Hotel dialog. */
export async function openAddNewHotelListDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add New', exact: true }).click();
  await expect(altListAddForm(page).locator('#addNewListOrderInput')).toBeVisible({ timeout: 60_000 });
}

/**
 * The Hotel Key options currently offered, as full option text
 * ("10971 - DFW - AC Hotel Dallas by the Galleria").
 *
 * The list is repopulated by the Station field's own `onchange`, so it is empty
 * until a station is chosen, and it is virtualised — this reads what is
 * rendered, which is the same set a user could click without scrolling.
 */
export async function altListHotelKeyOptions(page: Page): Promise<string[]> {
  await kendoDropdown(page, 'alternateHotelListHotelKeyDropdown').click();
  const items = page.locator('#alternateHotelListHotelKeyDropdown_listbox li');
  await items.first().waitFor({ state: 'visible', timeout: 60_000 });
  return (await items.allInnerTexts()).map((t) => t.trim());
}

/** Pick a Hotel Key option by its exact text. The list must already be open. */
export async function chooseAltListHotelKey(page: Page, optionText: string): Promise<void> {
  await page
    .locator('#alternateHotelListHotelKeyDropdown_listbox li')
    .filter({ hasText: optionText })
    .first()
    .click();
  await expect(kendoDropdown(page, 'alternateHotelListHotelKeyDropdown')).toContainText(optionText);
}

/**
 * Every entry on a station's list, as the records the grid itself is bound to.
 *
 * The station-search response is an HTML fragment carrying a Kendo grid
 * definition whose `"Data":[...]` array holds the full, unpaginated set —
 * confirmed live (bolt US-CLC-002, "CLC_21_09_1" workspace, 2026-09-21 — a
 * different bolt from the Manual Entry US-CLC-002 further down this file,
 * despite the shared id) by reading the real 62KB response. Each record
 * carries `AlternateHotelListId`, `HotelKey`, `HotelName`, `StationCode`,
 * `AirlineSymbol`, `ListOrder`, `ListOrderDescription`, `Comments`,
 * `LastQuotedRoomRate` and contract/date fields.
 *
 * Use this, not the rendered rows, to check what was saved: the grid pages at
 * 10 rows and sorts by list order, so a new entry frequently is not on page 1 —
 * which is exactly what made a DOM-row assertion fail on the very first run of
 * this bolt's own create test. `Comments` is in the data but has NO column in
 * the grid (this bolt's own discrepancy D-2), so it can only be checked here.
 */
export async function altListEntriesByStation(
  page: Page,
  station: string,
): Promise<Array<Record<string, unknown>>> {
  const responded = page.waitForResponse(
    (r) =>
      r.url().includes('/AccountManagement/AlternativeHotelList/GetAlternateHotelList') &&
      r.url().includes(`station=${station}`) &&
      r.ok(),
    { timeout: 60_000 },
  );
  await altListStationSearch(page).fill(station);
  await page.locator('#searchHotelListByStationBtn').click();
  const body = await (await responded).text();
  await expect(page.getByText('Order Description').first()).toBeVisible({ timeout: 60_000 });

  const start = body.indexOf('"Data":[');
  if (start < 0) throw new Error('station search response carried no "Data" array');
  let depth = 0;
  let end = -1;
  for (let i = start + '"Data":'.length; i < body.length; i++) {
    if (body[i] === '[') depth++;
    else if (body[i] === ']' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error('station search response held an unterminated "Data" array');
  return JSON.parse(body.slice(start + '"Data":'.length, end));
}

/**
 * The Add New dialog's own fields. Added by bolt US-CLC-002, "CLC_21_09_1"
 * workspace (2026-09-21), from the dialog's live inventory — 5 controls, of
 * which only ListOrder and LastQuotedRoomRate are `required`, despite the
 * story calling Comments required too (this bolt's own discrepancy D-3).
 *
 * The dialog's Station field is `alternateHotelListAddnewStation` — NOT the
 * screen's own `#searchHotelListByStation`, and not `...StationDropdown`, which
 * does not exist and cost this bolt an exploration pass. Comments and the rate
 * carry no id at all, so they are reached by `name` within the dialog.
 */
export const ALT_LIST_ADD = {
  station: 'alternateHotelListAddnewStation',
  hotelKey: 'alternateHotelListHotelKeyDropdown',
  listOrder: '#addNewListOrderInput',
  comments: 'textarea[name="Comments"]',
  rate: 'input[name="LastQuotedRoomRate"]',
} as const;

/**
 * Pick the first Hotel Key option for a station that is NOT already on its list.
 *
 * `alreadyListed` must come from `searchAltListByStation` (the full set from the
 * search response), never from the rendered rows: re-adding a listed hotel is a
 * silent no-op, and the grid only shows 10 of 100+ entries. Returns the full
 * option text and the bare key. Throws rather than falling back to an arbitrary
 * option — a save that silently does nothing is worse than a clear failure.
 */
export async function chooseUnlistedHotelKey(
  page: Page,
  alreadyListed: string[],
): Promise<{ option: string; key: string }> {
  const options = await altListHotelKeyOptions(page);
  const option = options.find((o) => {
    const key = /^(\d+)/.exec(o)?.[1];
    return key !== undefined && !alreadyListed.includes(key);
  });
  if (!option) {
    throw new Error(
      `Every one of the ${options.length} Hotel Key options offered is already on this station's list — ` +
        'no hotel left to add without hitting the silent-no-op duplicate path.',
    );
  }
  await chooseAltListHotelKey(page, option);
  return { option, key: /^(\d+)/.exec(option)![1] };
}

/**
 * Save the Add New dialog and resolve with the create response.
 *
 * The status is what distinguishes a real save from the duplicate no-op, which
 * also returns 200 but raises no notification and leaves the dialog open — so
 * callers assert the notification and the dialog closing as well, not the status
 * alone. Observed live (2026-09-21): `POST CreateAlternateHotelList` 200, then
 * "Hotel List Created." and the dialog closing.
 */
export async function saveAltListEntry(page: Page) {
  const saved = page.waitForResponse(
    (r) => r.url().includes('/AlternativeHotelList/CreateAlternateHotelList') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return saved;
}

// ---------------------------------------------------------------------------
// Operations Management — Manual Entry
//
// Added by bolt US-CLC-002, "CLC_21_09" workspace (2026-09-21). Every locator
// and behaviour below was observed live across that bolt's 7 exploration
// passes; none was inferred from the story or the BPD, neither of which names
// a single field. NOTE: a later bolt reused the id US-CLC-002 for an entirely
// different screen (Alternative Hotel List, "CLC_21_09_1" workspace, same
// day) — every "US-CLC-002" reference in THIS section means the Manual Entry
// bolt specifically; its own D-1..D-8 numbering has no relation to the other
// bolt's.
//
// Note `ManualEntryPostition` — the app's own typo, not one here (US-CLC-002
// discrepancy D-5). Spelling it correctly finds nothing.
// ---------------------------------------------------------------------------

export const MANUAL_ENTRY = {
  crewId: '#ManualEntryCrewId',
  position: '#ManualEntryPostition',
  costCenter: '#ManualEntryCostCenter',
  arrivalFlight: '#ManualEntryArrivalFlight',
  arrivalStation: '#ManualEntryArrivalStation',
  arrivalDate: '#ManualEntryFromDateArrival',
  departureFlight: '#ManualEntryDepartureFlight',
  departureStation: '#ManualEntryDepartureStation',
  departureDate: '#ManualEntryFromDateDeparture',
  reason: '#ManualEntryReason',
} as const;

/** Known-good Manual Entry data, all confirmed live on 2026-09-21. */
export const MANUAL_ENTRY_DATA = {
  crewSearch: 'smith',
  /** 10 matches live; this one is preferred so the employee id in the
   * confirmation dialog is predictable. */
  crewPrefer: 'SMITH,  JEFFREY',
  crewEmployeeId: '1322',
  position: 'COR - Corporate Employee',
  /** Deliberately NOT the first option — that is the literal string "Not Used",
   * which saves successfully and records a cost centre of "NA" (D-4). */
  costCenter: 'CAM DELIVERY PILOTS (FOR ALL TRIPS AND TRAINING)',
  arrivalFlight: 'FX1234',
  arrivalStation: 'AUS',
  departureFlight: 'FX5678',
  departureStation: 'AUS',
} as const;

/**
 * A crew member whose employee id is FIVE digits, plus the Position and Cost
 * Center that were confirmed selectable for them.
 *
 * Added for bolt US-CH-MENT-001 (2026-09-24) on an explicit owner instruction
 * that every scenario use a 5-digit employee id. `MANUAL_ENTRY_DATA` above is
 * left untouched rather than edited: its 4-digit `1322` is a separate
 * live-confirmed QA fact that other workspaces' notes already cite, and
 * silently repointing it would invalidate those citations.
 *
 * All of this was observed live, not assumed — `smith` and four other queries
 * returned only 4-digit ids; `john` was the first query to return a 5-digit
 * one. The chip this produces reads `John,  Peter ~ 19999 | COR | 145CAM`.
 */
export const MANUAL_ENTRY_CREW_5DIGIT = {
  crewSearch: 'john',
  /** Matched on the id, not the name — `john` returns 10 options and only this
   * one has a 5-digit id, so the id is the unambiguous handle. */
  crewPrefer: '19999',
  crewEmployeeId: '19999',
  position: 'COR - Corporate Employee',
  /** Not the first option: that is the literal "Not Used", which saves and
   * records a cost centre of NA. Renders in the chip as the code `145CAM`. */
  costCenter: 'CAM DELIVERY PILOTS (FOR ALL TRIPS AND TRAINING)',
  costCenterCode: '145CAM',
  positionCode: 'COR',
} as const;

/** Open the Manual Entry tab on the CrewRez dashboard. */
export async function openManualEntry(page: Page): Promise<void> {
  await page.goto('/CrewRez/Dashboard', { waitUntil: 'domcontentloaded' });
  await dismissCookieNotice(page);
  await openAccountTab(page, 'Manual Entry', page.locator(MANUAL_ENTRY.crewId));
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Reach Manual Entry with a known global airline actually in effect.
 *
 * Added by bolt US-CH-MENT-001 (2026-09-24) after the airline-propagation race
 * reproduced here too: a spec that called `selectGlobalAirline` and then
 * `openManualEntry` directly landed on a Manual Entry tab still rendering under
 * `2D - Eastern Airlines`. That is the third screen this race has been seen on,
 * after Hotel Admin and Transportation Manual Entry — further confirmation it
 * belongs to the session switch, not to any one screen. Manual Entry confirms
 * on its own destination, like Transportation and unlike Hotel Admin.
 */
export async function openManualEntryUnderAirline(page: Page, airlineLabel: string): Promise<void> {
  await openUnderAirline(page, airlineLabel, () => openManualEntry(page));
}

/**
 * Submit the Manual Entry form and resolve with the create response.
 *
 * Submit fires two calls: `ManualEntry/ValidateOverlap` immediately, then
 * `ManualEntry_API/ManualEntry/Create` — and the success alert is raised only
 * once that second one returns, measured 31-33s after the click across three
 * separate observations. Waiting for the response rather than only polling the
 * dialog buffer matters for diagnosis, not just for timing: a run that produced
 * no dialog at all in 120s (bolt US-CH-MENT-001, 2026-09-24) left no way to
 * tell whether the request had failed, never fired, or simply been slow. With
 * this, that question answers itself in the failure message.
 *
 * Pair with `captureDialogs` — register the handler BEFORE calling this, or
 * Playwright auto-dismisses the alert and the assertion is lost silently.
 */
export async function submitManualEntry(page: Page) {
  const created = page.waitForResponse(
    (r) => /ManualEntry\/Create/i.test(r.url()) && r.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  return created;
}

/**
 * Pick a crew member through the Add Personnel name-help.
 *
 * Fiddlier than it looks, and every part of this is load-bearing (US-CLC-002
 * discrepancy D-8, confirmed across four exploration passes):
 *
 *  - **The first lookup after the tab loads never renders.** The page is still
 *    issuing its own load-time requests and the autocomplete's
 *    `GetAirlinesWorkers` call is simply never made. A real user meets this as
 *    "I typed a name and nothing happened."
 *  - **Each keystroke burst fires two lookups, and `search=` runs one query
 *    AHEAD of `filter[filters][0][value]`** — the parameter the server actually
 *    matches on. Waiting on `search=` resolves against the previous query's
 *    results, which look like an empty list for the current one.
 *  - **Between attempts the field must be cleared with real keystrokes.**
 *    Re-typing the same text after `fill('')` alone is treated as "no change"
 *    and issues no lookup at all.
 *  - A query shorter than ~3 characters returns nothing.
 *
 * Returns the option text actually chosen.
 */
export async function pickManualEntryCrew(page: Page, query: string, prefer: string): Promise<string> {
  const field = page.locator(MANUAL_ENTRY.crewId);
  const options = page.locator('#ManualEntryCrewId_listbox li');

  const lookupFor = (term: string) =>
    page
      .waitForResponse(
        (r) =>
          r.url().includes('/CrewRez/ManualEntry/GetAirlinesWorkers') &&
          decodeURIComponent(r.url()).includes(`[value]=${term}`) &&
          r.ok(),
        { timeout: 20_000 },
      )
      .catch(() => null);

  const type = async (term: string) => {
    await field.fill('');
    await field.click();
    await page.keyboard.type(term, { delay: 150 });
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Warm-up with a DIFFERENT term first. Two separate findings make this
    // necessary, and neither is negotiable: the first lookup after the tab
    // loads never fires at all, and re-typing a term the widget has already
    // seen is treated as "no change" and issues no request either. A throwaway
    // distinct term satisfies both — consecutive *distinct* queries were
    // confirmed to work back-to-back during exploration.
    const warmUp = `zz${attempt}`;
    const warmUpDone = lookupFor(warmUp);
    await type(warmUp);
    await warmUpDone;

    const lookup = lookupFor(query);
    await type(query);
    await lookup;

    const rendered = await options
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (rendered) {
      const preferred = options.filter({ hasText: prefer }).first();
      const choice = (await preferred.count()) ? preferred : options.first();
      const text = (await choice.innerText()).trim();
      await choice.click();
      await expect(field).not.toHaveValue('');
      return text;
    }
  }

  throw new Error(
    `Manual Entry name-help returned no suggestions for "${query}" after 3 attempts — see this file's note on D-8`,
  );
}

/**
 * Choose an option in one of Manual Entry's Kendo dropdowns by its exact text.
 *
 * Position and Cost Center are both disabled until a crew member is chosen, so
 * this must run after `pickManualEntryCrew`. The option text is always given
 * explicitly and never defaulted to the first entry — Cost Center's first entry
 * is the non-value "Not Used" (D-4).
 */
export async function chooseManualEntryOption(page: Page, fieldId: string, optionText: string): Promise<void> {
  const id = fieldId.replace('#', '');
  const widget = page.locator('span.k-widget').filter({ has: page.locator(fieldId) }).first();
  await widget.scrollIntoViewIfNeeded();
  await widget.click();
  const option = page.locator(`#${id}_listbox li`).filter({ hasText: optionText }).first();
  await option.waitFor({ state: 'visible', timeout: 20_000 });
  await option.click();
  await expect(widget).toContainText(optionText);
}

/**
 * Collect the native browser dialogs a block of work produces, accepting each.
 *
 * Manual Entry reports EVERYTHING through `window.alert` — validation failures
 * and the success confirmation alike (US-CLC-002 discrepancies D-2 and D-3).
 * Playwright auto-dismisses native dialogs when no handler is registered, so a
 * test that does not do this loses the assertion entirely **and still passes**.
 * That is the trap this helper exists to remove.
 */
export function captureDialogs(page: Page): string[] {
  const messages: string[] = [];
  page.on('dialog', async (dialog) => {
    messages.push(dialog.message());
    await dialog.accept();
  });
  return messages;
}

/** Manual Entry's date/time format, e.g. "9/21/2026 15:00" — no leading zeros. */
export function manualEntryDateTime(date: Date, time: string): string {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${time}`;
}

/**
 * Wait for a captured native dialog whose message matches, and return it.
 *
 * Pair with `captureDialogs`. The default timeout is deliberately large:
 * Manual Entry's success confirmation was measured arriving **~32 seconds**
 * after Submit (bolt US-CH-MENT-001, "CLC_22_09_1_1" workspace, 2026-09-22 —
 * the alert landed at 76.0s for a click at 43.7s). An exploration pass that
 * read the buffer 4s after Submit saw nothing at all and nearly recorded "no
 * confirmation appears" as a finding. Anything shorter than this concludes
 * the submit did nothing.
 */
export async function waitForDialog(
  dialogs: string[],
  matcher: RegExp,
  timeoutMs = 90_000,
): Promise<string> {
  let found: string | undefined;
  await expect(() => {
    found = dialogs.find((m) => matcher.test(m));
    expect(found, `no dialog matching ${matcher} — captured so far: ${JSON.stringify(dialogs)}`).toBeDefined();
  }).toPass({ timeout: timeoutMs, intervals: [500] });
  return found!;
}

/**
 * The personnel row produced by Add, e.g. "SMITH,  JEFFREY ~ 1322 | COR | NA".
 *
 * The pipe-separated position is what makes this unambiguous: the crew
 * autocomplete's own option for the same person ("SMITH,  JEFFREY ~ 1322 ,
 * Pos:CA") stays in the DOM, hidden, and a locator matching on name and
 * employee id alone resolves to that instead — it reads as "the row is hidden"
 * rather than as the wrong element.
 */
export function manualEntryPersonnelRow(page: Page, employeeId: string, positionCode: string): Locator {
  return page.getByText(new RegExp(`${employeeId}\\s*\\|\\s*${positionCode}`, 'i')).last();
}

// ---------------------------------------------------------------------------
// Transportation Manual Entry
//
// A DIFFERENT screen from the Manual Entry section above, despite sitting on
// the same CrewRez dashboard and sharing the same shape of crew lookup. Every
// locator below was observed live during bolt US-CLC-002, "CLC_22_09"
// workspace (2026-09-22, 7 exploration passes against a screen no earlier CLC
// bolt had touched — this is the third distinct screen this bolt id has been
// assigned to; see clc-known-flaky-areas.md's Sources table).
//
// Two spellings of the same prefix are the app's own, not typos here:
// `Trnprt*` on almost everything, `Trnsprt*` on the notes textarea. And
// `Postition` is misspelled exactly as it is on the sibling screen.
// ---------------------------------------------------------------------------

export const TRANSPORT_ENTRY = {
  crewId: '#TrnprtManualEntryCrewId',
  position: '#TrnprtManualEntryPostition',
  costCenter: '#TrnprtManualEntryCostCenter',
  pickupLocation: '#TransportationPickupLocation',
  dropoffLocation: '#TransportationDropoffLocation',
  isRoundTrip: '#TransportationIsRoundTrip',
  /** Revealed only by Pick Up Location = "Hotel". */
  pickupHotelStation: '#TrnprtPickupHotelStation',
  pickupHotelDistance: '#TrnprtPickupHotelStationDistance',
  pickupHotel: '#TrnprtPickupHotel',
  pickupDateTime: '#TrnprtHotelPickupDate',
  /** Revealed only by Drop Off Location = "Station". */
  dropoffStation: '#TrnprtDropoffStation',
  dropoffOperatingAirline: '#TrnprtDropoffOperatingAirline',
  dropoffFlight: '#TrnprtDropoffStationFlight',
  notes: '#TrnsprtManualEntryReason',
} as const;

/** Known-good Transportation Manual Entry data, confirmed live 2026-09-22. */
export const TRANSPORT_ENTRY_DATA = {
  crewSearch: 'smith',
  position: 'CAP - Captain',
  /** Deliberately NOT the first option — that is the literal string "Not Used".
   * The list is also re-populated once a crew member is chosen (5 generic
   * entries before, 43 airline-specific ones after), so this value only exists
   * post-selection. */
  costCenter: 'CAM DELIVERY PILOTS (FOR ALL TRIPS AND TRAINING)',
  station: 'DFW',
  operatingAirline: '8C',
  flight: '1234',
  /** 24-hour. The picker silently drops AM/PM — "10:00 AM" is kept as "10:00"
   * (US-CLC-002 discrepancy D-8, "CLC_22_09" workspace), the same defect
   * family as Hotel Admin's own time fields (see `newHotelFixture`). Never
   * pass a 12-hour value. */
  pickupDateTime: '9/25/2026 10:00',
  notes: 'AIDLC automated check - pickup at hotel lobby',
} as const;

/** Open the Transportation Manual Entry tab. The left rail's "Operations
 * Management" resolves here, NOT to /TransportationManagement/Dashboard, which
 * is a different screen entirely (US-CLC-002 discrepancy D-1, "CLC_22_09"
 * workspace). */
export async function openTransportationManualEntry(page: Page): Promise<void> {
  await page.goto('/CrewRez/Dashboard', { waitUntil: 'domcontentloaded' });
  await dismissCookieNotice(page);
  const tab = page.getByRole('tab', { name: 'Transportation Manual Entry', exact: true });
  // Same click-before-handler-bound race as every other tab strip in this app.
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.locator(TRANSPORT_ENTRY.crewId)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
}

/** Reach Transportation Manual Entry with a known global airline in effect.
 *  See `openUnderAirline` (Hotel Admin section, above) for why this is a thin
 *  wrapper rather than its own copy of the retry logic. */
export async function openTransportationManualEntryUnderAirline(
  page: Page,
  airlineLabel: string,
): Promise<void> {
  await openUnderAirline(page, airlineLabel, () => openTransportationManualEntry(page));
}

/** The text a Transportation Manual Entry dropdown currently displays.
 *  Its underlying input holds the CODE (`DFW`), not the label the user sees
 *  (`DFW | Dallas/ Ft. Worth`) — assert against this, not `toHaveValue`. */
export function transportValue(page: Page, fieldId: string): Locator {
  return page.locator('span.k-widget').filter({ has: page.locator(fieldId) }).first().locator('.k-input').first();
}

/**
 * The active tab panel holding this screen's controls.
 *
 * Scope every by-text lookup through this. The CrewRez dashboard keeps other
 * tabs' grids in the DOM while hidden, and several of them have a "Hotel Name"
 * column header — an unscoped `getByText('Hotel Name', { exact: true })`
 * resolves to a hidden `<th>` that appears earlier in the document than the
 * real label (observed live, US-CLC-002 first run, "CLC_22_09" workspace).
 */
export function transportPanel(page: Page): Locator {
  return page.locator('div.k-content.k-state-active').filter({ has: page.locator(TRANSPORT_ENTRY.crewId) }).first();
}

/**
 * The app's own validation box — a Kendo modal titled "TA Connections Alert",
 * NOT a native dialog and not a toast.
 *
 * It stays on screen and intercepts pointer events on everything beneath it
 * until its "Ok" button is pressed. Observed live: a later dropdown click
 * failed with "...intercepts pointer events" long after the alert was raised.
 */
export function taAlert(page: Page): Locator {
  return page.locator('div[role="dialog"].k-dialog').filter({ hasText: 'TA Connections Alert' }).first();
}

export async function dismissTaAlert(page: Page): Promise<void> {
  const alert = taAlert(page);
  await alert.getByRole('button', { name: 'Ok', exact: true }).click();
  await expect(alert).toBeHidden({ timeout: 15_000 });
}

/**
 * Choose an option from one of this screen's Kendo dropdowns by exact text.
 *
 * Read and click within a SINGLE popup opening. Closing the popup with Escape
 * and reopening it leaves the items in the DOM but not visible, which reads as
 * a missing element rather than a closed menu (observed live, 2026-09-22 —
 * the same class of trap `kendoSelect` documents for the filtered lists).
 */
export async function chooseTransportOption(page: Page, fieldId: string, optionText: string): Promise<void> {
  const id = fieldId.replace('#', '');
  const widget = page.locator('span.k-widget').filter({ has: page.locator(fieldId) }).first();
  await widget.scrollIntoViewIfNeeded();
  await widget.click();
  const option = page.locator(`#${id}_listbox li`).filter({ hasText: optionText }).first();
  await option.waitFor({ state: 'visible', timeout: 20_000 });
  await option.click();
  await expect(widget).toContainText(optionText);
}

/** Pick the first option starting with `prefix` (station codes render as
 *  "DFW | Dallas/ Ft. Worth"). Returns the text actually chosen. */
export async function chooseTransportOptionByPrefix(page: Page, fieldId: string, prefix: string): Promise<string> {
  const id = fieldId.replace('#', '');
  const widget = page.locator('span.k-widget').filter({ has: page.locator(fieldId) }).first();
  await widget.scrollIntoViewIfNeeded();
  await widget.click();
  if (prefix) await page.keyboard.type(prefix, { delay: 60 });
  const option = page
    .locator(`#${id}_listbox li`)
    .filter({ hasText: prefix ? new RegExp(`^${prefix}`) : /./ })
    .first();
  await option.waitFor({ state: 'visible', timeout: 20_000 });
  const text = (await option.innerText()).trim();
  await option.click();
  return text;
}

/**
 * Pick a crew member through this screen's name-help, and return the employee
 * id embedded in the chosen option ("SMITH,  JEFFREY ~ 1322 , Pos:CA" → 1322).
 *
 * The warm-up query is mandatory: the first lookup after the tab loads returns
 * nothing at all (US-CLC-002 discrepancy D-9, "CLC_22_09" workspace —
 * confirmed live here, and the same behaviour already recorded for the
 * sibling Manual Entry screen). The id is returned rather than hard-coded
 * because the save confirmation names it, and QA data changes.
 */
export async function pickTransportCrew(page: Page, query: string): Promise<string> {
  const field = page.locator(TRANSPORT_ENTRY.crewId);
  const options = page.locator(`${TRANSPORT_ENTRY.crewId}_listbox li`);

  // `focus()` rather than `click()`, and that is load-bearing. The warm-up
  // query below deliberately matches nothing, so Kendo opens its own
  // `div.k-nodata` popup over the field — and a click is hit-tested, so the
  // NEXT click on the input underneath it can never land. Observed live as a
  // 120s timeout with "k-nodata ... intercepts pointer events" repeating
  // (US-CLC-002, first run, "CLC_22_09" workspace). Escape closes the popup;
  // focus is not hit-tested, so it cannot be blocked by one either way.
  const type = async (term: string) => {
    await field.press('Escape').catch(() => undefined);
    await field.fill('');
    await field.focus();
    await page.keyboard.type(term, { delay: 150 });
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    await type(`zz${attempt}`);
    await options
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => undefined); // the warm-up is expected to return nothing

    await type(query);
    const rendered = await options
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (rendered) {
      const text = (await options.first().innerText()).trim();
      await options.first().click();
      await expect(field).not.toHaveValue('');
      // The suggestion popup overlaps the Position widget directly beneath it,
      // so the next control's click is intercepted unless this has closed.
      await expect(options.first()).toBeHidden({ timeout: 15_000 });
      const employeeId = text.match(/~\s*(\d+)/)?.[1];
      if (!employeeId) throw new Error(`no employee id in crew option "${text}"`);
      return employeeId;
    }
  }

  throw new Error(
    `Transportation crew name-help returned no suggestions for "${query}" after 3 attempts — see D-9`,
  );
}

/** The personnel row Add produces, e.g. "JEFFREY SMITH (1322)|CAP|145CAM". */
export function transportPersonnelRow(page: Page, employeeId: string): Locator {
  return page.getByText(new RegExp(`\\(${employeeId}\\)\\s*\\|`)).last();
}

// ---------------------------------------------------------------------------
// Reporting  (/Reports/Report)
//
// Added by bolt US-CLC-MISSINGCREWNAME-001 (LOD-76916, 2026-09-24) — the first
// bolt to touch this module, so everything here was derived live from zero.
// Four behaviours cost that bolt most of its exploration budget and are each
// encoded below rather than left as prose:
//
//  1. The filter panel (`#ReportFilterRow`) starts COLLAPSED on UAT and
//     expanded on QA — same account, same app version. Collapsed, the page
//     looks completely empty: no headings, no categories, nothing.
//  2. The category buttons are written by JavaScript after load, so a DOM read
//     taken too early sees an empty list. Worse, reading them through
//     `page.evaluate` proves they EXIST without proving they are VISIBLE —
//     that distinction produced two wrong conclusions in a row.
//  3. The date inputs APPEND on `fill()`. An end date became
//     "11/1/202611/30/2026", which silently runs the wrong query instead of
//     failing, and made three reports look like they simply returned nothing.
//  4. "Export to Excel" is an <a>, not a button, so a role=button scan finds
//     "Export PDF" and "Send By Email" and misses it.
//
// Two more, from the account team's own exports (2026-09-25):
//
//  5. Every report has its own Airline / Station / Hotel filters. They start
//     EMPTY (meaning "all") and the header airline does not set them. Run
//     with dates only, three reports error and one returns rows for other
//     airlines; set all three and every report loads (run-8 fix run,
//     2026-09-25). Use selectReportFilter, with values from the bolt's test
//     data. Room Cancelation has no Hotel filter.
//  6. The five crew reports lay out crew columns five different ways. See
//     REPORT_CREW_COLUMNS below; never reuse one report's columns for another.
// ---------------------------------------------------------------------------

/** Report categories, as the chooser labels them. */
export type ReportCategory = 'Informational' | 'Financial' | 'Operational';

/**
 * Reach `/Reports/Report` with a known global airline actually in effect.
 * The fourth screen to need this wrapper — see `openUnderAirline`.
 */
export async function openReportsUnderAirline(page: Page, airlineLabel: string): Promise<void> {
  await openUnderAirline(page, airlineLabel, async () => {
    await page.goto('/Reports/Report', { waitUntil: 'domcontentloaded' });
    await dismissCookieNotice(page);
  });
}

/** The three category buttons. Populated by JS after load. */
export const reportCategories = (page: Page): Locator => page.locator('#ReportFilters li button');

/**
 * Make the report chooser usable, whatever state the page loaded in.
 *
 * Waits for a category button to be *visible*, not merely present — the
 * difference is the whole point. The header control's accessible name carries
 * a leading icon glyph, so it is matched by regex rather than exact text.
 */
export async function expandReportFilters(page: Page): Promise<void> {
  const cats = reportCategories(page);
  if (await cats.first().isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Reports/ }).first().click();
  await cats.first().waitFor({ state: 'visible', timeout: 30_000 });
}

/** Open a report by category and exact name, and return its filter panel id. */
export async function openReport(
  page: Page,
  category: ReportCategory,
  reportName: string,
): Promise<string> {
  await expandReportFilters(page);
  await reportCategories(page).filter({ hasText: category }).first().click();
  const button = page.getByRole('button', { name: reportName, exact: true }).first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();

  const panel = page.locator('div.filterDivs:visible').first();
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const id = await panel.getAttribute('id');
  if (!id) throw new Error(`report "${reportName}" opened no identifiable filter panel`);
  return id;
}

/**
 * Set one of the report date inputs.
 *
 * Select-all-then-type, never `fill()`: these inputs append, so `fill()` turns
 * an end date into "11/1/202611/30/2026" and the report then runs against a
 * range nobody asked for — without any error to notice.
 */
export async function setReportDate(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.press('ControlOrMeta+A');
  await input.press('Delete');
  await input.pressSequentially(value, { delay: 25 });
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

/** Set a report's start/end range. `panelId` comes from `openReport`. */
export async function setReportDateRange(
  page: Page,
  panelId: string,
  from: string,
  to: string,
): Promise<void> {
  const key = panelId.replace(/Div$/, '');
  await setReportDate(page.locator(`#${key}StartDate`), from);
  await setReportDate(page.locator(`#${key}EndDate`), to);
}

/**
 * Set one of a report's Airline / Station / Hotel dropdowns by exact option text.
 *
 * These are plain Kendo dropdownlists, NOT the filterable kind `kendoSelect`
 * handles: typing into them does not narrow the list (typing "CRK" left `2I4`,
 * `ATL`, `BKK` at the top), so the option is clicked by its own text instead.
 * All three start EMPTY, which means "all" (see note 5 above).
 *
 * Option text is the raw code for Airline and Station (`5J`, `CRK`) and
 * `<key> - <name>` for Hotel (`4595 - Quest Plus Conference Center Clark`).
 * Room Cancelation has no Hotel filter.
 *
 * Verified live on UAT by the run-8 fix run (2026-09-25), all four reports
 * that have the three filters.
 */
export async function selectReportFilter(
  page: Page,
  panelId: string,
  filter: 'Airline' | 'Station' | 'Hotel',
  optionText: string,
): Promise<void> {
  const id = `${panelId.replace(/Div$/, '')}${filter}`;
  const current = kendoValue(page, id);

  // The whole open-and-pick is re-issued rather than scrolled into place.
  // Kendo rebuilds this listbox as it opens, so an option resolved a moment
  // earlier detaches — `scrollIntoViewIfNeeded` on it failed with "Element is
  // not attached to the DOM" on a second run. Scrolling was also the wrong
  // instinct: scrolling a Kendo popup's target is what closes it, as
  // `kendoSelect` above already records. Re-querying inside `toPass` handles
  // both, and the value check makes it idempotent.
  await expect(async () => {
    if ((await current.textContent())?.trim() === optionText) return;
    await kendoDropdown(page, id).click();
    await page
      .locator(`#${id}_listbox li`)
      .filter({ hasText: optionText })
      .first()
      .click({ timeout: 10_000 });
    await expect(current).toHaveText(optionText, { timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

/** The modal this module raises for both failures and empty results. */
export const reportAlert = (page: Page): Locator =>
  page.locator('div').filter({ hasText: /TA Connections Alert/ }).last();

/** Exact text of the two outcomes confirmed live, 2026-09-24. */
export const REPORT_LOAD_ERROR = 'An error occured while loading the report.'; // sic — the product's own typo
export const REPORT_NO_DATA = 'No data was returned for your query.';

/** The results grid. Kendo splits header and body into separate tables. */
export const reportGrid = (page: Page): Locator => page.locator('.k-grid').filter({ visible: true }).first();

/** Run the report whose filters are on screen. */
export async function runReport(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Search$/i }).first().click();
}

export interface ReportOutcome {
  grid: boolean;
  /** The alert's message when one was raised, else null. */
  alert: string | null;
}

/**
 * Wait for a report to resolve, either way, and say which happened.
 *
 * Both outcomes are legitimate results to assert on, so this deliberately does
 * not throw on the alert — a caller asserting "the report loads" wants the
 * alert's text in its failure message, not a generic timeout.
 */
export async function waitForReportOutcome(page: Page, timeoutMs = 60_000): Promise<ReportOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText();
    if (body.includes(REPORT_LOAD_ERROR)) return { grid: false, alert: REPORT_LOAD_ERROR };
    if (body.includes(REPORT_NO_DATA)) return { grid: false, alert: REPORT_NO_DATA };
    if (await reportGrid(page).isVisible().catch(() => false)) return { grid: true, alert: null };
    await page.waitForTimeout(500);
  }
  return { grid: false, alert: null };
}

export interface ReportTable {
  headers: string[];
  rows: string[][];
}

/** Read the rendered page of the results grid. */
export async function readReportGrid(page: Page): Promise<ReportTable> {
  return page.evaluate(() => {
    const grid = [...document.querySelectorAll('.k-grid')].find((g) => !!(g.offsetWidth || g.offsetHeight));
    if (!grid) return { headers: [], rows: [] };
    const headers = [...grid.querySelectorAll('.k-grid-header th')].map((th) => (th as HTMLElement).innerText.trim());
    const body = grid.querySelector('.k-grid-content') ?? grid;
    const rows = [...body.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim()),
    );
    return { headers, rows };
  });
}

/** Index of the first header matching `pattern`, or -1. */
export const reportColumn = (headers: string[], pattern: RegExp): number =>
  headers.findIndex((h) => pattern.test(h));

/**
 * True when a crew-name cell holds no real name: every part (split on "/" and
 * ", ") is a placeholder LOD-76916 has shown: `0`, `NA`, `NoFName`, or only
 * dots and spaces (blank included). A `-` is NOT a placeholder: single crew
 * with no surname show last name `-` and a real first name (CRK, 2026-09-25).
 *
 * `NA` because Global Billing's symptom is "NA, NA". Dots because Crew Sign In
 * and Daily Crew Report show a shared room's missing second crew as `..`
 * (DXB 9/1-9/2, 2026-09-27): an earlier version accepted `.` but not `..` and
 * passed those rows. crewNameProblem applies this to each "/" part, which is
 * what catches "NAME/.." (one crew named, one missing).
 */
export const isMissingCrewName = (value: string | undefined): boolean =>
  (value ?? '')
    .split(/\/|,\s*/)
    .every((part) => /^(0|NA|NoFName|[.\s]*)$/i.test(part.trim()));

/**
 * "Export to Excel" — an `<a>`, not a button.
 *
 * Matched by text within `a`, not by `getByRole('link')`: the anchor carries
 * no `href`, so it is not exposed as a link and the role lookup finds nothing.
 * The role-based version was written into a spec and cost a run before this
 * was checked (bolt US-CLC-MISSINGCREWNAME-001, 2026-09-24).
 */
export const exportToExcelLink = (page: Page): Locator =>
  page.locator('a').filter({ hasText: /Export to Excel/i }).first();

/**
 * Where each LOD-76916 report keeps its crew, and how a shared room shows.
 *
 * Headers are exactly as the Excel export writes them, double spaces included,
 * verified against real 5J exports of all five (account team, 2026-09-25).
 * The grid may label them differently; confirm against the grid before using
 * these on it.
 *
 * A shared room is two crew in one row, recorded as two IDs joined with "/" in
 * the ID column (`123456/12345`). Match it on the ID column only: "/" also turns
 * up in crew-type values (`F/O`, `CA N/A`), so "any cell has a slash" finds
 * rows that are not shared at all. The Reservation Detail Report additionally
 * marks it with Occupancy = D; no other report has that column.
 */
export interface ReportCrewColumns {
  /** The reservation, the same booking across every report. */
  rez: RegExp;
  id: RegExp;
  /** One entry when the report holds the full name in a single column. */
  names: RegExp[];
  occupancy?: RegExp;
  /**
   * Whether a real shared-room row has been SEEN in this report. When false,
   * the "/" rule is a guess: the report may list shared crew as two separate
   * rows instead, and then no row is ever `shared` and the non-empty guard
   * fails forever. A spec on such a report stops with test.fixme until a
   * shared row has been observed (e2e-generate, "Never assert on output
   * nobody has seen").
   */
  sharedSeen: boolean;
}

export const REPORT_CREW_COLUMNS: Record<string, ReportCrewColumns> = {
  'Reservation Detail Report': {
    rez: /^Rez Id$/i,
    id: /^Employee Id$/i,
    names: [/^Crew Last Name$/i, /^Crew First Name$/i],
    occupancy: /^Occupancy$/i,
    sharedSeen: true, // LOD-76916's own RDR export screenshot, and the run-8 grid
  },
  'Master Reservation Detail': { rez: /^Reservation ID$/i, id: /^Crew ID$/i, names: [/^Crew L Name$/i, /^Crew F Name$/i], sharedSeen: true }, // CRK 9/1-9/4 export, 2026-09-25
  'Total Spend By RezID': { rez: /^I\s+U ID$/i, id: /^L\s+Emp Id$/i, names: [/^CP\s+Name Last$/i, /^CP\s+Name First$/i], sharedSeen: true },
  'Room Cancelation Report': { rez: /^I\s+U ID$/i, id: /^CR\s+Crew Member ID$/i, names: [/^CR\s+Crew Member Name$/i], sharedSeen: true },
  'Crew Sign In Report': { rez: /^I\s+U ID$/i, id: /^L\s+Emp Id$/i, names: [/^CP\s+Name Last$/i, /^CP\s+Name First$/i], sharedSeen: true }, // one row per room, a/b; CRK 9/1-9/4, 2026-09-27
  // One date only (the end date), and no shared room seen in it yet.
  'Daily Crew Report': { rez: /^UID$/i, id: /^Employee_ID$/i, names: [/^CP_Last_Name$/i, /^CP_First_Name$/i], sharedSeen: false },
  'Global Billing Report': { rez: /^Rez Id$/i, id: /^Employee Number$/i, names: [/^Employee Name$/i], sharedSeen: true }, // "LAST1/LAST2, FIRST1/FIRST2", CRK 9/1-9/4 export, 2026-09-25
};

export interface CrewRow {
  rez: string;
  id: string;
  names: string[];
  shared: boolean;
  /** Occupancy says shared (RDR only), independent of the crew columns. */
  occupancyShared: boolean;
}

/**
 * Read a report's crew out of a header row plus data rows (grid or export).
 *
 * Throws, naming what it did find, when a column is missing, so a wrong layout
 * fails as "column missing" and never passes quietly on nothing.
 */
export function readCrewRows(report: string, headers: string[], rows: string[][]): CrewRow[] {
  const cols = REPORT_CREW_COLUMNS[report];
  if (!cols) throw new Error(`no crew-column layout recorded for "${report}"`);
  const find = (re: RegExp) => {
    const i = headers.findIndex((h) => re.test(h.trim()));
    if (i < 0) throw new Error(`${report}: no column matching ${re} in ${JSON.stringify(headers)}`);
    return i;
  };
  const iRez = find(cols.rez);
  const iId = find(cols.id);
  const iNames = cols.names.map(find);
  const iOcc = cols.occupancy ? find(cols.occupancy) : -1;
  return rows
    .filter((r) => r.some((c) => (c ?? '').trim()))
    .map((r) => {
      const id = (r[iId] ?? '').trim();
      const occupancyShared = iOcc >= 0 && /^D/i.test((r[iOcc] ?? '').trim());
      return {
        rez: (r[iRez] ?? '').trim(),
        id,
        names: iNames.map((i) => (r[i] ?? '').trim()),
        shared: /^\d+\s*\/\s*\d+$/.test(id) || occupancyShared,
        occupancyShared,
      };
    });
}

/**
 * A shared-room row whose names do not cover both crew members.
 *
 * Either a placeholder where a name belongs (see isMissingCrewName), or, in a
 * report with split name columns, fewer "/"-separated names than IDs.
 *
 * UNVERIFIED edge: the RDR export truncates these combined cells (the ticket's
 * own screenshot shows IDs cut to `264180/26417` and names cut mid-word), so a long first
 * name could push the second one off the end entirely and be flagged here as
 * a missing name. Read a flagged row in full before calling it LOD-76916. For the
 * single "FIRST1/FIRST2 LAST1/LAST2" cell of the Room Cancelation Report, a
 * shared row must contain a "/" (seen in the DXB 9/3/2026 export,
 * 2026-09-25); one without it names only one of the two crew and is flagged.
 */
export function crewNameProblem(row: CrewRow): string | null {
  // Occupancy says two crew but the ID column holds one: the partner is gone.
  if (row.occupancyShared && !row.id.includes('/')) return `${row.id}: Occupancy D but only one crew id`;
  if (row.names.some(isMissingCrewName)) return `${row.id}: placeholder name ${JSON.stringify(row.names)}`;
  // Global Billing holds both halves in one "LAST1/LAST2, FIRST1/FIRST2" cell;
  // split it so it gets the same per-part check as the split-column reports.
  const names =
    row.names.length === 1 && /,\s/.test(row.names[0]) ? row.names[0].split(/,\s*/) : row.names;
  if (names.some(isMissingCrewName)) return `${row.id}: placeholder name ${JSON.stringify(row.names)}`;
  // Room Cancelation keeps both crew in one "FIRST1/FIRST2 LAST1/LAST2" cell;
  // a shared row whose single name has no "/" names only one of them.
  if (row.shared && names.length === 1 && !names[0].includes('/')) {
    return `${row.id}: ${row.id.split('/').length} crew but one name "${names[0]}"`;
  }
  if (row.shared && names.length > 1) {
    const ids = row.id.split('/').length;
    const short = names.find((n) => n.split('/').filter((p) => !isMissingCrewName(p)).length < ids);
    if (short !== undefined) return `${row.id}: ${ids} crew but name "${short}"`;
  }
  return null;
}

/**
 * Cross-check another report's shared rooms against the Reservation Detail
 * Report, for the same filters and window.
 *
 * RDR is the only report that records occupancy separately from the crew
 * columns. A reservation it marks D must show as a shared row (two IDs joined
 * with "/") in the other report too. A shared room that lost its partner's ID
 * would otherwise look like an ordinary single row there and slip past
 * crewNameProblem entirely. Returns one line per mismatch; [] means they agree.
 *
 * Assumes Occupancy D means two crew sharing (every D row seen so far has two
 * IDs); unconfirmed with the account team.
 *
 * Only reservations present in BOTH reports are compared. The reports do not
 * cover exactly the same bookings: Global Billing also bills transport lines
 * (Rez `-1`) that RDR never lists, and a report whose date field differs from
 * RDR's can differ at the window's edges. Comparing everything would turn
 * those into false reds.
 *
 * Verified against the CRK / 4595 / 9/1-9/4/2026 exports (2026-09-25): RDR's
 * two D reservations show as shared in Master Reservation Detail, Total Spend
 * and Global Billing, and nothing else does. Also verified for Crew Sign In
 * (CRK) and Room Cancelation (DXB / Marriott Al Jaddaf, 9/1-9/4, 2026-09-27).
 */
export function sharedRoomMismatches(rdr: CrewRow[], other: CrewRow[], otherName: string): string[] {
  const inRdr = new Set(rdr.map((r) => r.rez));
  const inOther = new Set(other.map((r) => r.rez));
  const both = (rez: string) => inRdr.has(rez) && inOther.has(rez);
  const expected = new Set(rdr.filter((r) => r.occupancyShared && both(r.rez)).map((r) => r.rez));
  const shownShared = new Set(other.filter((r) => /\//.test(r.id) && both(r.rez)).map((r) => r.rez));
  const out: string[] = [];
  for (const rez of expected) {
    if (!shownShared.has(rez)) out.push(`Rez ${rez}: shared in RDR, shown as one crew in ${otherName}`);
  }
  for (const rez of shownShared) {
    if (!expected.has(rez)) out.push(`Rez ${rez}: shared in ${otherName}, not marked D in RDR`);
  }
  return out;
}
