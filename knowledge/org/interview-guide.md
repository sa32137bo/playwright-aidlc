# Interview Guide

How the kit asks a human for the few things it genuinely cannot work out.

The person answering is usually a **tester**, not the developer who wrote the
feature. They know the product and what users do, but maybe not what a feature
flag is, which route a screen lives at, or what the repository is called. Ask
them something they cannot answer and you get a guess, which is worse than a
default.

Edit this file to match how your teams talk. The skills read it, so changing
wording needs no skill edit.

---

## The rules

**1. One round. Five questions maximum.**
If you need a sixth question, you are asking things you could have inferred.

**2. Every question is closed-form.**
Offer 2–4 concrete options built from what was actually found — routes from the
scan, roles from config, flags from the flag list. Never ask an open question
like "which routes are in scope?".

**3. Mark a recommended default.**
Always offer a safe answer that is right often enough to be the default, and
label it with the reason. Pressing Enter is a valid way to run a bolt.

**4. Say what happens if the answer is wrong.**
One line, in terms of the product, not the pipeline. "The tests will check a
screen your users don't see" — not "the plan will be misscoped".

**5. "Not sure" is always the last option, and never blocks.**
It selects the recommended default. It is then written to `audit.md` as an
assumption and shown at Gate 1 under *Assumptions*, so the person reviewing the
plan can catch what the person answering could not.

**6. No jargon without a gloss.**
If a term has to appear, explain it in the same breath, so nobody has to leave
the conversation to look it up.

---

## Vocabulary

| Don't say | Say |
|---|---|
| feature flag | a setting that changes how the screen behaves |
| route | page or screen, given by what the user sees in the address bar |
| role / RBAC | the kind of user — for example an admin versus a normal customer |
| locator / selector | how the test finds a button or field on the page |
| assertion | what the test checks |
| fixture / seed data | the account or records the test needs to already exist |
| brownfield / greenfield | the app already exists / the app isn't built yet |
| discrepancy | the code and the live screen disagree |
| flake | a test that passes sometimes and fails sometimes for no real reason |
| acceptance criterion | one thing the story says must be true |
| bolt | one story's worth of testing work |

---

## The question bank

Only ask a question if the answer is genuinely missing. Each entry gives the
trigger, the phrasing, and where the default comes from.

### Q1 — Scope

*Ask when the story touches more than one screen and does not say which matter.*

> The story mentions more than one screen. Which should these tests cover?
>
> 1. **Checkout only** — where the change actually is *(recommended)*
> 2. Checkout and the cart page before it
> 3. The whole purchase journey, from browsing to confirmation
> 4. Not sure — use your recommendation
>
> *Covering more than needed makes the tests slower and more likely to break for
> reasons unrelated to this story.*

Options are built from the routes the scan found. Default is the narrowest set
that still covers every acceptance criterion.

### Q2 — Kind of user

*Ask when config lists more than one role and the story does not name one.*

> Who is doing this? The screen behaves differently depending on the kind of
> account signed in.
>
> 1. **A signed-in customer** *(recommended — the story describes a saved address)*
> 2. A guest who has not signed in
> 3. Both, as separate tests
> 4. Not sure — use your recommendation

### Q3 — Settings that change behaviour

*Ask only when the scan found a flag used by code in scope.*

> The checkout screen behaves differently depending on a setting called
> `new_checkout`. Which should the tests assume?
>
> 1. **On — the new checkout** *(recommended: it is the default in the code)*
> 2. Off — the old checkout
> 3. Both
> 4. Not sure — use your recommendation
>
> *If this is wrong, the tests will exercise a screen your users don't see.*

### Q4 — Data the test needs

*Ask when a scenario needs records that may not exist in the test environment.*

> These tests need a customer who already has a saved address. In your test
> environment, is there one?
>
> 1. **Yes — the tests can sign in and use it** *(recommended)*
> 2. No — the tests should create one first, then clean it up
> 3. I don't know, and I can find out
> 4. Not sure — use your recommendation
>
> *If the account isn't there, the tests fail for a setup reason rather than a
> real problem, which wastes the first run.*

**Variant for screens that only read data** (reports, searches, bug re-tests).
Ask once per screen, with the ticket's own values as the recommended option
when it has them:

> The Room Cancelation report needs a station, a hotel and dates that will
> show at least one **shared-room** booking, or the test can't tell whether
> the crew-name bug is fixed. Which should it use?
>
> 1. **The values from the ticket's screenshot: CRK, hotel 4595, 9/1–9/4**
>    *(recommended: that's where the bug was reported)*
> 2. I'll give you values I know work
> 3. Ask someone on the account team, and I'll wait for the answer
> 4. Not sure — use your recommendation
>
> *If the dates don't include a shared room, the test can only show the report
> loads. It can't tell you whether the bug is fixed.*

### Q5 — What is deliberately out

*Ask when the story implies work the tests should not cover.*

> Is there anything here you specifically do **not** want covered yet?
>
> 1. **Nothing — cover everything in the story** *(recommended)*
> 2. Leave out the payment step; it hits a real provider
> 3. Leave out anything needing an admin account
> 4. Not sure — use your recommendation

---

## When something cannot be answered

If the honest answer is "nobody here knows", that is a finding, not a failure.
Record it as an open question in the plan, pick the safest default, proceed, and
raise it at Gate 1. Do not stall waiting for certainty: a plan with a labelled
assumption is reviewable; a bolt that never ran is not.
