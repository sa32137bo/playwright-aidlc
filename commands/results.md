---
description: Run the test suite and summarise the results
argument-hint: "[--grep @smoke] [--bolt CHK-42]"
---

Run `npx pw-aidlc results $ARGUMENTS`.

Report pass / fail / skipped counts, then list each failure with its file and first error line. Do not start fixing anything — offer `/heal`, which classifies before repairing.

If the mode is greenfield, remind me that failures are expected until the feature ships.
