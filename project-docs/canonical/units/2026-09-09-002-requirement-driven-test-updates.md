# Requirement-Driven Test Updates

Scoped from the 9/15 MDUI/GHC target: "test script/test case updates based on
changing requirements." Checked directly before writing this unit that nothing
in the kit already does this — `pw-aidlc impact` answers "what did a *code*
change break" (it works off `// covers:` headers and a source diff since a
commit), not "the *story* changed, what's now stale." `e2e-plan`'s
reconciliation mode handles pre-written test cases at first-bolt-authoring
time, not a shipped bolt whose story was edited afterward. `e2e-rebind`
handles app/locator drift, not requirement text drift. This is a real,
confirmed gap, not an assumption.

**Design stance: detect and surface, never silently regenerate.** Every
existing gate in this kit exists because generated output must be reviewed
before it's trusted (`e2e-bolt`'s non-negotiable #1: never skip Gate 1). A
requirement changing is not an exception to that — it's exactly the kind of
event that should produce a new, scoped Gate 1 for the delta, not an automatic
rewrite of already-approved specs.

## Groundwork confirmed before writing this unit

- **The diffing mechanism already exists — for the wrong input.** `impact.mjs`
  already does "diff since a git ref, resolve to affected specs via a header"
  for application source under `source.path`. The same shape applies directly
  to `inputs/stories/` and `inputs/requirements/` — a git diff since the commit
  a bolt's Gate 1 was approved against, rather than since the commit
  `app-context` was last built. This is a reuse story, not new design from
  scratch.
- **Coverage traceability already exists in two forms**, and both are exactly
  what's needed to answer "what does this changed requirement affect":
  `docs/traceability-matrix.md`'s AC→scenario table for generated bolts, and
  each `test-cases/<ID>.md`'s own per-case AC reference for hand-written
  sheets. Neither needs to be rebuilt — this unit joins a requirement diff
  against them, it doesn't reinvent them.
- **`manifest.json`'s `config_hash`/`gate1_approved_at` (the latter just added
  in `2026-09-09-001`'s companion timestamp fix) already anchors "what state
  was this approved against"** — the missing piece is anchoring the *story
  file's own content*, not just the config, at the moment of approval.

---

## Implementation notes — built 2026-09-11

RU-1 through RU-6 are built. Three deliberate deviations from the design above,
each because building it surfaced something the design could not have known:

1. **`/revise <ID>`, not `/recheck <ID>`** (RU-4). The scope grew past detection
   to actually updating the specs, and `/recheck` names only the first half.
   `/revise` also matches the kit's other one-word verbs.

2. **A literal snapshot at `bolts/<ID>/story.snapshot.md`, not a hash** (RU-1).
   A hash proves *that* a story changed; only the old text says *which
   criterion* changed and how, which is the entire output of RU-2. A copy also
   works with no commits and no remote — the state a real audit in this repo
   already records, and the normal state on a client machine. `story_ref` is
   still written when git can supply one, as a second rung.

3. **AC→scenario is read from `plan.md`, not `docs/traceability-matrix.md`**
   (RU-3). That column does not exist in the matrix — `report.mjs` emits
   `Bolt | Planned scenario | Test | Matched by | Last run`. The AC→scenario
   join lives only in `plan.md`'s coverage table. Adding an AC column to the
   matrix remains available as a separate change.

Two things the design did not anticipate, both found by running it:

- **A degraded (plan-table) baseline cannot support a rewording claim.** The
  planner has already condensed each criterion, so comparing a summary against
  its source reports a difference every time — the first run against a real
  fixture reported 5 of 5 criteria moved, all of them false. Rewordings from
  that rung are now reported as `uncertain` rather than `reworded`, and an
  added/retired pair at the same position is reconciled to one `uncertain` row.
  Added and retired criteria from a real snapshot remain exact.

- **A new criterion must never be matched by id.** The first implementation fell
  back to id-matching when text matching failed, which bound a brand-new
  criterion to whatever used to sit at that position and reported it as already
  covered. That is the one false negative this unit exists to prevent, so the
  id fallback was removed entirely.

RU-7 is partly done: the full loop was exercised end to end against a
constructed revision of the `CHK-42` example (a criterion reworded, one added,
one retired, one renumbered), and the affected-coverage list was checked by hand
against what a reader of both versions would conclude. **That was a deliberate
edit, not a real one** — a real MDUI story revision has not yet run through it,
which is what closing RU-7 still requires.

Covered by `tests/test_story_diff.mjs` (23 checks), wired into `npm test`.

## Epic: Detect Requirement Drift

---

### RU-1: Snapshot the story/requirement content a bolt's Gate 1 was approved against

**Type:** backend
**Status:** done
**Epic:** Detect Requirement Drift

**As a** bolt author,
**I want** `bolts/<ID>/manifest.json` to record the git commit (or content
hash, if the story isn't committed yet) of `inputs/stories/<ID>.md` and any
`inputs/requirements/` files the plan actually drew from, at the moment Gate 1
is approved,
**so that** a later drift check has a real baseline to diff against — without
this, "has the story changed since we approved this" has no fixed point of
comparison.

**Acceptance Criteria:**
- [ ] `manifest.json` gains `story_ref` (commit SHA or content hash) and
      `requirements_refs` (array, same shape), written at Gate 1 approval —
      alongside the `gate1_approved_at` field the timestamp fix already added.
- [ ] If the story file isn't under version control at approval time (a real,
      already-seen case — one real audit records "no commits, no remote" for
      the whole project), fall back to a content hash rather than leaving the
      field silently absent.
- [ ] No behavior change to Gate 1 itself — this is capture only, read by RU-2.

---

### RU-2: Diff a story/requirement doc against its last-approved snapshot

**Type:** tool
**Status:** done
**Epic:** Detect Requirement Drift

**As a** QA lead,
**I want** a command (`pw-aidlc requirement-diff <ID>` or similar, mirroring
`pw-aidlc impact --since`) that compares `inputs/stories/<ID>.md` and its
requirements as they exist now against RU-1's recorded snapshot, and reports
which acceptance criteria were added, removed, or reworded,
**so that** "the requirement changed" is a specific, reviewable diff — not a
vague "the file's mtime is newer."

**Acceptance Criteria:**
- [ ] Reuses `impact.mjs`'s git-diff-since-a-ref approach directly, pointed at
      `inputs/stories/`/`inputs/requirements/` instead of `source.path` — not
      a second, parallel diffing implementation.
- [ ] Output is per-acceptance-criterion, not per-file: an AC whose wording
      changed is reported distinctly from one that was added or removed,
      using the story's existing AC numbering (`AC-1`, `AC-2`, …) as the join
      key.
- [ ] A story with no prior RU-1 snapshot (never been through a Gate-1-approved
      bolt) reports that plainly rather than erroring — there's nothing to
      diff against yet.
- [ ] Verified against a real edit to an MDUI story or requirement doc — if no
      real edit exists yet in the available inputs, this is verified with a
      deliberately introduced test edit, stated as such rather than presented
      as a real-world case.

---

## Epic: Trace Drift to Existing Coverage

---

### RU-3: Resolve changed acceptance criteria to the tests and cases that cover them

**Type:** tool
**Status:** done
**Epic:** Trace Drift to Existing Coverage

**As a** QA lead,
**I want** RU-2's list of changed acceptance criteria joined against
`docs/traceability-matrix.md` (for generated specs) and every `test-cases/<ID>.md`
sheet referencing the same story (for hand-written cases),
**so that** "AC-4 was reworded" becomes "these 2 specs and 3 manual test cases
may now be stale" — a concrete, actionable list, not just a paragraph of
changed prose.

**Acceptance Criteria:**
- [ ] For generated coverage: reads the existing AC→scenario column in
      `docs/traceability-matrix.md` directly — the same join `pw-aidlc matrix`
      already computes, not a second independent matcher.
- [ ] For hand-written coverage: reads each `test-cases/<ID>.md`'s own
      AC-reference column, the same one `e2e-testcases` already writes and
      `e2e-plan`'s reconciliation mode already reads.
- [ ] An AC with **no** existing coverage at all (new in this revision) is
      reported as "new, uncovered" rather than silently omitted — this is
      exactly the gap a fresh `/bolt` or `/testcases` run should be pointed at.
- [ ] An AC that was **removed** flags its covering test(s) as "covers a
      retired criterion — confirm before deleting," never auto-deleted.

---

## Epic: Human-Gated Update Path

---

### RU-4: Present drift as a reconciliation report before touching anything

**Type:** ux
**Status:** done
**Epic:** Human-Gated Update Path

**As a** bolt owner,
**I want** RU-3's affected-coverage list presented in the same reconciliation
format `e2e-plan` already uses for pre-written test cases ("what changed, what
it affects, what's newly uncovered") — as a real stop, not a background diff,
**so that** requirement drift gets exactly the same "revise, re-present, only
explicit approval moves forward" treatment Gate 1 already gives a fresh plan.

**Acceptance Criteria:**
- [ ] Triggered explicitly — via `/bolt <ID>` detecting drift on resume (per
      `e2e-bolt`'s existing "read audit.md, continue from the last completed
      step" resuming logic) or a standalone `/recheck <ID>` command — not a
      background watcher silently flagging things unprompted.
- [ ] Report format mirrors `e2e-plan`'s existing reconciliation style: leads
      with what needs attention (changed/new/retired ACs and their affected
      tests), not a wall of unchanged content.
- [ ] This is a real stop: nothing is regenerated, edited, or re-approved by
      this story alone. It ends at "here's what changed and what it affects" —
      RU-5 is the separate, explicit next step.
- [ ] Logged to `audit.md` the same way every other decision point is — which
      ACs drifted, what was found affected, and (once RU-5 acts) what the
      bolt owner decided to do about it.

---

### RU-5: Re-plan only the affected acceptance criteria, through a normal Gate 1

**Type:** backend
**Status:** done
**Epic:** Human-Gated Update Path

**As a** bolt owner who's approved RU-4's report,
**I want** `e2e-plan` re-run scoped to just the changed/new acceptance
criteria — producing a normal plan and a normal Gate 1 for that delta — while
specs/cases for unaffected ACs are left completely untouched,
**so that** updating a bolt for a requirement change costs proportional to what
changed, not a full re-plan of the whole story, and carries exactly the same
review rigor as authoring it the first time.

**Acceptance Criteria:**
- [ ] Scopes `e2e-plan` to the affected ACs only — reuses the existing
      `intake.yml` `acceptance_criteria` scoping mechanism the kit already has
      for narrow bolts (the same field `US-MDUI-DRV-002`'s real intake used to
      scope to one AC).
- [ ] A brand-new Gate 1 is presented for this delta — never silent, never
      auto-approved because "it's just an update." Same non-negotiable as a
      fresh bolt.
- [ ] On approval, generation/heal/Gate 2 proceed exactly as a normal bolt
      would, touching only the files RU-3 identified as affected — an
      unaffected spec file is not opened, let alone regenerated.
- [ ] RU-1's snapshot is refreshed for this bolt once the delta ships, so the
      next drift check compares against the current approved state, not the
      original one.

---

### RU-6: Extend the same drift check to hand-written test-case sheets

**Type:** ux
**Status:** done
**Epic:** Human-Gated Update Path

**As a** manual tester maintaining `test-cases/<ID>.md`,
**I want** the same "this story changed since these cases were written" flag
`e2e-testcases` can surface, independent of whether the story ever went
through a full `/bolt` run,
**so that** a project using `/testcases` without automation (a real, named use
case in the kit's own docs — "the one thing the kit can produce when there is
no environment to test against") gets the same protection against silently
stale coverage.

**Acceptance Criteria:**
- [ ] Reuses RU-1's snapshot/RU-2's diff mechanism against whichever ref
      `/testcases` last used to write `test-cases/<ID>.md` — a case sheet has
      no Gate 1 of its own, so the snapshot point is "last time `/testcases`
      ran for this ID," not a gate.
- [ ] Report format matches RU-4's, scoped to manual cases only when no
      generated bolt exists for the story.
- [ ] `/testcases` itself, run again on a drifted story, surfaces the
      reconciliation report before rewriting the sheet — same "revise,
      re-present" discipline, just without a Gate 1 to attach it to.

---

## Epic: Validate

---

### RU-7: Run the full loop against a real story revision

**Type:** reference
**Status:** in progress — verified against a constructed revision; a real one still pending
**Epic:** Validate

**As a** QA lead deciding whether this unit works,
**I want** RU-1 through RU-6 exercised end to end against a real MDUI story
that changes after a bolt has already shipped — a real edit if one exists in
the available inputs by the time this is built, a deliberate one otherwise,
stated honestly either way,
**so that** "done" means a real drift was detected, traced, presented, and
resolved through a real (possibly newly-created) Gate 1 — not that the pieces
exist in isolation.

**Acceptance Criteria:**
- [ ] The affected-coverage list RU-3 produces is checked by hand against what
      a person reading both story versions would independently conclude is
      affected — false negatives (missed real impact) are the failure mode
      that matters most here, more than false positives.
- [ ] The full path is exercised at least once for a generated bolt (RU-4→RU-5)
      and at least once for a hand-written test-case sheet with no bolt
      (RU-6).
- [ ] Any story in this unit found to be unnecessary once real usage is seen
      (e.g. RU-6 turning out redundant with RU-4/RU-5 in practice) is
      `descoped` here with the reason recorded, not silently dropped.

---

## Closing this unit

- [ ] Every story above is `done`, `descoped`, or `parked`.
- [ ] RU-7 has actually run against a real or deliberately-simulated story
      revision — a detector nobody has triggered has not demonstrated anything.
- [ ] `README.md` (or the kit's own top-level docs) documents that a changed
      requirement is now a detectable, surfaced event, not a silent gap.
- [ ] Rename this unit with the `[closed]-` prefix only once the above is true.
