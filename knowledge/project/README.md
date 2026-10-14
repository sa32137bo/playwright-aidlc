# Project Knowledge (deltas only)

`knowledge/org/` holds the organisation baseline — locator policy, assertion
catalog, review checklist, glossary. It is approved once and reused across
projects. **Do not copy it here.**

This folder is for what is different about *this* application. Add a file only
when the org baseline is wrong or insufficient for this codebase.

Typical contents:

- `locator-overrides.md` — this app's component library exposes roles oddly, and here is what to do about it
- `domain-glossary.md` — what "settlement", "CLC", "batch window" mean here
- `known-flaky-areas.md` — the dashboard chart animates for 2s; wait for the render-complete event
- `environment-notes.md` — staging resets nightly at 02:00 UTC; seeded accounts are recreated

Keep each file short. If something here would help every project, propose it as
a change to the org baseline instead of leaving it as a local exception.
