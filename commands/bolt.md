---
description: Run a full AI-DLC testing bolt for a story
argument-hint: <story-id> (e.g. CHK-42)
---

Run a testing bolt for `$1` using the `e2e-bolt` skill.

Read `e2e.config.yml` first — the mode changes what is authoritative.

If `bolts/$1/intake.yml` does not exist, run `e2e-intake` to build it: resolve the story from `inputs/stories/$1.md` or Jira, load requirements and contracts, and ask me only about genuine gaps.

Then: context → plan → **stop at Gate 1** → generate → offer to run → heal → checklist → PR.

Gate 1 is a hard stop regardless of the autonomy setting. Log every question, decision and approval to `bolts/$1/audit.md`.
