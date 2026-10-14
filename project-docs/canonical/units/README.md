# Units

Each file in this directory represents one unit of catalog work. A unit maps to a bounded problem area and contains one or more epics and their stories.

This convention is new to `playwright-aidlc` as of this unit — adopted from the same pattern already used in `connected-ai-dlc-tlc` for tracking bounded, multi-epic work with real open questions, rather than a flat backlog.

## Naming convention

```
[closed|blocked-]YYYY-MM-DD-NNN-short-name.md
```

- `[closed]-` / `[blocked]-` — status marker prefix, **only present when it applies**. An open/in-progress unit's filename starts directly with the date — no marker, no placeholder. The prefix goes on the *filename*, not the in-file title, specifically so it's visible immediately in a directory listing without opening the file.
- `YYYY-MM-DD` — date the unit was created
- `NNN` — three-digit sequence number within that date (001, 002, ...)
- `short-name` — kebab-case description of the unit

## Status markers

- **`[closed]`** — every remaining story is `done`, `descoped`, or `parked` — nothing in the unit needs attention right now.
- **`[blocked]`** — the unit's own core work cannot proceed *at all* right now, not just one story within it.
- Individual stories keep their own `**Status:**` field regardless — the filename marker rolls up the unit as a whole; it doesn't replace story-level status.

## Story and acceptance-criteria status

Story-level `**Status:**` is one of: `proposed | in-progress | done | descoped | parked | blocked`.

- **`descoped`** — deliberately decided out of scope, not being pursued.
- **`parked`** — deliberately set aside for now, usually waiting on an external dependency.

## Unit file template

```markdown
# [Unit title]

[One or two sentences describing the scope and goal of this unit.]

---

## Epic: [Epic name]

[Optional: one paragraph describing the epic and its motivation.]

---

### [ABBREV-N]: [Story title]

**Type:** agent | tool | ux | backend | reference
**Status:** proposed | in-progress | done | descoped | parked | blocked
**Epic:** [Epic name]

**As a** [role],
**I want** [capability],
**so that** [benefit].

**Acceptance Criteria:**
- [ ] ...
- [ ] ...

**Notes:**
- [Any technical context, constraints, or open questions]

---
```
