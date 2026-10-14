---
name: e2e-matrix
description: Generate or refresh the traceability matrix showing story to scenario to test to last run result, plus coverage gaps, for release visibility. Use when the user asks about test coverage, release readiness, what is tested, which stories have tests, traceability, or a status report for a release or QA sign-off.
license: Proprietary
---

# Traceability Matrix (Release Visibility)

Answers the question a test manager actually asks: *for this release, what is covered, what passed, and what is missing?*

## Generate

```bash
npx pw-aidlc matrix
```

Reads every `bolts/*/plan.md`, the generated specs, and the last run in `results/latest.json`. Writes `docs/traceability-matrix.md`.

Run it after shipping a bolt and before any release conversation. If `results/latest.json` is missing or stale, run `npx pw-aidlc results` first — a matrix with no run data shows coverage but not health.

## Reading it honestly

The matrix matches plan scenarios to tests by **title similarity**. That is a heuristic, not a guarantee:

- A scenario listed as a gap may exist under a different test name. Check before reporting it as missing coverage.
- A matched row proves a test exists with a similar name. It does not prove the test asserts anything meaningful — only Gate 2 review does that.

Say this when you present the matrix. A coverage number offered without that caveat is the kind of metric that gets believed and then quietly becomes false.

## What to add on top

The generated file is data. When the user wants a release view, add judgement the script cannot:

- Scenarios marked `fixme` and **why** — pull the reason from the plan's discrepancy section
- Bolts where Gate 1 raised discrepancies that are still unresolved
- Areas with no bolt at all — check `inputs/stories/` against the bolts that exist
- Tests that have been healed repeatedly, from the audit logs; a test healed three times is telling you something about the app, not the test

## What this is not

It is not a quality measure. Every planned scenario having a passing test says nothing about whether the plan covered the right things. Coverage of a plan is not coverage of the product.
