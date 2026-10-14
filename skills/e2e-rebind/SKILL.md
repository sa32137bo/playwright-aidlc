---
name: e2e-rebind
description: Bind already-generated greenfield specs to a live application - replace every UNVERIFIED locator with one observed in the real DOM, remove the @pending tags, run the tests and report what bound, what failed and what could not be found. Use when a greenfield bolt's application has since been built or become reachable, when the user says "we have the URL now", "the app is up", "bind the tests", "/rebind", or asks how to make @pending specs real.
license: Proprietary
---

# Rebind (greenfield → live)

A greenfield bolt produced a plan, specs and a locator worksheet, and every
locator in it was a statement of intent. This skill turns those intentions into
observed fact against a running application.

**You are not re-planning.** Gate 1 approved the coverage and Gate 2 approved the
specs. Both stand. What was never established is whether the application matches
them — and that is the only question here.

## Non-negotiables

1. **Never re-open an approved gate.** Read `bolts/<ID>/audit.md`. If Gate 1 is
   approved, the scenarios are settled. Do not re-litigate coverage.
2. **Never invent a locator — and now there is no excuse.** The app is in front of
   you. A locator you could not observe is a finding, not a gap to fill in.
3. **Never weaken an assertion to make a test pass.** A test that now fails
   against the real app is the most valuable output this skill produces.
4. **Never delete a scenario** because it is inconvenient to bind. Mark it, report
   it, leave the decision to a human.
5. **Log every binding decision** to `bolts/<ID>/audit.md` under `## Rebind`.

## Preconditions — check all of them, report every failure at once

```bash
npx pw-aidlc rebind --bolt <ID>
```

That prints the inventory and the blockers deterministically. Do not start until
it is clean:

| Check | Why it blocks |
|---|---|
| `app.url` set and reachable | there is nothing to observe |
| `project.mode` is `brownfield` | still `greenfield` means the config disagrees with what you are doing |
| `tests/seed.spec.ts` passes | every generated test inherits its shape; binding against a broken entry point binds nonsense |
| credentials resolve | `.env.local` placeholders produce a login screen, and you will bind locators for *that* |
| the bolt has generated specs | nothing to rebind |
| Gate 1 recorded in `audit.md` | if it is not, this is a bolt, not a rebind |

**The credential check matters more than it looks.** Unset `E2E_USER` /
`E2E_PASSWORD` do not error — they land you on a login page, where a diligent
agent will happily bind every locator on the wrong screen and report success.

## Sequence

```
preflight ─▶ explore ─▶ bind ─▶ run ─▶ [GATE R] ─▶ PR
             (live)   (per spec)      human
```

### 1. Explore through the seed test

Enter the application the way the tests will: run `tests/seed.spec.ts`, then
navigate to the surface this bolt covers. Use the
`playwright-test-generator` agent if `.claude/agents/` has it — it replays
scenarios in a real browser and derives locators from observed DOM, which is
exactly this job. Otherwise drive Playwright MCP directly.

Read `bolts/<ID>/plan.md` §"Locator worksheet" first. It lists every intent, and
often the traps: ambiguous buttons, uppercase labels that may be CSS
`text-transform`, repeated grid controls. Those traps were written by whoever
planned the bolt and they are usually right.

### 2. Bind, one spec at a time

For every `// UNVERIFIED` locator:

- observe the element live and replace the locator with what you actually see
- delete the `// UNVERIFIED` comment **only** when you have observed it
- respect `knowledge/org/locator-policy.md` — role and label first, `.nth()`
  banned, scope before you select
- if the element does not exist, **stop and record it** (see below)

When every locator in a spec is bound, remove that spec's `@pending` tag. A spec
with one unbound locator keeps its tag — partial binding is not binding.

### 3. Classify what you could not bind

This is the real output. Three kinds, and they mean different things:

| Kind | What it means | What to do |
|---|---|---|
| **Renamed** | the element exists, the label or role differs | bind to what is there, record the difference |
| **Missing** | nothing matching exists on that screen | the app diverged from the plan, or the feature is incomplete. `test.fixme()` with a one-line reason |
| **Moved** | it exists on a different screen or behind a different route | bind it, and flag that the plan's navigation was wrong |

Never resolve "missing" by finding the nearest plausible element. That is how a
test ends up passing against the wrong control.

### 4. Run

```bash
npx pw-aidlc results --bolt <ID>
```

Now failures mean something for the first time. Classify each one:

- **the app is wrong** — it contradicts an approved acceptance criterion. A defect.
  Report it; do not change the test.
- **the plan was wrong** — the criterion was misunderstood at Gate 1. Say so
  plainly; this is what Gate R exists to catch.
- **the test is wrong** — a genuine binding or timing error. Fix it, or hand it to
  `e2e-heal`, which is bounded to three attempts.

Distinguishing the first two from the third is the judgement this skill is for.
Getting it wrong in the direction of "the test is wrong" silently erases defects.

### GATE R — report before you ship

Present one table, one row per test:

```
Rebind — US-CLC-CUST-001                app: https://crewhub-qa...  commit a3f21c9

  Test                                   Locators  Bound  Result
  navigation / open the wizard              6        6     pass
  general validation / mandatory fields     9        8     FIXME  (1 missing)
  create and retrieve                      14       14     FAIL   (see D-14)

  Bound:            28 of 29 locators across 3 specs
  Still @pending:   1 spec (one locator missing)
  New findings:     2 renamed, 1 missing, 1 app defect
```

Then the findings in full, each saying which of the three kinds it is. **Stop and
wait.** A rebind changes what the suite asserts about a real system; that
deserves a human read even though Gates 1 and 2 already passed.

### 5. Ship

`e2e-ship` on approval. Then `e2e-matrix`, because coverage has changed meaning:
rows that were planned-only are now executed.

## Update the manifest

Rebinding invalidates the provenance the bolt was generated under. Record:

```json
{
  "rebound_at": "<ISO>",
  "rebound_against": "<app url>",
  "app_commit": "<sha at rebind time>",
  "locators_bound": 28,
  "locators_unbound": 1,
  "gate_r_approved_by": "<name>"
}
```

Without it, "these tests were verified against the app" has no date and no build
attached, which is the same as not being verified.

## Partial rebinds are normal

Binding half a bolt and reporting the rest is a good outcome. A rebind that
claims every locator bound on a large bolt, first attempt, with no findings, is
more likely to be a careless one than a lucky one — check it before believing it.
