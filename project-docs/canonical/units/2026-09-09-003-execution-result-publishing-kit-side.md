# Execution Result Publishing — Kit Side

The `playwright-aidlc`-side half of `connected-ai-dlc-tlc/project-docs/canonical/units/2026-09-07-001-execution-result-publishing.md`'s ER-3 and ER-4, which each explicitly require this tracked here — ER-3's own AC says wiring `e2e-ship` is part of *closing that story*, and ER-4's own notes say the cross-repo ask must be tracked "rather than leaving it implied here with no owner." Neither had a home in this repo's own catalog until now. This unit does not re-specify ER-3/ER-4 — each story below is a pointer to the real spec, not a duplicate of it.

---

## Epic: Push Results to the Toolkit

---

### ERK-1: Wire e2e-ship to push a finished bolt's artifact bundle

**Type:** tool
**Status:** done
**Epic:** Push Results to the Toolkit

**As a** QA lead,
**I want** `e2e-ship` to call `connected-ai-dlc-tlc`'s push endpoint (ER-3) with the finished bolt's artifact bundle at the same point it opens the PR,
**so that** every bolt's results reach the Workbench the moment it ships, with no separate manual step.

**Acceptance Criteria:**
- [x] Full spec lives in ER-3 (`2026-09-07-001-execution-result-publishing.md`) — this story is the `playwright-aidlc`-side half: `e2e-ship` gains a step that POSTs the bundle ER-1 defines to the endpoint ER-3 exposes, once that endpoint exists.
- [x] Endpoint URL and credentials configured the same way other bolt secrets are (`.env.local`, referenced by name in `e2e.config.yml`) — never embedded per-bolt.
- [x] A push failure is reported plainly in the ship step's output and logged to `audit.md` — it never silently drops, and it never blocks the PR from opening (the PR is the thing a human reviews; the Workbench push is a side effect of shipping, not a precondition for it).
- [x] Depends on ER-3 existing on the `connected-ai-dlc-tlc` side first — nothing to build here until that endpoint is real.

**Notes:**
- **Unblocked, 2026-09-09.** ER-3 is real now — `POST /api/bolts/ingest`, bearer-key auth, tested (`connected-ai-dlc-tlc/app-state/`).
- **Built, 2026-09-09.** New "Push results to the Workbench (optional)" section in `skills/e2e-ship/SKILL.md`, placed right after the PR opens (Release visibility, before Reviewer guidance) — same optional-gate shape as `e2e-intake` step 4a's Knowledge Assistant grounding: only runs if `e2e.config.yml` has a `workbench:` block and every `.env.local` var it names is set, skipped with one line otherwise. `e2e.config.yml` (both the real root file and `templates/e2e.config.yml`) gained that `workbench:` block — `url_env`/`bolt_ingest_key_env`/`release_id_env`, names not values, the same shape as the existing `app.auth.user_env`/`password_env` precedent (AC2's literal "referenced by name," not the bare-var shape step 4a itself uses). `templates/env.local.example` gained the three named vars (`WORKBENCH_URL`, `WORKBENCH_BOLT_INGEST_KEY`, `WORKBENCH_RELEASE_ID`).
- **Two real gaps the story's own note didn't name, resolved here:** `releaseId` has no source anywhere in this kit (no release concept existed before this pass) — that's what `WORKBENCH_RELEASE_ID` is for. `repoKey` had no derivation anywhere either — the new step derives it via `git remote get-url origin`, falling back to `project.name` from `e2e.config.yml` for a remote-less repo (the same remote-less case this file already handles for the PR step itself).
- **Verified against the real endpoint, not just written.** Built a bundle exactly the way the new SKILL.md step instructs (real `git remote get-url origin` output from this repo as `repoKey`, an ER-4-shaped `results/<bolt_id>.result.json` payload, a matrix-shaped `matrixMarkdown`) and POSTed it to a live `connected-ai-dlc-tlc` instance's real `POST /api/bolts/ingest` — 200, and the resulting item showed up correctly in that repo's PV-3 release rollup (`2026-09-04-001-ai-dlc-bolt-loop-pivot.md`), including the correct `repoKey`/execution/result data.
- **Not done here:** the failure path (non-2xx / network error → silent degrade + one `audit.md` line) is written into the SKILL.md instructions and follows step 4a's own well-established pattern exactly, but wasn't separately fault-injected against a live run — no code exists to unit-test, since this step is agent-followed instructions, not a `lib/*.mjs` function.
- **Hardened, 2026-09-09 (real gap, not hypothetical): the push `curl` had no actual timeout.** "Never blocks" was written as intent but not enforced — an unreachable host fails fast, but a host that's up and simply not answering (firewall silently dropping the packet, a hung proxy) would have left `curl` waiting indefinitely with the whole `e2e-ship` run blocked behind it. Added `--connect-timeout 5 --max-time 15` to the push `curl`. Found and fixed the identical gap in the *existing*, already-shipped `e2e-intake` step 4a Knowledge Assistant call at the same time — same missing flags, same real risk, predating this story.
- **Relocated and simplified, 2026-09-11 (real gap, confirmed against actual team usage).** Two problems surfaced running this against a real team's actual bolts: (1) every real bolt so far stopped at Gate 2 by explicit owner instruction (no commit, no PR) — gating the push on "after the PR opens" meant it never once fired. Moved the whole section into `e2e-bolt/SKILL.md`, firing the moment Gate 2 is presented instead (the matrix and real results already exist by then — step 7's re-run before Gate 2 already made sure of that). (2) `WORKBENCH_RELEASE_ID` baked a specific release id into `.env.local` at provisioning time, but this team tests the *next* release ahead of its own start date as routine practice — a release id fixed at provisioning would be wrong within days of a release rolling over. Removed `release_id_env` from the `workbench:` config schema entirely; the bundle now omits `releaseId`, and `connected-ai-dlc-tlc`'s ingest endpoint resolves "the current (or soonest upcoming) release for this key's project" itself, at push time. The bolt-ingest key itself changed shape to match — scoped by `projectId` now, not a fixed `releaseIds` list, so a key minted once keeps working across every future release rollover without re-minting. `e2e.config.yml` (both the real root file and `templates/e2e.config.yml`) had `release_id_env` removed accordingly.

---

### ERK-2: Emit a structured result file alongside summary.md and the matrix

**Type:** tool
**Status:** in-progress
**Epic:** Push Results to the Toolkit

**As a** maintainer,
**I want** `pw-aidlc results` to also write a structured, non-gitignored result file per bolt,
**so that** `errorDetail` and run attribution (`runId`/`testedCommit`/`branch`) reach the toolkit without it ever parsing `results/summary.md` as data.

**Acceptance Criteria:**
- [x] Full spec lives in ER-4 (`2026-09-07-001-execution-result-publishing.md`) — this story is that spec, tracked with an owner in this repo instead of only being implied from the other side.
- [x] `results/<bolt_id>.result.json` built from data `pw-aidlc results` already computes today — `lib/report.mjs`'s `writeBoltResults()`, called at the end of `results()`. Name settled as `<bolt_id>.result.json`, one file per bolt present in the run.
- [x] Not gitignored, additive only — `results/summary.md` and `docs/traceability-matrix.md` unchanged. `!results/*.result.json` added to both this repo's own `.gitignore` and the template new projects get (`lib/init.mjs`) — verified directly with `git check-ignore` against a real file, not assumed.
- [x] Keying **decided as bolt id + test title, not scenario number** — matrix.md's own real join (`byTitle` in `matrix()`) is title-based; scenario number isn't a field `results()` ever computes, so keying by it would invent a join key nothing else uses. `connected-ai-dlc-tlc`'s ER-1 was built to match this real key.

**Notes:**
- **Verified against a real run, 2026-09-09 (aidlc-gitcopilot-run-5).** Found and fixed a real, pre-existing bug this exposed: `boltOf()` required a literal `tests/` prefix, but the kit's own `playwright.config.ts` sets `testDir: './tests'`, so Playwright's JSON reporter emits paths like `e2e/US-MDUI-DRV-002/x.spec.ts` — never with that prefix. `t.bolt` was `null` for every real test in production, confirmed directly against run-5's actual `results/latest.json` (both entries showed `"bolt": null`, including a test that obviously belonged to a bolt). This silently would have made `writeBoltResults()` write zero files — the exact feature this story ships. Fixed the regex to make the prefix optional; re-verified end to end by feeding run-5's real raw Playwright JSON report (not just `latest.json`) through `flatten()` — all 5 real bolt tests now resolve `bolt` correctly, `seed.spec.ts` still correctly resolves to `null`.
- **Separate, still-open finding from the same run, not yet acted on:** `docs/traceability-matrix.md`'s "Last run" column only ever reflects the *most recent* `pw-aidlc results` invocation, because `results/latest.json` is a single global snapshot, not per-bolt cumulative data. In run-5, CUST-001's own 5 test results (captured ~13:35Z) were invisible in the matrix regenerated at 14:32Z, overwritten by a later, narrower `results` call for DRV-002 alone — even though nothing about CUST-001's tests had changed. Worth a follow-up story; not fixed here.

---

## Closing this unit

- [ ] Both stories are `done`, `descoped`, or `parked`.
- [ ] Confirm ER-3/ER-4 on the `connected-ai-dlc-tlc` side reference this unit back, so the pointer holds in both directions.
- [ ] Rename this unit with the `[closed]-` prefix once the above is true.
