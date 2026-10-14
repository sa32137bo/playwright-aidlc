---
description: Diagnose and repair failing tests
argument-hint: "[test name or file] (optional — omit to triage everything)"
---

Use the `e2e-heal` skill on `$ARGUMENTS`.

With no argument: run `npx pw-aidlc results`, then list every failure with its classification — product bug / test defect / environment / flake — and ask me which to repair. Do not start repairing on your own.

Classify before touching any code. Product bugs are reported, never patched away. Assertions are never modified by a heal.
