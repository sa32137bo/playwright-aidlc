# Push bolt results to the Quality Workbench

Optional step of `e2e-bolt`, run right after Gate 2 is presented. Read this file
only when the gate in `SKILL.md` § "Push results to the Workbench (optional)"
says to. The workbench no longer ships by default (pack.ps1 / unpack.ps1
`-IncludeWorkbench`), so most workspaces skip it.

Do this the moment Gate 2 is presented (after the post-mortem) — not after
approval, and not gated on Ship. Many bolts stop here permanently by owner
instruction, and the matrix and real results already exist (step 7's re-run).

**Run only if** `e2e.config.yml` has a `workbench:` block **and** both `.env.local`
vars it names (`url_env`, `bolt_ingest_key_env`) are set. Otherwise skip the step
and say so in one line — it is never required to reach Gate 2 (same gate shape as
`e2e-intake` step 4a).

Build the bundle from real files on disk, never fabricated:

- `boltId` — `bolt_id` from `intake.yml`.
- **No `releaseId`.** Omit it deliberately: the team tests the next release ahead of its start date, so an id resolved now soon goes wrong. The ingest endpoint resolves "the current (or soonest upcoming) release for this key's project" on receipt (connected-ai-dlc-tlc's `routes/bolts.ts`). An explicit `releaseId` is still accepted for a specific past release; the normal case sends none.
- `repoKey` — `git remote get-url origin`, normalized. It identifies the target repo, which is shared across many release items, so never make it bolt- or item-specific. No remote configured → `project.name` from `e2e.config.yml`.
- `repoBranch` / `repoCommit` — `git branch --show-current` / `git rev-parse HEAD` at push time, not `e2e-ship`'s later `test/<ID>-<slug>` branch (usually not created yet). No git repo at all → omit both rather than block the push.
- `storyFile` / `jiraKey` — `intake.yml`'s `story_file` / `jira_key`, whichever is set (never both).
- `storyTitle` / `storyContent` — from the file at `storyFile` or, for a `jiraKey` bolt, `inputs/stories/<ID>.md` (e2e-intake step 2 caches every fetched story there). `storyTitle` is the file's first `#` heading line; `storyContent` is its full text (so release health shows a real title, not a file path). Best-effort: if missing or unreadable, omit both and push the rest.
- `matrixMarkdown` — full contents of `docs/traceability-matrix.md`, verbatim, if it exists.
- `planMarkdown` — full contents of `bolts/<ID>/plan.md`, verbatim, if it exists. It alone holds each scenario's precondition/steps/expected result (under `#### <id> <title>`), which Test Case Review shows. Best-effort: omit if missing or unreadable, never block the push.
- `specFiles` — one `{filename, content}` entry per generated spec under `<paths.tests>/<bolt_id>/`, `filename` being the relative path the matrix's `Test` column resolves against (ingestion joins by filename; Test Scripts previews the source). Best-effort per file: skip a missing or unreadable one rather than fail the push.
- `resultFiles` — a one-element array holding the parsed JSON of `results/<bolt_id>.result.json` (ER-4), verbatim, if it exists.
- `retroMarkdown` — full contents of `bolts/<ID>/retro.md`, verbatim, if it exists (why the post-mortem runs first).

```bash
curl -s --connect-timeout 5 --max-time 15 -o /tmp/workbench-ingest-response.json -w "%{http_code}" \
  -X POST "$WORKBENCH_URL/api/bolts/ingest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WORKBENCH_BOLT_INGEST_KEY" \
  -d @/tmp/workbench-bundle.json
```

**Keep `--connect-timeout 5 --max-time 15`** — as in `e2e-intake` step 4a, they stop a host that is up but not answering from hanging `curl`, and the bolt with it, indefinitely. They are what makes "never blocks" true.

**Any failure — network error, timeout, a non-2xx status, or a 4xx explaining a
malformed bundle — degrades silently: the bolt continues exactly as if this step
did not exist, nothing is retried, nothing blocks Gate 2.** Either way, append
exactly one line to `audit.md`'s `## Approvals` section, right after the
`GATE 2 presented` line:

- Success: `[<ISO>] Bolt results pushed to the Workbench (release <releaseId from the response>).`
- Failure: `[<ISO>] Bolt results push to the Workbench failed (<http status or error>) — not retried.`
