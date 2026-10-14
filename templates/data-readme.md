# Test Data Management

The thing that kills E2E suites at month six is not selectors — it is test data.
A suite that depends on data someone happened to create is a suite that breaks
the week that person cleans up their account.

## Rules

1. **Every test creates what it needs.** Never rely on pre-existing records.
2. **Every created record carries a unique key.** `user-${Date.now()}@example.com`,
   `ORDER-${randomUUID()}`. Two parallel workers must not collide.
3. **Clean up what you create**, in a fixture teardown, not in the test body.
4. **Never assert on data you did not create.** "there are 5 orders" is a
   guarantee about someone else's data and will not hold.
5. **Never put real customer data here.** Anonymised or synthetic only.

**Exception: screens that only read data** (reports, searches). They cannot
create what they show, so they run against known-good existing data. Keep it
as named, dated constants ("slices": filter values, what the data contains,
source, verified date) in one support file, and have specs import a slice by
name rather than copy its values. Rules 1 and 4 then apply to the slice: it
must be re-confirmed, and a test must first assert that the data it asked for
is present.

## Wiring it up

Point `test_data.seed_script` and `test_data.teardown_script` in
`e2e.config.yml` at scripts in this folder. The seed runs before a suite; the
teardown after.

```
data/
  seed.ts        # create baseline accounts, catalogue items, feature flags
  teardown.ts    # remove anything the run created
  fixtures/      # static payloads, uploads, sample files
```

If your environment is reset by a pipeline rather than by scripts, say so in
`knowledge/project/environment-notes.md` so the agent does not generate seeding
code that duplicates it.
