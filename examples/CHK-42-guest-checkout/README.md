# Worked Example — CHK-42 Guest Checkout

Illustrative output from one bolt against the example intake at
`testing/bolts/EXAMPLE-101.yml`. Reference material for reviewers — not runnable
(there is no app behind it).

| File | Stage | What to look at |
|---|---|---|
| `specs-CHK-42.md` | Gate 1 | Coverage table, the **Discrepancies** section, and what was deliberately excluded |
| `tests/guest-checkout.spec.ts` | Generate | Role-based locators, `waitForResponse` instead of sleeps, pattern assertion on the dynamic order number |
| `tests/postcode-validation.spec.ts` | Generate | Exact messages from source, submission proven blocked, mocked 500/409, an honest `fixme` for the blocked rule |
| `heal-report.md` | Heal | Three failures, three classifications — one is a product bug and is **not** patched |

## The three things worth noticing

**One acceptance criterion became three scenarios.** The story said "an invalid
postcode". The source had three rules with three different messages. Live
exploration alone would have found one of them.

**A discrepancy blocked a scenario rather than being guessed at.** `validation.ts`
caps postcodes at 12 characters; the input sets `maxlength=10`. The plan surfaces
it and the spec ships a `fixme` with the reason, instead of a test asserting
whichever value the agent preferred.

**The heal report refuses to fix one failure.** The empty-postcode test failed
because the app now POSTs before validating. The error message still rendered, so
a healer looking only at visible symptoms would have called it fine. The assertion
that no request fired is what caught it.
