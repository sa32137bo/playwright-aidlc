---
description: Bind a greenfield bolt's @pending specs to the live application
argument-hint: <story-id> (e.g. CHK-42)
---

Rebind bolt `$1` against the running application using the `e2e-rebind` skill.

Run `npx pw-aidlc rebind --bolt $1` first and report the inventory. Do not start
if it reports blockers — especially unset credentials, which do not error but
land you on a login screen where every locator you bind is the wrong one.

Read `bolts/$1/audit.md` before anything else. Gate 1 and Gate 2 are already
approved; the scenarios are settled and are not up for revision. The only open
question is whether the application matches them.

Then: explore through `tests/seed.spec.ts` → replace every `// UNVERIFIED`
locator with one observed live → drop `@pending` only from fully bound specs →
run → **stop at Gate R** with the per-test table.

A locator you cannot find is a finding, not a gap to fill in. Classify it as
renamed, missing or moved, and never substitute the nearest plausible element.
Log every binding decision to `bolts/$1/audit.md` under `## Rebind`.
