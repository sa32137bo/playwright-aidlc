# Known Limitations

Read this before promising anything to a client.

1. **Generated tests need human review before they belong in CI.** The generator produces a first draft, not a merge-ready suite. Assertions in particular are frequently too optimistic on dynamic data.

2. **The healer fixes locator-level failures, not logic.** It does not remove the need to debug real problems, and it can be confidently wrong about the cause. Classification before repair is the guardrail, and it depends on a human reading it.

3. **A weakened assertion is the real risk, not a flaky one.** A flaky test annoys you. An assertion loosened to make a test green stops catching regressions silently, possibly for a year. Gate 2 exists for this and should not be rushed.

4. **Accessibility markup determines output quality.** The planner and generator read the accessibility tree. On an app with no roles, labels or test IDs, both degrade badly. Remediating the source is a genuine prerequisite, not an optimisation.

5. **The source scanner is regex-level.** `pw-aidlc context` handles common React / Vue / Next patterns. It will miss dynamic route composition, unusual router setups, heavily abstracted form libraries and server-side rendering indirection. It is a starting point for the agent, never an authority.

6. **The value is mostly maintenance, not creation.** Teams spending a large share of a sprint fixing broken selectors see the most benefit. A small suite over a stable UI may not repay the setup.

7. **Discrepancy detection is best-effort.** Finding that code and the live app disagree is one of the most valuable outputs here, but the kit will not find every case, and a clean run is not proof of consistency.

8. **Agent definitions drift with Playwright.** Regenerate them on every Playwright upgrade, pin them otherwise, and review the diff. Regenerating on each CI run introduces non-determinism.

9. **Token cost is real and scales with plan size.** Long plans cost more and review worse. Cap bolts at ~25 scenarios; split rather than stretch.

10. **This does not replace unit, integration, contract, accessibility, performance or security testing.** E2E is the thinnest and most expensive layer. If a scenario can be a unit test, the plan should say so and exclude it.

11. **No gate here is enforced by the model.** Gates are instructions, and instructions can be skipped under pressure. The structural subset that CI can enforce is in `.github/workflows/e2e.yml`; the rest depends on your branch protection and your reviewers.

12. **Exploration sessions capture real data.** Traces, auth state and screenshots taken against a real environment can contain tokens and customer data. `.gitignore` covers the common paths; secret scanning and review remain mandatory.

13. **Greenfield locators are guesses.** Without a running app there is nothing to
    verify against. Greenfield produces good plans and roughly-right tests; expect
    a re-verification pass when the feature ships.

14. **Characterization tests freeze current behaviour, bugs included.** Approving
    one means "do not change this without noticing", not "this is correct".

15. **A matched matrix row proves a test exists, not that it asserts anything.**
    Binding is now exact where the spec declares a `scenarios:` header, and the
    **Matched by** column says which method produced every row — `header + title`,
    `header` (the file claims the scenario but no single test name matches), or
    `title only`, which is the old similarity guess and is flagged for checking.
    A scenario covered at file level is counted as present but not as a test of
    its own, because one long journey test can legitimately cover five scenarios.
    None of that says the assertions are meaningful; only Gate 2 review does.

16. **`doctor` cannot verify Jira access.** It checks config and local inputs. Whether
    the Atlassian MCP connector actually works is only discovered at intake.

17. **The config parser is deliberately minimal.** `e2e.config.yml` is read by a
    small purpose-built reader, not a full YAML library. Keep to the generated
    shape — anchors, multi-line strings and flow mappings are not supported. In
    particular `exclude: ["a", "b"]` is read as a string, not a list; use the
    `- item` block form if the value has to be a list. A `#` that follows
    whitespace starts a comment, so a value needing a literal `#` must have no
    space before it.

18. **`grounding: scan` gives partial discrepancy detection, not full.** The
    default depth reads the code mechanically: routes, test IDs, form fields, API
    calls and the exact user-facing strings. That catches wording drift, missing
    fields and moved routes. It does **not** derive validation logic, state
    machines, authorization rules or async behaviour, so a conflict that only
    shows up in logic will be missed. Use `deep` when that matters, and expect
    Gate 1 to state which depth ran.

19. **Coverage provenance is a declaration, not proof.** `pw-aidlc impact` works
    off the `covers:` header the generator writes into each spec. A spec that
    over-claims makes a changed file look covered when nothing meaningfully tests
    it. Specs generated before that header existed have none at all and are
    reported as *unknown* — treat unknown as untested until someone checks.

20. **The interview cannot ask about what the scan did not find.** Questions are
    built from what grounding produced. At `scan` or `off` there is less to build
    from, so fewer questions get asked — which is not the same as there being
    fewer things worth knowing. Gate 1 remains the place where the gaps surface.

21. **`ingest` recovers text and images, never the rules inside an image.** A
    business-process document that is mostly screenshots converts to a file that
    carries the *flow* but not the field rules — the CLC Customer Create document
    yields 40 headings, 124 paragraphs and **0 tables** against 27 images. Ingest
    reports that ratio prominently, and the placeholders let a skill open specific
    images on demand, but nothing turns a picture of a form into a validation rule
    without someone reading it. Treat `0 tables, many images` as a warning that the
    story is carrying the grounding alone.

22. **PDF extraction has three known blind spots.** Text in CID-keyed fonts
    (Identity-H) needs the embedded CMap to decode and is reported as missing
    rather than emitted as plausible nonsense. Fonts with a custom `/Differences`
    encoding can mis-map an occasional punctuation glyph. Images that are not
    JPEG-encoded are counted but not extracted. A **scanned** PDF has no text layer
    at all: ingest writes nothing and tells you to read the pages visually, because
    a near-empty file that looks converted is worse than an obvious failure.

23. **Tables survive `.docx` conversion; they do not survive `.pdf`.** A PDF has
    glyphs at coordinates and no cell structure, so a table becomes lines of text.
    Where the same document exists in both formats, ingest the `.docx`.

24. **A `.docx` may carry two media roots.** Relationship targets beginning `/` are
    package-absolute, not relative to `word/`, and documents written by tools other
    than Word mix both forms with overlapping filenames. Resolving one as the other
    returns the *wrong image* silently. The kit handles both, but any other tool
    you point at these files may not.

25. **A rebind is only as good as the seed test it enters through.** `/rebind`
    binds locators by observing the live application, entered via
    `tests/seed.spec.ts`. If that reaches the wrong state — a login screen, a
    tenant with different permissions, an empty account — the locators bound are
    real, observed, and wrong. `pw-aidlc rebind --bolt <ID>` catches the common
    cause (unset or placeholder credentials, which do not error) but cannot tell
    whether the state reached is the state the plan assumed.

26. **`pw-aidlc impact` reports; it does not repair.** It lists which tests a code
    change touches, which changed files nothing covers, and which specs have no
    `covers:` header. Nothing in the kit updates an existing spec incrementally —
    closing a reported gap is still a bolt, and re-running the impacted tests is
    still your call. "We have regression covered" is true of the analysis and not
    of the authoring.

27. **Generated test cases are a reviewed first draft, and they do not look like
    one.** They arrive in your team's own workbook, formatted exactly like the
    cases a human wrote, and go into a test-management tool where a case is a case.
    The gate before writing is what makes "reviewed" true; nothing downstream can
    tell a reviewed case from an unreviewed one. Treat the sheet the way you treat
    generated tests.

28. **Staleness is detected by content, but only for documents the file names.**
    A test-case document records the sources it was written from and their content
    hashes, so `doctor` and `testcases --check` catch a story that has moved on —
    and a clone or checkout, which rewrites every timestamp, does not raise a false
    alarm. What it cannot catch is a requirement clarified in a meeting, a source
    the author forgot to list, or an unstamped file. An unstamped file is reported
    as unstamped rather than as current.

29. **Excel is the round trip's weak point.** `--import` diffs and asks before
    writing, so edits are not lost silently — but the workbook is binary, so two
    testers editing it produce no usable merge, and a sheet emailed around comes
    back with no history of who changed what. Markdown in the repo is the record;
    the workbook is a courtesy.

30. **Every `.ps1` the kit ships must be ASCII.** PowerShell 5.1 reads script files
    as ANSI when there is no BOM, so a UTF-8 em-dash becomes `â€"` — and its final
    byte, `0x94`, is a right curly quote, which PowerShell honours as a real string
    delimiter. One em-dash inside a double-quoted string makes the whole file
    unparseable, and the reported error points at whatever brace unbalanced next,
    never at the character. Check with `PSParser::Tokenize` before shipping.
