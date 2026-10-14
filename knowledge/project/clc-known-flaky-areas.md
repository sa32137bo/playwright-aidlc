# Known issues — CLC

Application behavior that recurs across screens: real bugs, data quirks and
environment noise. Not something specific to one story. See
`environment-notes.md` for auth/TLS plumbing and `clc-locator-overrides.md` for
DOM/locator conventions.

Sources, all against https://crewhub-qa.taconnections.com/:

| Bolt | Screen | Run(s) |
|---|---|---|
| `US-CLC-001` | Hotel Admin | "CLC_Automation" 2026-09-17 (4/4); "CLC_18_09" 2026-09-18 (exploration only, paused after Gate 1); "CLC" 2026-09-20 (5/5); "CLC_21_09" 2026-09-21 (5/5); "CLC_21_09_1" 2026-09-21, later the same day (6/6, 0 heals) |
| `US-CLC-003` | Alternative Hotel List | "CLC" workspace, 2026-09-20, later the same day as that run's `US-CLC-001` (3/3, full workspace 8/8) |
| `US-CLC-002` | Operations Management's Manual Entry | "CLC_21_09" workspace, 2026-09-21, same day as that run's `US-CLC-001` (7/7) |
| `US-CLC-002` | Alternative Hotel List | "CLC_21_09_1" workspace, 2026-09-21, same day as that run's `US-CLC-001` (5/5, 2 heals) — a genuine repeat bolt ID reused for a different screen than its first run |
| `US-CLC-001` | Hotel Admin | "CLC_22_09" workspace, 2026-09-22 (6/6, 2 heals) |
| `US-CLC-002` | Transportation Manual Entry | "CLC_22_09" workspace, 2026-09-22 (5/6, 4 heals applied — 1 fail is a product defect, not resolved) — a THIRD screen reusing this bolt ID |
| `US-CLC-001` | Hotel Admin | "CLC_22_09_1_1" workspace, 2026-09-22 (6/6, 1 heal) |
| `US-CH-MENT-001` | Operations Management's Manual Entry | "CLC_22_09_1_1" workspace, 2026-09-22 (6/6 + 1 `fixme`, 1 heal) — first bolt on this story to get its own distinct id, not a reuse of `US-CLC-002` |

- **The Account Management tab strip accepts a click before its tab handler is
  bound.** Confirmed live (bolt `US-CLC-001`, 2026-09-20): a successful click on
  the `Hotel Admin` tab, immediately after `/AccountManagement/Dashboard`
  finished loading, switched nothing — `Allocations` was still the selected tab
  60s later, with no error of any kind. Intermittent: the same call succeeded
  first time in three other tests of the same run. `openHotelAdmin()` in `clc.ts`
  now re-issues the click inside `expect(...).toPass()` until the Hotel Admin
  heading appears; see `knowledge/org/locator-policy.md` for the general form of
  this, which is not CrewHub-specific.

- **A duplicate Hotel Name AND a duplicate Hotel Phone are both silently
  rejected with the same generic toast.** `POST /AccountManagement/HotelAdmin/
  SaveHotel` returns `400`, and the toast reads header `Invalid`, body
  `Error: Bad request` — it never names which field caused the rejection, or
  that it was a duplicate at all. The two failure modes are indistinguishable
  at the UI. A test (or a person) must vary BOTH name and phone per hotel, not
  just the name. Confirmed live, independently reproduced across separate
  exploration passes in the 2026-09-17 run.

- **The Hotel Phone field's own tooltip contradicts its own validation.**
  `#hotelMainPhone` carries `title="Phone number should be in E.123 format
  only! Example: +16502001234"` but `pattern="[0-9 ]+"`, which rejects the
  `+`. A user following the field's own instructions cannot submit the form,
  and the browser's own validation message ("Please match the requested
  format") does not explain why. Real usability defect, not a test artifact —
  confirmed via `checkValidity()` against both forms of the number.

- **Hotel Admin has no delete affordance.** No control anywhere on the tab,
  and none described in the story or BRD. Every hotel a test (or an
  exploration pass) creates is permanent. Name test hotels identifiably
  (`AIDLC-<timestamp>`) and expect QA to accumulate them — do not design a
  test around cleaning up after itself here.

- **The global airline defaults to `2D - Eastern Airlines` on a fresh
  session, not the airline a story assumes.** Confirmed live (2026-09-18
  exploration). A story or plan that reads as though the right airline is
  "already set" is wrong — selecting it is a required action every time, via
  `selectGlobalAirline()` in `clc.ts` (which itself has to wait for the
  session-level API call, not the dropdown's own label, or the next page can
  render under the previous airline).

- **Required fields exist that the story does not mention.** On the Create
  New Hotel form: `CheckOutTime`, `CancelDeadlineTime`/`CancelHours`
  (revealed conditionally by the Layover and Cancel-code selections),
  `Contact1`–`Contact5`, `TaxRate` and `FlatTax` (also `readonly`, computed
  from the Taxes grid) are all marked `required`. A plan built only from the
  story's own field list will not produce a submittable form.

- **Ten checkboxes in Contact Info's Fax/Email section share
  `id="maggFax"`.** Invalid HTML and an accessibility defect. Confirmed live
  during the 2026-09-18 exploration. Cannot be targeted by id at all — see
  `clc-locator-overrides.md`. `fillHotelForm()` in `clc.ts` only fills the
  Fax/Email *text inputs* for this reason, never the checkboxes.

- **The Allocations tab's own "Company" dropdown ignores the header's global
  airline selection.** Observed once, with the header set to `8C` and the
  Allocations tab still reading `2D`. Incidental to Hotel Admin (unaffected —
  its pickup Airline field pre-fills correctly from `8C`) — reported, not
  investigated further.

- **Left-nav entries expose no accessible name while the sidebar is
  collapsed**, and clicking a collapsed entry does nothing at all. Confirmed
  independently in both runs. Navigate by URL instead (deep links work — the
  server re-renders the full page and the session/airline selection
  survive) — see `openAccountManagement()` in `clc.ts`.

- **The Alternate Hotel List grid is paginated at 10 rows a page, not
  capped.** Confirmed live (bolt `US-CLC-003`, 2026-09-20): a station search
  reported "1 - 10 of 108 items" for 8C/DFW. Reading only the rendered rows
  answers "is this hotel already listed?" wrong roughly nine times out of
  ten — the real 3-attempt cost this cost the bolt before an authorized
  diagnostic sweep found it. `searchAltListByStation()` in `clc.ts` reads the
  full set from the search response instead of the DOM for this reason; use
  it, not `altListHotelKeys()` (page-1-only), whenever the question is
  "already listed," not "what's on screen."

- **Re-adding a hotel already on a station's list is a silent no-op.**
  `POST .../AlternativeHotelList/...` returns `200` with no notification of
  any kind, and the Add New dialog is left open — indistinguishable from a
  hung save from the DOM alone. Confirmed live (bolt `US-CLC-003`,
  2026-09-20). Pick a hotel confirmed absent from the full list first (see
  above), rather than asserting this behaviour directly.

- **List Order on the Alternate Hotel List is a coded band, not a free
  number**, despite the form accepting 1-1000. Probed live: 1-29 renders as
  "Short", ~30-59 as "Short/Long", ~60+ as "Do not use Hotels". Neither the
  story nor the BPD documents this. Confirmed live (bolt `US-CLC-003`,
  2026-09-20).

  **Correction (bolt `US-CLC-002`, "CLC_21_09_1" workspace, 2026-09-21 — the
  Alternative Hotel List bolt, not the same-day Manual Entry bolt below that
  reused this id):** the grid shows the number AND the band together — e.g.
  `15 Short` — not the band alone as this entry previously said. Assert both
  if the value matters, not just the label.

- **The cookie-consent modal intercepts the first click of every test unless
  dismissed in the session fixture, not just during exploration.** Cost a
  full 488s timed-out run before this was fixed (bolt `US-CLC-001`,
  2026-09-21) — the behaviour itself was already documented in
  `environment-notes.md`, but nothing had wired `dismissCookieNotice()` into
  `tests/support/test.ts`'s `page` fixture, so every generated spec inherited
  the gap. Fixed in the fixture now; if this recurs, the fixture is the first
  place to check, not the spec.

- **Selecting the global airline and confirming the API call returned 200 is
  not proof the NEXT page renders under that airline.** Confirmed
  intermittent (bolt `US-CLC-001`, 2026-09-21): a Create New Hotel form
  pre-filled its pickup Airline with `2D` in a test that had switched to `8C`
  and waited for `UpdateUsersSessionsAirline`'s response — once in a full
  suite run, never reproduced across 6 further controlled attempts. Recorded
  as an unresolved intermittent race, not a solved bug.
  `openHotelAdminUnderAirline()` in `clc.ts` re-confirms the airline on the
  destination page and re-issues the whole sequence if it doesn't hold,
  rather than trusting the API response alone.

- **Operations Management's Manual Entry screen reports everything —
  validation failures and the success confirmation alike — through native
  `window.alert`, never an in-page toast.** Confirmed live (bolt
  `US-CLC-002`, 2026-09-21). Playwright auto-dismisses a native dialog when
  no handler is registered, so a test that doesn't register one loses the
  assertion entirely and still passes. `captureDialogs()` in `clc.ts`
  registers the handler; use it before any action on this screen that can
  raise one.

- **Manual Entry's crew name-help (`#ManualEntryCrewId`) drops the first
  lookup after the tab loads, and repeating an identical query issues no
  second request at all.** Confirmed live (bolt `US-CLC-002`, 2026-09-21),
  across 4 of 7 exploration passes before a network-capture pass found the
  cause: the widget also fires two lookups per keystroke burst, and
  `search=` runs one query ahead of `filter[filters][0][value]` — the
  parameter the server actually matches on. `pickManualEntryCrew()` in
  `clc.ts` always warms up with a distinct throwaway query first.

- **Manual Entry's Cost Center dropdown defaults its first option to the
  literal string "Not Used."** Picking it without looking saves successfully
  and records a cost centre of `NA` — meaningless data that passes every
  check that isn't a value comparison. Confirmed live (bolt `US-CLC-002`,
  2026-09-21). `chooseManualEntryOption()` in `clc.ts` always takes an
  explicit option text, never a default.

- **The Manual Entry form clears every field after a successful submit**,
  contradicting the story's own claim that entered data is retained
  afterward. Confirmed live (bolt `US-CLC-002`, 2026-09-21) — reported as a
  story/product disagreement, not resolved either way.

- **Room Blocks calls fire with `airlineSymbol=2D` on an active 8C
  session.** Observed once (bolt `US-CLC-002`, 2026-09-21), incidental to
  Manual Entry. Same family as the Allocations tab's airline-scoping defect
  — not investigated further.

- **The airline-propagation race reproduces on Operations Management's Manual
  Entry too — a THIRD screen.** Confirmed live (bolt `US-CH-MENT-001`,
  2026-09-24): a spec calling `selectGlobalAirline` and then `openManualEntry`
  directly landed on a Manual Entry tab still rendering `2D - Eastern
  Airlines`. With Hotel Admin and Transportation Manual Entry, that is three
  unrelated screens — treat the race as a property of the session switch and
  reach ANY airline-scoped screen through `openUnderAirline` (here,
  `openManualEntryUnderAirline`), never through a bare select-then-navigate.

- **Manual Entry's "Overlapping Layovers" confirm has now been observed BOTH
  ways with identical input.** Earlier bolts recorded it as conditional by
  inference; bolt `US-CH-MENT-001` (2026-09-24) saw it fire on some submits
  for crew `19999` and not on others, in the same session shape. Never assert
  a dialog COUNT on this screen — match the success alert by its own text.

- **Manual Entry's submit fires two calls, and the success alert is raised by
  the second.** `POST /CrewRez/ManualEntry/ValidateOverlap` returns almost
  immediately; `POST /api/v1/ManualEntry_API/ManualEntry/Create` returns
  31-33s later and the alert lands with it (measured three times, 2026-09-24).
  `submitManualEntry()` in `clc.ts` waits on the create response, which is what
  makes a "no dialog appeared" failure diagnosable — one such run left no way
  to tell whether the request had even been made.

- **The confirmation message pads the employee id**, so the whitespace around
  it depends on how many digits the id has: `EmployeeID 1322 was` (4-digit)
  versus `EmployeeID 19999  was` (5-digit). Confirmed live as a heal (bolt
  `US-CH-MENT-001`, 2026-09-24). Assert the sentence anchored with `\s+`
  around the id, never a copied literal — see
  `knowledge/org/assertion-catalog.md` for the general form.

- **Manual Entry never displays the station NAME for an entered station code**,
  despite the story's AC-4/AC-5 claiming it does. The station input's own
  `<label for="ManualEntryArrivalStation">` exists but is permanently empty and
  the input carries no `title` — while the app clearly knows the mapping,
  printing "Hampton Inn & Suites Austin-Downtown" for `AUS` inside the confirm
  dialog seconds later. Confirmed live (bolt `US-CH-MENT-001`, 2026-09-24) with
  the empty-field state observed in the same session for comparison.

- **The CrewRez dashboard throws a JavaScript error on load:**
  `Identifier 'RoomDetails' has already been declared`. Confirmed live
  (2026-09-24) on every Manual Entry page load — a script is being included
  twice. It does not appear to break the Manual Entry flow, but anything later
  in that script after the throw is not running. Reported, not investigated.

- **A five-digit crew employee id is rare in this QA data.** Searching the
  Manual Entry name-help for `smith`, `brown`, `garcia`, `will` and `mar`
  returned 4-digit ids only; `john` and `lee` returned the only three 5-digit
  ones found — `19999` (John, Peter), `89989` and `99890`. Recorded in
  `clc.ts` as `MANUAL_ENTRY_CREW_5DIGIT` (bolt `US-CH-MENT-001`, 2026-09-24).

- **The Reporting module (`/Reports/Report`) has four traps, all confirmed live
  (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24, first bolt to touch it).**
  All four are now encoded in `clc.ts`'s Reporting section — use those helpers
  rather than re-deriving:
  1. **The filter panel starts COLLAPSED on UAT and expanded on QA**, same
     account and app version. Collapsed, the page looks entirely empty — no
     headings, no categories. The header "Reports" button (`ShowReports()`)
     expands it, and its accessible name carries a leading icon glyph so an
     exact-name match finds nothing.
  2. **The category buttons are written by JavaScript after load.** Reading
     them through `page.evaluate` proves they EXIST without proving they are
     VISIBLE — that distinction produced two wrong conclusions in a row in the
     bolt that found it, including a retracted "this account has no Reporting
     access" claim.
  3. **The date inputs APPEND on `fill()`.** An end date became
     `11/1/202611/30/2026`, which runs the wrong query silently rather than
     failing, and made three reports look as though they simply returned
     nothing. Select-all, delete, then type.
  4. **"Export to Excel" is an `<a>` with no `href`**, so neither a
     `getByRole('button')` nor a `getByRole('link')` lookup finds it. Locate it
     by text within `a`. "Export PDF" and "Send By Email" beside it ARE
     buttons, which makes the miss easy to overlook.

- **Every report has its own Airline / Station / Hotel filters. They start
  EMPTY ("all"), and the header airline does not set them.** Run with dates
  only, Master Reservation Detail, Total Spend and Room Cancelation answer
  `"An error occured while loading the report."` (product typo), Global
  Billing returns `"No data was returned for your query."`, and a 5J session
  can show other airlines' rows. With all three set, every report loads and
  matched the account team's manual exports cell for cell (run-8 fix run,
  2026-09-25). Which filter the error needs is not bisected: set all three
  with `selectReportFilter`. **Room Cancelation has no Hotel filter.** When
  several screens misbehave at once, look for one shared missing input first.

- **The report filter dropdowns are plain Kendo dropdownlists**, not the
  filterable kind `kendoSelect` handles: typing does not narrow them, so pick
  by exact option text. Airline and Station options are bare codes (`5J`,
  `CRK`); Hotel options are `<key> - <name>`. Kendo rebuilds the listbox as it
  opens, so `selectReportFilter` re-issues the open-and-pick inside `toPass`.

- **Known-good test data for these reports is in `tests/support/fixtures.ts`**
  as named `REPORT_SLICE_*` constants with their status and verified date.
  Specs import a slice by name; look up only the one a bolt names.

- **The crew reports lay out crew columns differently, and only the
  Reservation Detail Report has `Occupancy`.** Use `REPORT_CREW_COLUMNS`,
  `readCrewRows` and `crewNameProblem` in `clc.ts`, never one report's
  layout for another. A shared room shows as two IDs joined with `/`; match it
  on the ID column, since `/` also appears in crew types (`F/O`). A shared
  room that lost its partner's ID looks like a single row, so check Master
  Reservation Detail, Total Spend and Global Billing against the Reservation
  Detail Report for the same slice with `sharedRoomMismatches` (verified for
  those three, Crew Sign In and Room Cancelation). The same
  check makes a **"some show just one crew"** symptom testable on any report
  that lists shared-room crew, including Crew Sign In and Daily Crew Report
  (LOD-76916). Both carry a reservation ID and show a shared room as one row
  (`a/b`), so their profiles are in `REPORT_CREW_COLUMNS`. **Daily Crew Report
  covers a single date**, so choose a date on which a shared room exists. For
  any other new report, check from a real export whether a shared room is one
  row or two rows (one per crew member) before using `sharedRoomMismatches`,
  which would wrongly flag the two-row layout.
  **Unconfirmed:** Occupancy `D` means two crew sharing; every `D` row seen so
  far has two IDs.

- **Total Spend's `0 / 0 / 0` rows with flight `SBLK` are space blocks** (a
  room block with no crew), probably not the bug. `crewNameProblem` flags
  them on purpose; exclude them only once a domain expert confirms.

- **Station/Hotel "leaks" seen once, not since.** Global Billing includes
  other stations' transport vendors, probably by design. Total Spend once
  returned other stations for a CRK / Quest Plus filter, unexplained, and it
  did not recur. Read the station column back; don't file it without a repeat.

- **Retracted 2026-09-25:** "three reports fail to load", "the Reservation
  Detail Report ignores the global airline" and "Reporting result sets are not
  stable between runs". All three were unfiltered queries (first entry above).
  What survives: a Reporting test must assert its slice contains the rows it
  intends to check.

- **`selectGlobalAirline`'s own no-op guard could read `#MainAirline` before
  Kendo had written the session's airline into it.** The wrapper
  (`span.k-dropdown-wrap`) is present and readable before its value lands, so
  on a slow render the guard saw something other than the target, took the
  switching branch, clicked, and then waited 60s for an
  `UpdateUsersSessionsAirline` request Kendo never sent — because the widget's
  internal value was already the target. Confirmed live as a heal (bolt
  `US-CLC-001`, 2026-09-24, run 2 of 4): the failure snapshot showed
  `8C - Air Transport Int. (ATI)` in the header the whole time, which reads
  like the test wanted the wrong airline rather than like a misread guard.
  Fixed in `clc.ts` by settling the widget with a retrying `toHaveText` before
  reading it. Ran green twice consecutively afterwards. Note this is a
  *different* defect from the airline-propagation race below — that one is the
  server not applying a switch that did happen; this one is a switch that
  never needed to happen being waited for anyway. See
  `knowledge/org/locator-policy.md`'s "Settle a control before reading it" for
  the general form.

- **Hotel Admin's baseline suite time: ~138s for 5 tests at `workers: 1`**,
  and the intermittent airline-propagation race (pickup Airline rendering
  `2D` on an `8C` session — see `openHotelAdminUnderAirline` in `clc.ts`)
  did NOT reproduce across 3 form journeys in the "CLC_21_09_1" run
  (2026-09-21). Still unresolved, not fixed — this is negative evidence
  (it didn't fire this time), not a claim it's gone.

- **The Alternate Hotel List's "Comments" field is saved but never shown
  anywhere in the grid.** The grid's real column list (confirmed live,
  "CLC_21_09_1" workspace, 2026-09-21) is Order, Order Description, Hotel
  Key, Hotel Name, Station, Last Room Rate, When, Contract Type, Commission
  Rate, Posted By, Can Other Airline See This?, Symbol, Action — no Comments
  column at all. Reading it back requires `altListEntriesByStation()` in
  `clc.ts`, which reads the underlying data the grid is bound to, not the
  rendered row. Also: Comments is NOT actually a required field on the Add
  New dialog, despite the story calling it required.

- **Ten unlabeled `k-icon k-i-delete` spans render in the Alternate Hotel
  List grid's Action column, one per visible row — a probable delete
  control, invisible to assistive tech, never activated.** Confirmed live
  ("CLC_21_09_1" workspace, 2026-09-21). Deliberately NOT tested: it is
  destructive and covered by no requirement. Do not treat "Hotel Admin has
  no delete affordance" as automatically true of this screen too — this icon
  is a real, unconfirmed lead, not a fact either way.

- **The Alternate Hotel List's station data already holds more list entries
  than distinct hotels** (113 items / 111 hotels observed live, "CLC_21_09_1"
  workspace, 2026-09-21) — duplicates exist in real QA data despite the
  silent-no-op rule above. Not investigated further; noted so a bolt doesn't
  assume the no-op rule guarantees a duplicate-free list.

- **Gate 2 checklist item 12 ("suite passes twice in a row") doubles
  permanent data creation on an application with no delete affordance.**
  Confirmed live (bolt `US-CLC-001`, "CLC_21_09_1" workspace, 2026-09-21): a
  plan that estimated 3 permanent hotels created 7, because the mandatory
  second full-suite run re-executes every creating test. This is inherent to
  the checklist item on this application, not a defect in any one run — a
  Gate 1 data-cost estimate that only counts "per pass" will always
  undercount by roughly double on a screen with no cleanup path.

- **A shared fixture had been silently wrong for five bolts.**
  `newHotelFixture()` supplied `checkInTime: '3:00 PM'` (and the same for
  `checkOutTime`/`cancelDeadlineTime`). The Kendo timepicker's contract is
  24-hour `HH:MM`, so `'3:00 PM'` was kept as `03:00` — 3 AM. Confirmed live
  (bolt `US-CLC-001`, "CLC_22_09" workspace, 2026-09-22): nothing went red for
  five prior bolts because no earlier spec ever read a time field back; this
  bolt's own read-back assertion was the first to catch it. Fixed in
  `newHotelFixture()`, and `fillHotelForm()` now throws outright on a
  non-24-hour time value so the same mistake cannot recur silently. See also
  `locator-policy.md`'s new rule on never verifying a locator with a
  comma-separated OR selector — the same run's other finding.

- **Transportation Manual Entry only saves the FIRST submit per crew member;
  every submit after that is silently refused.** Confirmed live (bolt
  `US-CLC-002`, "CLC_22_09" workspace, 2026-09-22, Transportation Manual
  Entry — a third, unrelated screen this bolt id has been assigned to):
  exploration consumed one crew member (employee 1322) with a single submit,
  and every suite run since was refused with no distinguishing error.
  Reported as a product defect, not resolved — pick a crew member confirmed
  not yet used by this bolt's own exploration writes, and expect at most one
  successful submit per crew member for the life of a workspace.

- **Transportation Manual Entry's Position dropdown is sometimes enabled on
  arrival, when it should start disabled until a crew member is chosen.**
  Confirmed live (bolt `US-CLC-002`, "CLC_22_09" workspace, 2026-09-22):
  disabled across 7 exploration passes and 3 runs, but enabled on arrival in
  1 of 4 suite runs — an init race, not a deterministic behavior. Deliberately
  not patched: waiting for "disabled" inside the navigation helper would make
  a spec's own assertion of that state tautological. Recorded as an
  unresolved intermittent, the same treatment as the airline race below.

- **The airline-propagation race is confirmed screen-independent.** Selecting
  the global airline and confirming `UpdateUsersSessionsAirline` returned 200
  is still not proof the next page renders under it — this reproduced on
  Transportation Manual Entry (bolt `US-CLC-002`, "CLC_22_09" workspace,
  2026-09-22: `/CrewRez/Dashboard` rendered `2D` in a run that had selected
  `8C`), the second unrelated screen to hit it after Hotel Admin. `clc.ts`'s
  `openUnderAirline()` now handles both screens with one shared retry
  function instead of a copy per screen.

- **Hotel Admin's Commission field reads back as a formatted percentage, not
  the entered number.** Confirmed live (bolt `US-CLC-001`, "CLC_22_09_1_1"
  workspace, 2026-09-22): entering `10` and reopening the record by Hotel Key
  shows `10.00%`. Assert the read-back value against the formatted string, not
  the entered literal.

- **Operations Management's Manual Entry does NOT share Transportation
  Manual Entry's one-submit-per-crew-member limit.** Confirmed live (bolt
  `US-CH-MENT-001`, "CLC_22_09_1_1" workspace, 2026-09-22): crew `1322`
  submitted successfully in exploration pass 1 and again in pass 2, and the
  same crew member is deliberately reused by every generated test rather than
  varied. Checked deliberately, before generation, because the sibling
  screen's limit could easily have been assumed to apply here too — it does
  not. Do not carry the Transportation screen's data constraint over to this
  one.

- **Submitting a Manual Entry for a crew member who already has an
  overlapping entry raises an EXTRA confirmation dialog first** — "Do you
  really want to create manual entry for the Employee \<id\>? ALERT :
  Overlapping Layovers found." naming the station, both flights and the
  hotel. Accepting it proceeds normally. Confirmed live (bolt
  `US-CH-MENT-001`, "CLC_22_09_1_1" workspace, 2026-09-22) — and only because
  this bolt's own exploration writes had already created an overlap for that
  crew member; neither exploration pass saw the dialog, the first suite run
  after them did. A test on this screen cannot assert a fixed dialog count;
  assert that the required message is present (`waitForDialog()` in `clc.ts`),
  not the length of the captured array.

- **Manual Entry's confirmation dialog arrives roughly 32 seconds after
  Submit**, not a couple of seconds. Confirmed live (bolt `US-CH-MENT-001`,
  "CLC_22_09_1_1" workspace, 2026-09-22): a click at 43.7s produced the alert
  at 76.0s. A read taken 4s after Submit sees nothing and can be mistaken for
  "no confirmation appears" rather than "not yet." `waitForDialog()` in
  `clc.ts` defaults its timeout large enough for this.
