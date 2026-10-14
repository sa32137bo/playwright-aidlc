# CLC QA — environment notes

Deltas from the org baseline for this application only.
CLC QA: https://crewhub-qa.taconnections.com/

Sources: bolt `US-CLC-001`, run "CLC_Automation" (2026-09-17) and run
"CLC_18_09" (2026-09-18).

- **Auth is CrewHub's own ASP.NET Identity form, not Okta and not SSO.**
  Signed out, `/` redirects to `/Identity/Account/Login` (Email
  Address/Password/"Log In", exact-matched — a separate "Log In SSO" button
  and dropdown are on the same screen but not used by the test account).
  Confirmed independently in both runs.

- **Sign-in is fast — measured ~7s**, versus the ~25s an Okta-style widget
  costs on other projects this kit has run against. `playwright.config.ts`'s
  `timeout`/`workers` values are still the old, more conservative numbers
  inherited from that other project and are flagged there as worth
  re-measuring for this app specifically.

- **Deep links work.** Navigating directly to a URL (e.g.
  `/AccountManagement/Dashboard`) re-renders the full page server-side, and
  the session and the global-airline selection both survive it. This is
  relied on directly — see `clc-known-flaky-areas.md`'s left-nav note for
  why clicking through the UI is avoided instead.

- **A cookie-consent dialog appears on every fresh authenticated page load**
  and intercepts the first click on anything underneath it until dismissed.
  `dismissCookieNotice()` in `clc.ts` handles it.

- **No delete affordance exists anywhere observed on Hotel Admin.** Test data
  created here is permanent — see `clc-known-flaky-areas.md`.

- **Knowledge Assistant grounding is deliberately OFF for this project** —
  not merely unconfigured. Two real attempts both failed to produce anything
  usable: a `403 "Requested project is not authorized for this grounding
  key"` (2026-09-17), then a `success: true, has_knowledge: false` whose own
  `retrieval.project_id` came back `mdui` — the wrong corpus entirely
  (2026-09-18). `KNOWLEDGE_ASSISTANT_URL`/`_API_KEY`/`_PROJECT_ID` are
  intentionally left unset in this project's provisioning (see
  `scripts/unpack.ps1`'s step 9a) rather than pointed at a corpus that
  doesn't exist for CLC yet. `e2e-intake` step 4a degrades to source + live-
  app grounding with no error either way — this is a deliberate scope
  decision, not something to "fix" by hunting for a working key.

- **UAT (`https://crewhub-uat.taconnections.com/`) is reachable with the same
  test account as QA**, and a bolt can target it by setting `BASE_URL` in
  `.env.local` — `playwright.config.ts` and every `clc.ts` helper follow it.
  Confirmed live (bolt `US-CLC-MISSINGCREWNAME-001`, 2026-09-24, app version
  2.5.2.20260924 on both). Leave `app.url` in `e2e.config.yml` alone unless the
  owner says otherwise; `pw-aidlc doctor` now warns when the two disagree and
  checks the `BASE_URL` host, which is the one the tests actually hit.
  **Same version does not mean same behaviour**: the Reporting filter panel
  starts collapsed on UAT and expanded on QA. Pick the environment the defect
  was reported on — a comment on LOD-76916 said QA "works as expected" while
  the customer was still seeing the bug on UAT, so a QA-green suite would have
  read as coverage it wasn't.
