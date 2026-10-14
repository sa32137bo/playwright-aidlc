# CLC Framework

A reusable Playwright helper library for CLC, deployed into every new CLC
workspace by `scripts/unpack.ps1`.

## What's in this folder

| Source | Deployed as | What it's for |
|---|---|---|
| `support/clc.ts` | `tests/support/clc.ts` | Sign-in (environment-independent — works against QA or UAT via `BASE_URL`), Kendo dropdown handling, the global-airline switch, Account Management/Hotel Admin, Transportation and Operations Manual Entry, the Reporting module (`/Reports/Report`), and unique-data generation — used at runtime by generated specs, and callable during live exploration too. |
| `support/test.ts` | `tests/support/test.ts` | A drop-in `test`/`expect` that signs in automatically — same `async ({ page }) => {...}` shape, zero syntax change, `page` is already authenticated. |
| `support/fixtures.ts` | `tests/support/fixtures.ts` | Named, dated constants for known-good environment data, including the Reporting module's `REPORT_SLICE_*` test-data slices, which specs import by name. See the file's own header for the bar an entry has to clear. |
| `support/xlsx.ts` | `tests/support/xlsx.ts` | Dependency-free `.xlsx` reader (Node's own `zlib`), enough to assert cell text in a downloaded report. Added for the Reporting module's "Export to Excel" (bolt `US-CLC-MISSINGCREWNAME-001`). |
| `explore-harness.js` | `tests/support/explore-harness.js` | Plain CommonJS boilerplate (`.env.local` loading, token redaction, browser launch, a snapshot-dump writer, a pagination checker) for throwaway `.explore/*.js` scripts. |
| `explore-batch-example.js` | not deployed — copy into `.explore/` by hand when starting a pass | A worked template: sign in once, then run several related exploration steps in that one session, instead of one script (and one sign-in) per step. |

## Why this exists

The first real bolt against CrewHub (`US-CLC-001`, "CLC_Automation" run,
2026-09-17) had to derive all of this from zero: CrewHub's own ASP.NET
Identity sign-in, its Kendo dropdown quirks, the Hotel Admin form's id-based
locators. A second bolt the very next day ("CLC_18_09", 2026-09-18) started
from a workspace that had been *renamed* for CLC but not yet re-grounded, and
paid a real, measured cost for it — re-deriving the same global-airline
default, the same Hotel Admin form-scoping requirement, from scratch.

This framework exists to stop paying that cost more than once per fact. See
`playwright-aidlc/project-docs/canonical/units/2026-09-09-001-bolt-execution-reliability.md`'s
BR-4 for the fuller reasoning (written against an earlier project this kit was
originally built for, but the argument is app-agnostic).

## What's in it, and how sure we are of it

`support/clc.ts` is not invented — every locator and interaction pattern was
either copied verbatim from bolt US-CLC-001's own live-verified,
all-green-suite `crewhub.ts`, or added from a second bolt's independently
live-confirmed exploration finding (the duplicate `id="maggFax"` checkboxes,
the "Minutes from Station" label/field mismatch, the collapsed left-nav's
empty accessible names). Provenance is cited per section or per comment. This
is the same "never invent a locator" discipline this kit holds every bolt to,
applied to building the kit itself. `support/test.ts` and
`explore-harness.js` are plain wiring/boilerplate around already-verified
code, not new locators.

One thing none of this can do: re-verify a locator or a data fact live, since
maintaining it happens with no access to the running application. A locator
here can go stale exactly the way a generated spec's can. Treat this file the
same way a bolt already treats `knowledge/project/*` — the next bolt that
touches a screen this covers should confirm it still holds and update the
file if not, not trust it forever.

**Known open question, not yet resolved live**: whether CrewHub's session
survives a restored `storageState` the way it survives a server-rendered deep
link. Neither source bolt tested it — both signed in per test, which is this
kit's own baseline convention regardless of the answer. See
`playwright.config.ts`'s own comment on why `storageState` stays off either
way.

## How this grows

This file is meant to be extended, not treated as finished. When a bolt
discovers something new and genuinely reusable — not specific to that one
bolt's own scenario — add it here, in `playwright-aidlc`, not only in the
deployed workspace's own copy. `scripts/unpack.ps1`'s own header note already
applies: editing a deployed workspace's copy does not flow back here
automatically. If a bolt's own extension is worth keeping for every future
workspace, bring the change back to this file by hand (or ask whoever
maintains `playwright-aidlc` to).

## Deployment

Copied by `scripts/unpack.ps1`'s Step 3 overlay, alongside `e2e.config.yml`,
`playwright.config.ts`, `.mcp.json`, and `knowledge/project/*` — the same
"current, real findings, refreshed as they come in" treatment those already
get. See that script for the exact copy steps. `tsx` is listed in
`clc.package.json`'s devDependencies for `explore-harness.js`'s documented
`require('tsx/cjs')` interop path, which lets a plain CommonJS `.explore/*.js`
script call a real exported function from `clc.ts` instead of retyping it.
**Exercised against a real live CLC app** (bolt `US-CLC-003`, 2026-09-20, its
heal-bound diagnostic sweep) — a plain navigation helper called through it
worked correctly. One real limitation was found the same run: a helper built
on `page.evaluate` (e.g. `altListHotelKeys()`) cannot be called this way — see
`knowledge/org/exploration-notes.md` and `explore-harness.js`'s own
bottom-of-file note for why. Re-derive that shape of helper directly in the
exploration script instead; everything else in `clc.ts` is unaffected.

`explore-batch-example.js`, alongside `explore-harness.js` in this folder, is
a worked template for batching exploration steps into one sign-in instead of
one script per step — copy it into `.explore/` and edit rather than starting
a new pass from a blank file.

`knowledge/project/clc-locator-overrides.md`'s "Reusable framework already
built for this project" section is what tells a bolt this exists and to
check it — that file is what actually gets read during intake/planning, this
README is for whoever maintains the framework itself.
