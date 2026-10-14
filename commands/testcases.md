---
description: Write reviewable manual test cases from a story, and its requirements when there are any
argument-hint: <story-id> (e.g. CHK-42)
---

Write test cases for `$1` using the `e2e-testcases` skill.

Run `e2e-intake` first to resolve the story, requirements and contracts — but skip
its `app.url` and seed-test checks. This needs no running application, no source
code and no credentials, which is the point of it.

The story is the required input. If `inputs/requirements/` is empty, generate from
the acceptance criteria and say at the gate that the story was the whole of the
grounding — do not ask me for a BRD. When requirement documents are there, use
them to sharpen exact messages and boundaries.

If any `.docx` or `.pdf` in `inputs/` has no `.md` beside it, stop and tell me to
run `npx pw-aidlc ingest`. Do not transcribe a binary by hand.

Open only the `[IMAGE:]` placeholders whose heading is in this story's scope, and
say how many you opened and how many you skipped.

Output `test-cases/$1.md` in the format the skill specifies — it is exported to
Excel and CSV and imported back, so the shape is fixed.

**Never fill an execution column** (Actual Result, Status, Severity, Environment,
Browser, Post-conditions, Executed By, Execution Date, Defect ID). Those belong to
whoever runs the test.

Stop at the gate with the case count, the coverage of every acceptance criterion,
what you judged not automatable and why, and which documents and screenshots you
actually read.
