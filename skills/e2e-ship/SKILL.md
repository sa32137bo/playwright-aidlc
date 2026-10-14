---
name: e2e-ship
description: Commit generated test plans and Playwright specs to a branch and open a reviewable pull request with the plan diff, coverage table and review checklist in the body. Use when the user asks to commit, push, ship, or raise a PR for generated tests, or when the e2e-bolt workflow reaches its shipping step.
license: Proprietary
---

# Ship the Bolt

Turns a completed bolt into something a human can review in ten minutes.

## Preconditions

- Gate 1 approval recorded in the state file
- Suite runs; every test either passes or is an explicitly reported `fixme`
- Review checklist executed

If any is missing, stop and say which.

**A missing git remote, or no `gh` installed, blocks the PR — it does not
block committing.** Two real bolts skipped git entirely for this reason
("no git remote configured yet," "i dont have git for now") and it cost a
later session real diagnostic time: with no commit history, there was no way
to tell *when* or *by what* an already-approved spec file had changed —
a real anomaly (two lines silently commented out in an approved
`create-fleetnet-customer.spec.ts`) was found and flagged, but couldn't be
dated or attributed. If there's no remote, `git init` locally if needed and
still make the three commits below — a local, remote-less history is what
makes that class of drift diffable later. Only the PR step itself needs a
remote and `gh`; say so plainly and stop there if either is missing, rather
than skipping the commits too.

## Branch and commit

```bash
git checkout -b test/<ID>-<short-slug>
```

Three commits, in this order, so the diff reads as a story:

1. `test(<ID>): add app context and test plan` — `context/app-context.md`, `context/knowledge-assistant.md` (if e2e-intake step 4a wrote one), `bolts/<ID>/plan.md`, `bolts/<ID>/audit.md`, `bolts/<ID>/story.snapshot.md` and `bolts/<ID>/requirements.snapshot/` (the versions Gate 1 was approved against — without them a later `story-diff` has no baseline and every drift check on a fresh clone silently degrades)
2. `test(<ID>): generate Playwright specs` — `<paths.tests>/<ID>/`
3. `test(<ID>): heal generated specs` — only if healing happened

Commit the audit log and manifest with the first commit and update them in the last.

**If this is a revision** (`e2e-revise` produced it), the first commit also
carries `bolts/<ID>/revisions/rev-<N>.plan.md`, the message is
`test(<ID>): revise plan for story revision <N>`, and the snapshot committed is
the *refreshed* one — re-run `npx pw-aidlc story-diff <ID> --snapshot` before
committing, or the next drift check reports the same drift forever. Label the
PR `e2e-revision` alongside `e2e-generated`, and open its description with which
acceptance criteria moved: a reviewer needs to know an assertion changed because
the requirement changed, not because someone loosened it.

The moment the PR opens, append `[<ISO>] GATE 3 presented (PR #<N> opened)` to `audit.md`'s `## Approvals` section and set `gate3_presented_at` in `manifest.json` — this is Gate 3 being presented for human review, the same pairing `e2e-bolt` uses for Gates 1 and 2. The merge itself happens outside this session's visibility, so there is no matching `gate3_approved_at` to log.

**Never commit:** `.env.local`, `.env`, credentials, auth `storageState` files with real tokens, traces or videos, `test-results/`, `playwright-report/`, or any real customer data captured during exploration. Check before you stage — exploration sessions pick up tokens more often than people expect.

## PR body

```markdown
## Bolt <ID> — <intent>

**Autonomy:** <mode>  |  **Plan approved by:** <who, when>  |  **Playwright:** <version>

### Coverage
| Acceptance criterion | Scenario | Status |

### Scenarios
<N> scenarios, <N> smoke, <N> regression. <N> fixme.

### Discrepancies found (code vs live app)
| Code says | App does | File | Needs a decision from |

### Heals applied
<per heal: classification, what changed, assertions touched>

### Review checklist
| Check | Result |

### Not covered
| Behaviour | Why | Where it belongs |

---
🤖 Generated with Claude Code. Plans and specs require human review before merge.
```

Put the discrepancy table high in the body. It is usually the most valuable thing in the PR and it gets missed at the bottom.

Label the PR `e2e-generated`, or `test-heal` for a heal-only PR.

## Release visibility

`docs/traceability-matrix.md` should already be current — `e2e-bolt` refreshes
it right after generation and again after healing, before Gate 2, rather than
waiting for this step. Pull this bolt's coverage line from that existing file
into the PR body. Only re-run `npx pw-aidlc matrix` here if something changed
between Gate 2 approval and now.

## Push results to the Workbench

Not done here. It happens when Gate 2 is presented, if configured at all
(`e2e-bolt` § "Push results to the Workbench (optional)", details in
`e2e-bolt/workbench-push.md`), because many bolts stop at Gate 2 and never
reach a PR.

## Reviewer guidance

Add a comment telling the reviewer where to look, because the diff is long and the risk is concentrated:

> Review order: (1) the coverage table — is anything important missing; (2) the assertions — are they specific enough to catch a regression; (3) the locators — role or testid, nothing brittle; (4) the discrepancies — are any of these real bugs. The step-by-step code matters least.

## Never

- Never merge, never approve, never enable auto-merge.
- Never force-push over someone else's review.
- Never open a PR with failing tests and no explanation of each failure.
