# Lessons log

The full story behind rules in `skills/` and `knowledge/org/`. The rules themselves carry only a one-line citation; this file keeps the evidence so it is not lost when a rule is tightened.

This file is for maintainers of the kit. Bolts do not need to read it, and it is not shipped into workspaces. Append new entries under the file the rule lives in; when a rule is retracted or corrected, say so in its entry rather than deleting the entry.

## skills/e2e-intake

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — Input fitness signals ignored
The input hit all five signals: a customer Jira bug export with no acceptance criteria, formally blocked by another ticket, reported fixed and then broken again, across nine data-dependent reports. The bolt ran 1h 44m, the defect did not reproduce, and the team read the result as a failed bolt. Every signal was visible in the ticket before exploration began.
Rule: skills/e2e-intake/SKILL.md → 5. Validate / Input fitness — warn, don't block

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — Broad default filters read as a product defect
The bolt changed only the airline and the month, and left Station on "All Stations" and Hotel blank on all five reports. Three of them errored and one returned nothing, and the bolt recorded that as a product defect. The next day an account-team tester downloaded all five, on the same UAT environment, by picking a specific station and hotel for each. The ticket's own screenshots had already shown a working station, hotel and window.
Rule: skills/e2e-intake/SKILL.md → 5a. Test data — resolve it here, never leave it to exploration

### GHC run-9 — Knowledge Assistant skipped because code_grounding was off
A bolt with all three vars correctly configured never attempted the Knowledge Assistant call at all. Its own `intake.yml` recorded `code_grounding: "off"` with a comment claiming "the live application is the only grounding source", which was false. The two settings share the English word "grounding" and nothing else; they are unrelated config, read from unrelated places, gating unrelated skills.
Rule: skills/e2e-intake/SKILL.md → 4a. Knowledge Assistant grounding — always attempted, independent of everything else

### US-CLC-002 (CLC project) — Bolt ID reused for unrelated stories
`US-CLC-002` was assigned to three unrelated screens across three runs, each needing after-the-fact disambiguation in every downstream citation. Nothing upstream of intake checks for this, so intake is the one place that can.
Rule: skills/e2e-intake/SKILL.md → 7. Write the intake

## skills/e2e-plan

### GHC run-6 — helper hand-copied instead of called
GHC run-6 hand-copied a helper from the shared module into a throwaway exploration script nearly verbatim instead of calling it. It happened to match exactly that time, but a hand-copy drifting silently from the real function is exactly the risk that calling it removes.
Rule: skills/e2e-plan/SKILL.md → Before another live exploration pass — check for reusable code first, then knowledge/project

### GHC run-6 — 15 exploration scripts, 15 sign-ins
GHC run-6 split CUST-001 and DRV-002 exploration into 15 separate `.explore/*.js` files, each with its own sign-in: roughly 15 × 25s of repeated-login overhead for no benefit. Background: an SDK-driven IdP widget was measured at ~25s on one project and a form login at ~7s on another. One project confirmed that a restored `storageState` context keeps a token with life left, but its IdP's SSO cookie does not survive into the restored context, so its SDK discards the token within seconds and silently signs out. That is specific to that app's auth, and to restoring a session in a new process.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes — sign-in cost is real and does not amortize across script runs

### GHC run-11 — journey re-run four times for locator issues
A single bolt re-ran the same journey four separate times to fix three self-inflicted locator issues (a placeholder-prefix collision, an input mask, group-section scoping). One upfront snapshot would have surfaced all three together.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (inventory on arrival)

### US-CLC-003, 2026-09-20 — unnoticed pagination survived three heal attempts
A grid reporting "1 - 10 of 108 items" sat on screen through three separate heal attempts because no inventory pass had looked at it. Each attempt fixed a real defect in the logic reading the rendered rows, but none addressed that the rendered rows were never the full picture.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (pagination check, `dumpPager()`)

### US-CLC-003, 2026-09-20 — exploration write became a colliding fixture
An early exploration pass created a record before the screen's numbering scheme was understood. A later generated spec kept colliding with that exact record, long after the pass that created it was forgotten.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (record exploration writes)

### US-CLC-002, 2026-09-22 — single-use-per-entity limit found mid-heal
Transportation Manual Entry. Exploration's single submit used up the only usable attempt for that crew member. Every generated suite run afterwards failed identically, burning 3 heal-bound attempts before it was correctly reported as unfixable. One cheap extra exploration step (repeat the same submit immediately for the same entity) would have surfaced it before generation, so the plan could state it as a known constraint, with Gate 2's "not achievable — product constraint" outcome, from the start.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (second-submit probe)

### US-CH-MENT-001, 2026-09-22 — probe invalidated by form clearing; useful negative result
Operations Management's Manual Entry. The probe worked on this sibling screen the next day and gave a useful negative result: the same crew member submitted twice successfully. But the first pass's repeat submit was silently invalidated by a different discrepancy: the form clears every field after submit, so the "second submit" was a submit of an empty form. Only a second, deliberately scoped pass caught this and re-ran the probe correctly.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (re-probe if the second submit fails for an unrelated reason)

### US-CLC-002, 2026-09-21 — four guessed retries; network capture found the cause
Four exploration passes in a row failed on the same name-help lookup, each retried with a slightly different guess. The pass that captured network traffic found the real cause, a request-ordering bug in the widget itself, in one run. `e2e-heal` already had this discipline ("classify before repairing"); exploration had no equivalent until then.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (instrument after two failures)

### US-CLC-002, 2026-09-21 — cited discrepancy applied to half a scenario
A plan correctly cited the Alternate Hotel List's pagination discrepancy when choosing which hotel to add, reading the full station list. One section later it verified the save by asserting against the rendered rows of that same paginated grid, exactly what the citation said not to trust.
Rule: skills/e2e-plan/SKILL.md → Batch exploration passes (apply a cited discrepancy everywhere)

### US-CLC-001, 2026-09-17 — "no message appears" was false
Exploration polled a fixed list of toast selectors (`.toast`, `.alert`, `.k-notification`, `[role=alert]`, …) that did not include this app's own `.custom-toast`, and searched the body text for words ("already", "exists", "duplicate") the real message never used. Two negative searches were written up as "no message appears at all" and went to a human at Gate 1 as fact. It was caught only because the generated spec asserted `toBeHidden()` on the toast and the run went red against a visible toast. The success path's toast was observable in the same session; comparing the two DOM states would have shown the container at once.
Rule: skills/e2e-plan/SKILL.md → Before writing that a UI element is absent

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — `page.evaluate` read taken as visibility
Two contradictory, both-wrong conclusions about an empty-looking page reached the owner before `isVisible()` was checked and the ancestors walked for a `display: none` container.
Rule: skills/e2e-plan/SKILL.md → Before writing that a UI element is absent

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — four of five in-scope reports never opened
The single most expensive miss in its bolt. Exploration stopped with one of five in-scope reports verified and handed the other four to generation. The owner asked for them to be checked at Gate 1; they returned an error or no data (later shown not to be a product defect as stated — see the next entry). The approved plan's central premise was false and Gate 1 had to be re-presented: ~20 minutes and a second human approval, against a few minutes for four smoke passes batched into one script.
Rule: skills/e2e-plan/SKILL.md → Before Gate 1 — open every in-scope screen at least once

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — wrong product-defect claim
Three reports "failed to load" and one "returned no data", and the bolt called these product defects "neither airline- nor window-specific". It had varied only airline and month. The next day an account-team tester, on the same UAT environment, downloaded all five by choosing a station and a hotel. By then the claim was already in the plan, the audit log, `knowledge/project`, and a spec's failure message addressed to the client team. The cause is still not isolated (filters, or data/build changing overnight).
Rule: skills/e2e-plan/SKILL.md → Before calling a screen broken — isolate the cause

### US-CLC-MISSINGCREWNAME-001 (re-check), 2026-09-25 — known-good input lacked the condition under test
The known-good inputs the account team supplied made all five reports load, but three of the five returned no shared-room rows at all. For those three, the input proved the report loads and could not re-test the bug.
Rule: skills/e2e-plan/SKILL.md → Test data comes from intake, not from exploration

### US-CLC-MISSINGCREWNAME-001, 2026-09-24/25 — filters that do not filter
Seen live on three CrewHub screens (Allocations tab, Room Blocks, Reservation Detail Report): a 5J session returned rows whose own Airline Id read `OY`, and 5J and 8C returned identical row counts. In the account team's exports (2026-09-25), a report filtered to one station and hotel also returned rows for four other stations.
**Correction (2026-09-25, run-8 fix run):** the Reservation Detail Report's `OY` row came from the report's own Airline filter being empty, not from the report ignoring the airline. The Allocations-tab and Room Blocks cases come from earlier bolts and stand. The Total Spend station leak from the first export set did not recur.
Rule: skills/e2e-plan/SKILL.md → A filter the story depends on — verify it actually filters

## skills/e2e-generate and skills/e2e-heal

### Earlier project on this kit — overrides fix ignored at generation
The project's overrides file documented that a field needed `exact: true`; generation wrote the locator without it anyway, and the strict-mode failure cost a whole heal-and-rerun cycle to fix something already on record. The single most expensive miss on record at the time.
Rule: skills/e2e-generate/SKILL.md → Rules — check these first

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — airline-scoping defect not checked on a third screen
The airline-scoping defect was already recorded for two screens in `clc-known-flaky-areas.md`, and nothing prompted a check for it on a third.
Rule: skills/e2e-generate/SKILL.md → Rules — check these first

### US-CLC-001, 2026-09-21 — sign-in modal dismissal missing from the fixture
The dismissal was documented in `knowledge/project/environment-notes.md` and read at intake, and still never reached the generated specs' `page` fixture, because generating a spec's locators never touches what the fixture does before the test body runs. Cost a full timed-out run.
Rule: skills/e2e-generate/SKILL.md → Rules — check these first (session state)

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — report specs borrowed a sibling report's columns
Four report specs copied the Reservation Detail Report's `Employee Id` / `Occupancy` / `Crew Last Name` columns. The real exports use `Crew ID` / `Crew L Name`, `L  Emp Id` / `CP  Name Last`, `CR  Crew Member Name` and `Employee Name`, and none has an Occupancy column, so all four would have failed on "column missing" even once the reports loaded.
Rule: skills/e2e-generate/SKILL.md → Never assert on output nobody has seen

### Earlier project on this kit — typed input discarded during an async form rebuild
A form finished its visible render, then rebuilt state asynchronously; anything typed in that window (measured 6-8.5s) was silently discarded. A real product bug, not only a flaky test.
Rule: skills/e2e-generate/SKILL.md → Other rules (Typing)

### US-CLC-001, 2026-09-20 — tab click accepted before handler bound
`openHotelAdmin()`'s tab click succeeded and switched nothing; three other tests in the same run hit no such delay.
Rule: skills/e2e-generate/SKILL.md → Other rules (Clicking)

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — attempt 3 correctly left a flaky export test red
Attempt 3 on a flaky export test was spent diagnosing, concluded the report ignores its airline filter and returns different result sets between runs, and changed nothing: the right result. (Its diagnosis turned out wrong: both were unfiltered queries, since the report's own filters start empty. Changing nothing was still right, because the guard held and the fix was in the test data.)
Rule: skills/e2e-heal/SKILL.md → Step 3

## skills/e2e-bolt

### US-CLC-001, 2026-09-22 — Known-screen estimate was accurate
Estimated 20 minutes on one exploration pass; actual was about 20. A screen already covered by `clc.ts` is a known screen, and past bolts show the estimate holds closely there.
Rule: skills/e2e-bolt/SKILL.md → GATE 1 — HARD STOP (known screen vs first-contact)

### US-CLC-002, 2026-09-22 — First-contact surface estimate nearly doubled
Transportation Manual Entry, a new surface. Estimated about 35 minutes on 7 exploration passes; actually about 65, because five of six heals were each a genuinely new fact about the screen. On first-contact surface the cost driver is how many behavioural surprises the screen holds, which is not knowable at Gate 1: name it as the variable, don't size it.
Rule: skills/e2e-bolt/SKILL.md → GATE 1 — HARD STOP (known screen vs first-contact)

### US-CLC-001, 2026-09-20 — Permanent data count surfaced only because intake asked
The permanent-record count was reported by hand only because the interview asked; nothing else enforced it. The cost is invisible until someone looks at the data, and it compounds on every future run against the same environment.
Rule: skills/e2e-bolt/SKILL.md → GATE 1 — HARD STOP (permanent data cost)

### US-CLC-001, 2026-09-21 — "Per pass" figure approved; bolt created 7, not 3
A plan stating "3 per pass" was approved on that number, and the bolt created 7: every creating test runs again for checklist item 12's determinism proof.
Rule: skills/e2e-bolt/SKILL.md → GATE 1 — HARD STOP (permanent data cost); knowledge/org/review-checklist.md item 12

### US-CLC-001, 2026-09-22 — Even the doubled figure undercounted (4 estimated, 8 actual)
A red first run still creates its records before failing at a read-back assertion, and a diagnostic re-run with a readable reporter creates them again. Neither is "a pass" for item 12, but both cost the same data. Hence `per-pass × (1 + diagnostic runs + heal re-runs + 1 determinism run)`.
Rule: skills/e2e-bolt/SKILL.md → GATE 1 — HARD STOP (permanent data cost)

### US-CLC-002, 2026-09-21 — One "single-record" scenario left about 5 records
A bolt that heals 3 times re-runs its creating test 4 times, so "1 record per run" and the count left in QA differ by the number of heal-and-rerun cycles. Count every exploration write and every full-suite run that included the creating test.
Rule: skills/e2e-bolt/SKILL.md → Post-mortem (automatic), part 1

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — "4 failed" read as bolt failure; defect claim overreached
The result JSON said "MIXED BY DESIGN", but the team read the HTML report's "4 failed, 1 passed" as a failed bolt. The bolt's own wording, "reports that do not load", also claimed more than it had shown: the next day an account-team tester loaded all four on UAT by choosing a station and a hotel.
Rule: skills/e2e-bolt/SKILL.md → 6. Run — unless mode is greenfield

### Earlier project on this kit — Gate 2 checklist did not survive the session
No way to tell whether item 25's "quote the first option's text" was met for six of a bolt's seven `first: true` dropdowns: the checklist had only been shown interactively.
Rule: skills/e2e-bolt/SKILL.md → GATE 2 — Review checklist

### Earlier project on this kit — Audit timeline with zero timestamps
One bolt's `## Timeline` had no timestamps at all, only prose ("exploration pass 1", "Run 3: 6 passed"), so it was impossible to check afterwards whether its exploration beat the baseline. A timestamp's value is entirely in hindsight.
Rule: skills/e2e-bolt/SKILL.md → Audit log — `bolts/<ID>/audit.md`

## knowledge/org/locator-policy.md and exploration-notes.md

### US-CLC-001, 2026-09-20 — Click accepted before handler bound
On a server-rendered page the control is visible, enabled and hit-testable while its script is still loading, so actionability checks pass, the click lands, and nothing happens: a successful click followed by a long wait for a state that never arrives. Re-issuing the action inside `toPass` self-limits on a fast render.
Rule: knowledge/org/locator-policy.md → Waiting

### US-CLC-001, 2026-09-24 — Skip-guard read an unsettled widget
A bad read made the code take the acting branch, waiting for a change event a no-op never fires: a 90s timeout whose captured page state showed the target already selected, which reads as if the test was wrong about what it wanted.
Rule: knowledge/org/locator-policy.md → Waiting → Settle a control before reading it

### US-CH-MENT-001, 2026-09-24 — Side-effect-only wait gave no diagnosis
A submit produced zero dialogs in 120 seconds, and the artifact could not say whether the create call had even been made; a separate instrumented run was needed. Waiting on the cause as well adds an assertion rather than relaxing one.
Rule: knowledge/org/locator-policy.md → Waiting → When the thing you assert on is a side effect

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — evaluate read mistaken for visibility
An empty-looking page was first reported as "this account has no access", then "the buttons are there after all" on an `evaluate` read. Both wrong: the buttons existed inside a collapsed `display:none` panel, found only by an ancestor-chain probe.
Rule: knowledge/org/locator-policy.md → Waiting → Existence is not visibility

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — fill() appended to a date input
An end date became `11/1/202611/30/2026`, a wrong query with no error, and three reports looked as though they returned no data.
Rule: knowledge/org/locator-policy.md → Waiting → `fill()` does not always replace

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — href-less anchor missed by role scan
"Export to Excel" was an anchor with no href while "Export PDF" beside it was a button, so a role scan found the neighbours and missed it; the role-based locator in the spec cost a run.
Rule: knowledge/org/locator-policy.md → Waiting → A link with no `href`

### US-CLC-001, 2026-09-21 — Cookie-consent dismissal not in the fixture
The dismissal was a documented, working helper used by hand during exploration, and still cost a full 488s timed-out run because it was never added to the fixture every generated spec runs through. The failure reads like a hung click on whatever the spec touched first.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-002, 2026-09-21 — Hidden autocomplete option shadowed the created row
The option (`"SMITH,  JEFFREY ~ 1322 , Pos:CA"`) and the added row (`"SMITH,  JEFFREY ~ 1322 | COR | NA"`) share name and id, so `getByText` resolved to the hidden option first; only the row's pipe-separated position code told them apart.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-001, 2026-09-22 — OR selector recorded the wrong locator
The real id was `hotelKeyInput`; the OR selector matched on the `name` attribute, and `#HotelKey`, never observed on its own, was written down as if it had been.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-002, 2026-09-22 — Kendo k-nodata popup intercepted click()
An empty warm-up query opened a `div.k-nodata` popup over the crew-lookup field; a `click()` retry timed out at 120s ("k-nodata ... intercepts pointer events"). `focus()` fixed it immediately.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-002, 2026-09-22 — Kendo dropdown value is a code, not the label
A station field showed `"DFW | Dallas/ Ft. Worth"` but its input value was `"DFW"`.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-002, 2026-09-22 — Unscoped getByText hit a hidden tab
`getByText('Hotel Name', { exact: true })` resolved to a hidden `<th>` on an unrelated, hidden tab.
Rule: knowledge/org/locator-policy.md → When the app fights you

### US-CLC-003, 2026-09-20 — page.evaluate helper broke through the tsx/cjs interop
The failure (`__name` ReferenceError) looked like a broken locator and cost a wasted diagnostic sweep. The fact had been buried in `explore-harness.js`'s header, invisible to a bolt that never opens that file, which is why exploration-notes.md exists.
Rule: knowledge/org/exploration-notes.md

## knowledge/org/assertion-catalog.md and review-checklist.md

### US-CLC-002, 2026-09-21 — Pre-check response resolved before the real save
A submit's `ValidateOverlap` pre-check returned `200 []` at once, with the real `POST .../ManualEntry/Create` over 12s later. A test waiting on the first response, or on a fixed poll window sized for it, reported no confirmation though the save always succeeded.
Rule: knowledge/org/assertion-catalog.md → Strength rules

### US-CLC-002, 2026-09-21 — Native dialogs carried every result
Both the confirmation and every validation error arrived as native dialogs; without a handler registered up front, a test passes with the message unread.
Rule: knowledge/org/assertion-catalog.md → A native dialog is lost, silently, without a registered handler

### Earlier project on this kit — Regex never matched a multiline ag-Grid pager
A renderer putting each token on its own line (`1\nto\n1\nof\n1`) can never match a single-space regex, healthy or not. The target was right; the pattern couldn't match multiline content.
Rule: knowledge/org/assertion-catalog.md → `toHaveText` normalizes whitespace for a string, not for a regex

### US-CH-MENT-001, 2026-09-24 — Padding shifted with employee-id length
The fixed-width message's padding changed when the crew member under test went from a 4-digit to a 5-digit employee id.
Rule: knowledge/org/assertion-catalog.md → A fixed-width message field makes the surrounding whitespace data-dependent

### US-CLC-MISSINGCREWNAME-001, 2026-09-24 — Shared-environment data vanished; the guard caught it
A report window held 1,700 rows at planning time and was empty an hour later; the same query returned 50 rows then 27 minutes apart. The non-empty guard caught both.
Rule: knowledge/org/assertion-catalog.md → A test over existing data needs a guard that fails on empty

### US-CLC-MISSINGCREWNAME-001, 2026-09-24/25 — Red-by-design read as failure; "defects" not isolated
Four reports left red by owner decision were read as "the bolt failed". Their failures had been called product defects after only airline and month were varied; the next day an account-team tester on the same UAT loaded all four with a station and a hotel chosen. That does not prove the filters were the cause (data or build may have changed overnight), which is exactly why neither version should have been called a defect.
Rule: knowledge/org/assertion-catalog.md → A red test can be the correct result; review-checklist.md items 27, 29

### CrewHub exports, 2026-09-25 — Five sibling reports, five layouts
The five crew reports name the crew columns five different ways, only one has `Occupancy`, and a shared room shows as two IDs in one cell (`123456/12345`) or not at all. A check copied from the one report the bolt had seen would have failed on the other four with "column missing".
Rule: knowledge/org/assertion-catalog.md → Sibling screens do not share an output layout

### US-CLC-001 and US-CH-MENT-001, 2026-09-22 — Expected values from the wrong API or the wrong moment
Wrong API: a string copied from `innerText()` carries CSS `text-transform` and collapsed padding, while `toHaveText` compares raw textContent. Wrong moment: a dialog count (`toHaveLength(1)`) was right during exploration, but the app adds a conditional confirmation when the crew member already has an overlapping entry, a state exploration's own writes had created.
Rule: knowledge/org/assertion-catalog.md → An expected value is only as good as the state it was derived from

### US-CLC-002, 2026-09-22 — Only one submit per crew member per workspace
Transportation Manual Entry accepts one successful submit per crew member for the life of a workspace, so "unique per run" cannot be met by test design; a plain FAIL would misread a product limit as a test defect.
Rule: knowledge/org/review-checklist.md → item 9

### US-CLC-002, 2026-09-22 — A heal changed which element is asserted
Plain PASS would have hidden a real, if harmless, change; FAIL would have called a fix a weakening.
Rule: knowledge/org/review-checklist.md → item 21

### Earlier project on this kit — Password stored in an error-context snapshot
A seed failure's accessibility-snapshot error-context file recorded the sign-in form's password in plain text on disk. CrewHub's ASP.NET sign-in form has the same shape.
Rule: knowledge/org/review-checklist.md → item 24

### Earlier project on this kit — Unmatched selectOption picked "Create New ..."
An unmatched `selectOption` picked a "Create New ..." action, the dropdown's first entry, instead of a value.
Rule: knowledge/org/review-checklist.md → item 25

