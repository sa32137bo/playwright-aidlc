# Sample Inputs

Copy these into a scaffolded project to try the kit before you have real inputs:

```bash
cp examples/sample-inputs/CHK-42.md        <project>/inputs/stories/
cp examples/sample-inputs/BRD-checkout.md  <project>/inputs/requirements/
```

Then `/bolt CHK-42` in Claude Code.

They are deliberately realistic in one specific way: **the story and the BRD do
not fully agree, and neither fully matches what a typical implementation does.**

- The story says "an invalid postcode" (one thing). The BRD describes three
  distinct rules (4.2.1–4.2.3). A good plan produces three scenarios, not one.
- BRD 4.5.1 says an unknown email shows nothing *on purpose*. A plan that flags
  the missing error message as a defect has not read the requirements.
- BRD 4.2.3 refers to "the carrier limit" without a number — that is exactly the
  kind of gap that should surface as an open question at Gate 1 rather than
  being guessed at.

If your first run finds all three of those, the workflow is behaving.
