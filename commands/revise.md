---
description: The story changed — update the specs it made stale
argument-hint: <story-id> (e.g. CHK-42)
---

Revise bolt `$1` against its current story using the `e2e-revise` skill.

Run `npx pw-aidlc story-diff $1` first and report what it found. If nothing
moved, say so and stop — do not revise "just in case".

Read `bolts/$1/audit.md` before anything else. Gate 1 was approved against a
specific version of the story; the snapshot of that version is
`bolts/$1/story.snapshot.md`, and everything here is measured from it.

Then: classify each drifted criterion by tier → **stop at Gate 1-R** with the
drift report, the proposed delta and the test-case question in one round →
revise only the affected specs → run only those → Gate 2 → re-snapshot.

A reworded criterion is an assertion edit, not a re-plan: locators were verified
at the original Gate 1 and are in `plan.md`'s locator worksheet. Only a brand-new
criterion earns a browser session. If more than five criteria drifted, say this
is a re-plan and recommend `/bolt $1` instead.

Never delete a test for a retired criterion, never weaken an assertion to make a
revised spec pass, and never open a spec for a criterion that did not change.
Log every decision to `bolts/$1/audit.md` under `## Revisions`.
