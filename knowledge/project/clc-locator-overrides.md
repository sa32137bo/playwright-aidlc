# Locator overrides — CLC

CLC-specific DOM/locator conventions that recur across screens. Confirmed
instances of the org locator policy's general rules are noted with a pointer,
not restated — see `knowledge/org/locator-policy.md` for the mechanism.

Sources: bolt `US-CLC-001`, run "CLC_Automation" (2026-09-17, completed,
4/4 passed) and run "CLC_18_09" (2026-09-18, exploration only). Both against
https://crewhub-qa.taconnections.com/.

## Reusable framework already built for this project

`tests/support/clc.ts` (deployed from `clc-framework/support/clc.ts`) already
implements sign-in, Kendo dropdown handling, Account Management/Hotel Admin
navigation and the full Create New Hotel form fill, all live-verified. Import
from it before writing a new locator for anything it already covers — see
that file's own header for exactly what it has.

## Form inputs have stable `id`/`name` but almost no accessible names

Labels on the Create New Hotel form (and elsewhere in Hotel Admin) are plain
text nodes, not `<label for>`. `getByRole('textbox', { name })` cannot reach
them. Author-written `id`/`name` attributes (`#hotelName`,
`[name="CheckOutTime"]`) are the org locator policy's documented escape hatch
for exactly this shape — used throughout `clc.ts`. These are stable,
human-authored names, not framework-generated hashes; they are not expected
to be as brittle as, say, a Kendo internal id.

## `#hotelAdminForm` scoping is required, not optional

The page carries several other hidden forms that reuse the same `name`
attributes as the visible one — `FaxNumber1` alone resolves to two elements
document-wide. Every field lookup in `fillHotelForm()` is scoped through
`hotelForm(page)` (`#hotelAdminForm`) for this reason. Do not query a field by
`name` at the page level.

## Kendo dropdownlist: filter by typing, never `fill()` the popup box

`NearestStation`, `StationCode` and `CreditCardCurrencyCode` (and probably
others not yet touched) hide a real `<input>` behind a `span.k-widget`, with
options in a virtualised popup at `#<id>_listbox` — up to 2759 entries
(`NearestStation`). Two rules, both load-bearing:

- **The list must be filtered, never scrolled.** It is virtualised, so an
  unfiltered option simply is not in the DOM to click.
- **Type the filter text on the keyboard; do not `fill()` the popup's filter
  input.** `fill()` scrolls its target into view, and the popup's filter sits
  above a list taller than the viewport — scrolling to it pushes the
  dropdown's own anchor off-screen, which makes Kendo close the popup. This
  was observed live as the filter correctly narrowing 2759 options to 1, and
  the popup then closing with that one option still in the DOM but invisible
  — reads exactly like a missing element, not a closed menu. See
  `kendoSelect()` in `clc.ts`, which types instead.

## The airline-switch race: wait for the API call, not the dropdown's label

Selecting a value in the header's global airline Kendo widget
(`#MainAirline`) updates the widget's own displayed text immediately, but the
airline only takes effect once `UpdateUsersSessionsAirline?airline=<code>`
returns. Asserting on the label alone passes a moment too early — the very
next page load can then render under the *previous* airline (observed live:
a pickup Airline field reading `2D` immediately after selecting `8C`). See
`selectGlobalAirline()`, which waits for that response.

## Ten checkboxes share `id="maggFax"` — do not target by id

Confirmed live (2026-09-18 exploration) on the Contact Info Fax/Email
toggles. Invalid HTML; `#maggFax` cannot reach any one of them reliably. Not
yet worked around in `clc.ts` because no generated spec has needed to toggle
one of these checkboxes — `fillHotelForm()` only fills the adjacent text
inputs. The next bolt that needs one of these ten checkboxes will need a
positional or structural fallback and should record what it lands on here.

## The Hotel Admin toast: two separate elements, hidden not removed

`#hotelAdminCustomToast` is the container; `#hotelAdminToastHeadertxt` and
`#hotelAdminToastBody` hold the header ("Success"/"Invalid") and body text
separately. It is hidden via a `d-none` class rather than removed from the
DOM, so assertions must check visibility, not presence.

## Left-nav entries: no accessible name while collapsed

Confirmed independently in both runs. See
`knowledge/project/clc-known-flaky-areas.md` for the behavior; `clc.ts`'s
`openAccountManagement()` avoids it entirely by navigating with `page.goto()`
rather than clicking the rail.

## A station dropdown's rendered case is CSS, not its DOM text

The `NearestStation`/`StationCode` widget renders "DFW   | DALLAS/ FT. WORTH" — uppercase — via a CSS `text-transform`, but its actual DOM text is mixed-case with padding: `"DFW   | Dallas/ Ft. Worth                       "`. `toHaveText` compares textContent, so an expected string copied from a rendered or `innerText()` reading fails against a screen that visibly shows exactly that text. Confirmed live as a real heal (bolt `US-CLC-001`, "CLC_22_09_1_1" workspace, 2026-09-22). `clc.ts` exports `STATION_DFW_TEXT`, an anchored case-insensitive regex, for exactly this field — use it (or the same shape for another station) rather than a literal copied from what the browser shows. See `knowledge/org/assertion-catalog.md`'s "an expected value is only as good as the state it was derived from" for the general rule this is an instance of.

## `#MilesFromStation`'s visible label reads "Minutes from Station"

Label and field name disagree on the unit. Not resolved — source-code
grounding is off for this project (`e2e.config.yml`'s `source.path` is
blank), so which one is actually wrong is a question for a developer, not
something to guess at by converting units in a spec or fixture.
