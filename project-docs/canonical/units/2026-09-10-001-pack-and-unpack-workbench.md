# Pack and Unpack the AI-DLC Workbench

Two symmetrical Windows scripts that turn "four separate git checkouts on my
machine" into "one zip file, handed to someone else, that stands itself up
into a running environment": `scripts/pack.ps1` produces the zip,
`scripts/unpack.ps1` (the renamed, extended `provision-workspace.ps1`)
consumes it.

---

## Epic: Handoff packaging

---

### PKG-1: Pack this repo and its three sibling toolkits into one zip

**Type:** tool
**Status:** done
**Epic:** Handoff packaging

**As a** developer with a working AI-DLC Workbench setup on my own machine,
**I want** one script that bundles playwright-aidlc, knowledgeassistant,
toolkit-workbench and connected-ai-dlc-tlc into a single zip,
**so that** I can hand a colleague (or a remote/demo machine) everything
needed to stand the whole environment up, without them having to know these
four repos even exist separately.

**Acceptance Criteria:**
- [x] Each of the three sibling repos is found next to this one (the same
      layout the `.code-workspace` file already assumes) and pulled to its
      current branch's latest commit if present locally; cloned fresh
      (default branch) if not present at all. A failed `git pull` warns and
      packages the local state as-is rather than aborting; a failed clone
      (no local content to fall back to) is fatal — this runs on the
      packaging operator's own machine, so "fix your VPN and re-run" is the
      right answer, not shipping a zip silently missing a required repo.
- [x] Never packages `.git` history, `node_modules`/`.venv`/build output, or
      any real secret (`.env`, `.env.local`, `envconfig.yaml`) — the
      `.example` templates ship, real credentials never leave the packaging
      machine.
- [x] Output is a plain zip with the four repo folders at its top level, no
      extra wrapper folder — Windows' own "Extract All..." already creates
      one, matching exactly what `unpack.ps1` expects as siblings.
- [x] Clear, numbered step output throughout (`[1] Packaging playwright-aidlc`,
      etc.), matching `provision-workspace.ps1`'s own established
      `Step`/`Ok`/`Warn`/`Fail` convention rather than inventing a new one.

**Notes:**
- **Verified, 2026-09-10, not just written.** PowerShell 7 was installed
  locally (via Homebrew) specifically to parse-check and functionally test
  both scripts before handoff — neither had ever been runnable or testable
  in this environment before. `pack.ps1` was run end-to-end against real
  local git repos (three "found locally, pull, copy" cases including one
  real failure mode — a branch with no upstream, confirmed to warn and
  continue rather than abort — and one "not found locally, clone" case,
  confirmed to fail loudly and correctly against an intentionally
  unreachable remote). The resulting zip was inspected directly: no
  `node_modules`/`.venv`/`.git`/`.env.local` anywhere in it, `envconfig.yaml`
  stripped while `envconfig.yaml.example` survived, real file content intact.
  `robocopy` itself (Windows-only) couldn't be exercised on this machine — a
  functionally equivalent shim stood in for it to validate the surrounding
  control flow and exclusion intent.
- Confirmed both scripts are pure ASCII with LF line endings and no BOM,
  matching `provision-workspace.ps1`'s existing convention exactly (verified
  by inspecting that file's own bytes) — a real, checked property, not an
  assumption, since a stray smart quote or em dash would misrender in
  Windows PowerShell 5.1's non-UTF-8-by-default console.
- Confirmed neither script uses PowerShell 7-only syntax (`??`, ternary,
  pipeline `&&`/`||`) — grepped for each. This matters because the target
  "remote Windows machine" almost certainly means Windows PowerShell 5.1
  (the OS-bundled version), not PowerShell 7, and 5.1 rejects that syntax
  outright.
- **Real bug found and fixed in a self-review pass, 2026-09-10: PowerShell's
  single-element-array flattening.** `Get-AafVenvIntoStaging` originally
  returned `$vendored` (an array built with `+=`) directly; PowerShell
  collapses a function's single-element array output into a bare string
  when the caller captures it with plain assignment. With exactly one of
  the two venvs vendored, `$vendoredAaf[0]` then indexed into that STRING's
  *characters* instead of its one real element — the "partially vendored"
  summary line printed "only v" instead of "only venv". Caught by testing
  the exact partial case, not by inspection — reproduced the flattening in
  isolation first to confirm the mechanism, then fixed it by wrapping the
  call site in `@(...)`, which forces array semantics regardless of element
  count. Re-verified all three cases (0, 1, 2 venvs found) after the fix.

---

### PKG-2: Unpack and start the full environment on the target machine

**Type:** tool
**Status:** done
**Epic:** Handoff packaging

**As a** person who just received a pack.ps1 zip on a fresh Windows
machine,
**I want** one script that does everything `provision-workspace.ps1` used to
do AND brings up the Toolkit Workbench, registers and starts both toolkits,
starts connected-ai-dlc-tlc's own app-state/ui, and tells me plainly whether
it all worked,
**so that** "unzip, run one script" is the entire setup procedure, not a
checklist of a dozen manual commands across four different tools.

**Acceptance Criteria:**
- [x] Every behavior of the old `provision-workspace.ps1` (MDUI workspace
      creation, `pw-aidlc init`, the MDUI config/framework overlay, artifact
      sorting, `.env.local`) still happens exactly as before, under the new
      name — renamed via `git mv` to preserve history, not copy-pasted into
      a new file.
- [x] `-ArtifactsSource` and `-EnvFile`, previously hardcoded to one person's
      Windows paths and required, are now optional (the same "blank/missing
      just skips this step" treatment `-KnowledgeSource` already had) —
      those files won't exist on a fresh remote machine, and the workspace
      creation shouldn't hard-fail just because they're absent.
      `-EnvFile`'s fallback is this repo's own `templates/env.local.example`,
      not nothing.
- [x] After the workspace phase, starts `toolkit-workbench\start.bat`, waits
      for its API to answer, then registers (`POST /api/toolkits`) and starts
      (`POST /api/toolkits/{id}/start`) both `knowledgeassistant` and
      `connected-ai-dlc-tlc`, polling `GET /api/toolkits/{id}` for
      `status: "running"` rather than assuming a fixed wait time or
      hardcoding ports (toolkit-workbench's own port assignment can shift
      per-machine to resolve conflicts).
- [x] A missing `capabilities/config/envconfig.yaml` is restored, in
      preference order, from: (1) already in place — never touched; (2) a
      real, pre-filled backup named `<toolkit-folder-name>.envconfig.yaml`
      living in the same folder as `-EnvFile`'s `.env.local` (see PKG-4); (3)
      the toolkit's own `.example`, a placeholder that only satisfies
      `start.bat`'s mere-existence preflight. This is what makes unattended
      startup possible at all without ever fabricating or shipping a real
      credential in the `pack.ps1` zip itself.
- [x] connected-ai-dlc-tlc's own `start.bat` only brings up its Python AAF
      side, never its Node `app-state`/`ui` — confirmed by reading that file
      directly, not assumed from the Workbench's own docs. This script
      starts both directly (`npm install` if needed, then `npm run dev`,
      each in its own titled console window) since nothing else does.
- [x] One phase failing (Workbench itself, either toolkit, or app-state/ui)
      never blocks the others from being attempted — each is wrapped in its
      own try/catch and recorded independently; the final summary reports
      exactly what came up and what didn't, and only declares plain
      "SUCCESS" when everything did.

**Notes:**
- **Verified, 2026-09-10.** The three new orchestration functions
  (`Wait-ForHttp`, `Register-Toolkit`, `Start-RegisteredToolkit`) were
  extracted verbatim and run against a real local mock HTTP server shaped
  like toolkit-workbench's actual API (health check, register, start, and a
  status that starts as `"starting"` and flips to `"running"` after a few
  polls) — 8 scenarios, including idempotent re-registration, a toolkit
  directory that doesn't exist, a bad/missing id, and the polling loop
  surviving a transient not-yet-healthy state before succeeding. All 8
  passed. `pack.ps1`'s own end-to-end run is recorded under PKG-1.
- **Real, not hypothetical dependency to flag:** both toolkits' `start.bat`
  install a shared Python framework from a private Prolifics package
  registry on first run — this needs VPN/network access on the *target*
  machine, separate from whatever access was needed to receive the zip in
  the first place. Step 7 checks reachability up front and warns clearly
  rather than letting a slow failure read as a mystery later.
- **Three more real bugs found in a self-review pass, 2026-09-10, all in the
  same family: paths that could skip the final summary or misreport it.**
  (1) The unified "SUCCESS"/"PARTIAL SUCCESS" summary (step 11) originally
  lived entirely inside `if (-not $SkipToolkits)` — meaning `-SkipToolkits`,
  the EXACT flag `DEMO-RUNBOOK.md`'s own bolt-demo setup uses, never got a
  unified declaration at all, only Part One's own "Workspace ready" line.
  Moved step 11 outside both part blocks so it always runs on whatever
  actually ran. (2) That fix then exposed a second bug: with both
  `-SkipWorkspace` and `-SkipToolkits` passed, `$PhaseResults` is empty, and
  an empty `foreach` loop never flips `$allOk` away from its initial `$true`
  — would have printed a plainly false "SUCCESS" for a run that did nothing
  at all. Added an explicit zero-phases branch instead. (3) Part One's own
  pre-flight checks (`pw-aidlc` on PATH, `-ConfigSource` looking like the
  real repo root, the interactive/non-interactive "-Destination already
  exists" handling, which used to call `exit 1` directly) sat OUTSIDE its
  own try/catch — any of them throwing (or the old `exit 1`) killed the
  whole process before Part Two ever got a chance, directly contradicting
  this script's own stated "one phase failing never blocks the rest"
  design. Widened the try/catch to cover all of Part One and replaced both
  `exit 1` calls with `throw`, so a bad `-Destination` or a missing
  `pw-aidlc` now records a failed 'MDUI workspace' phase and lets Part Two
  still run. Found by testing the exact `-SkipToolkits` invocation
  `DEMO-RUNBOOK.md` recommends with no `pw-aidlc` on `PATH` — it used to
  crash uncaught; now it reports `PARTIAL SUCCESS` cleanly. A fourth,
  related gap in the same area: the script never set a non-zero exit code
  on failure — `PARTIAL SUCCESS` (or every phase failing) still exited 0,
  which breaks anything checking `$LASTEXITCODE`/`%ERRORLEVEL%` afterward
  (a CI wrapper, or a person scripting around this). Added `exit 1` when
  any recorded phase failed. All four re-verified together: a missing
  `pw-aidlc` now correctly yields `PARTIAL SUCCESS` and exit code 1; a real
  (faked) successful run yields `SUCCESS` and exit code 0; both skip flags
  together yield the explicit "nothing to summarize" message and exit 0.
- **Idempotency audit, 2026-09-10, prompted by a direct question ("is
  everything idempotent?"), found two more real bugs specifically about
  re-running unpack.ps1 against an already-running environment:**
  (1) toolkit-workbench's own `/start` endpoint returns HTTP 409 "Already
  running" for a toolkit that's already up (confirmed by reading
  `api/routers/toolkits.py` directly, not assumed) — `Start-RegisteredToolkit`
  treated any non-2xx as a real failure, so a second run against a healthy
  environment would have wrongly reported that toolkit as failed. Fixed by
  checking current status first (and, defensively, re-checking on an actual
  409) and treating "already running" as success. (2) Neither the Toolkit
  Workbench itself nor connected-ai-dlc-tlc's `app-state`/`ui` were checked
  for "already running" before spawning a new process — a second run would
  have started a second `npm run dev` fighting the first one for the same
  port (app-state/ui, no self-healing), or unnecessarily killed and
  restarted an already-healthy Toolkit Workbench (which does self-heal via
  its own port-conflict handling, but that's still a pointless disruption).
  Added a one-shot `Test-HttpUp` health probe before each of the three
  `Start-Process` calls; each now skips straight to "already running" if
  the port already answers. Re-verified `Start-RegisteredToolkit`'s fix
  against a mock server that returns 409 for an already-running toolkit —
  now correctly reports success instead of failure.
- **Incorrect envconfig placeholder claim, found 2026-09-10 while writing up
  the DEMO-RUNBOOK envconfig step:** `Confirm-ToolkitEnvConfig`'s warning for
  a missing envconfig.yaml claimed a placeholder `.example` copy "lets the
  toolkit's services come up, it just can't answer questions yet" for every
  toolkit. Checked against the actual installed `agentic_platform` package
  (`~/.aaf/venv/.../agentic_platform`) rather than assumed: `platform_bootstrap.py`
  calls `build_agents()` at process startup, which constructs every agent in
  `agents.yaml` eagerly; `OpenAI_agent.py`'s `__init__` immediately constructs
  `AsyncOpenAI(api_key=self.api_key)`, which raises if the key resolves to
  `None` (an all-commented-out placeholder) and no `OPENAI_API_KEY` env var is
  set. knowledgeassistant's `agents.yaml` defines three OpenAI-backed agents,
  so a placeholder envconfig.yaml means it fails to start, not "starts but
  can't answer." connected-ai-dlc-tlc's `agents.yaml` currently defines
  `agents: []`, so a placeholder is genuinely harmless there today. Fixed the
  warning message in `Confirm-ToolkitEnvConfig` to say so per-toolkit, and
  corrected the same false claim in DEMO-RUNBOOK.md's new Step 1.3.
- **Cross-client data exposure, found 2026-09-10 during a "what's actually
  in the zip we hand to Corpay" sense check:** `pack.ps1`'s exclude list
  (`$ExcludeDirs`/`$ExcludeFiles`) only ever covered generated output and
  secret-named files - `.gitignore` has no effect on it at all, since
  `pack.ps1` robocopy-mirrors the real working tree, not a git checkout.
  connected-ai-dlc-tlc's `project-docs\inputs\` (1.5GB, gitignored but not
  robocopy-excluded) turned out to contain a 1.2GB unrelated internal
  Prolifics codebase kept as migration reference (`for-migration/`), and -
  the actually serious one - **verbatim meeting transcripts from a
  different client's (McKesson) demo call**, saved as local reference
  material under `demo-of-ai-verse/`. Both would have shipped inside a zip
  physically copied onto Corpay's own AWS workspace. Nothing downstream
  (`unpack.ps1`, any bolt) ever reads `project-docs/inputs` - it is pure
  local working material. Fixed by adding a per-repo `ExtraExcludeDirs` to
  `$Repos`, excluded by full path (`Join-Path $Source ...`), not by bare
  name - deliberately, since playwright-aidlc has its own legitimate
  top-level `inputs\` (where Bolt A/B's stories actually live) that a
  bare-name "inputs" exclude would have wrongly caught too. Verified with a
  real end-to-end run against fake sibling repos reproducing both cases
  (playwright-aidlc's `inputs/stories/story.md` and connected-ai-dlc-tlc's
  `project-docs/other/keep-me.md` both survive; `project-docs/inputs/` is
  gone entirely from the output zip) - not just read, actually unzipped and
  inspected.
- **Two more exclusion gaps, found 2026-09-10 in a follow-up "anything else
  we should exclude?" sweep:** same root cause as the finding above
  (gitignored is not robocopy-excluded). (1) `knowledgeassistant`'s
  `knowledge-service\data` - chroma's local vector store (`chroma.sqlite3`
  plus its `.bin` index files, not caught by the existing `*.db` pattern)
  and whatever's been uploaded into it during testing; runtime state the
  service regenerates as sources sync, not something to carry in the
  package. (2) `.claude\settings.local.json` in every repo that has one -
  personal Claude Code state (a local Bash-permission allowlist containing
  this machine's own absolute paths), not project config; every repo's own
  top-level `.claude\` was confirmed to hold nothing else, so the whole
  directory is now excluded by bare name (same category as `.git`), not
  just this one file. Both added to `pack.ps1` and verified in one combined
  end-to-end run covering all four exclusion cases at once (the earlier
  `project-docs\inputs` fix included): each repo's legitimate content
  survives untouched, all four excluded paths are gone from the output.
- **Confirmed intentionally NOT idempotent, by design, not a bug:**
  `pack.ps1`'s `-OutputZip` and `unpack.ps1`'s `-Destination` both refuse to
  silently overwrite an existing path — re-running with the same defaults a
  second time fails with a clear message unless `-Force` is passed. This is
  deliberate (the same "don't silently delete something in a scripted run
  with nobody watching" reasoning `provision-workspace.ps1` already had for
  `-Destination`), not an oversight - a clear failure telling you to add
  `-Force` is not the same class of bug as the two above, where the script
  claimed something was wrong when it wasn't.
- **Not done here:** the actual Windows execution of either script — no
  Windows machine was available in this environment. What was verified is
  everything that could be verified without one: syntax, encoding,
  PowerShell-version compatibility, and the real logic of every function
  that doesn't require `cmd.exe`/`robocopy` specifically, via PowerShell 7
  installed locally for this purpose. A first real run on an actual Windows
  box is the remaining validation step.

---

### PKG-3: Vendor the shared AAF framework so the target machine needs no VPN

**Type:** tool
**Status:** done
**Epic:** Handoff packaging

**As a** person unpacking this on a target machine with no VPN access to
Prolifics' internal network,
**I want** `pack.ps1` to bundle a working copy of the shared AAF Python
framework, and `unpack.ps1` to put it back in place before either toolkit
starts,
**so that** neither toolkit's `start.bat` hits its fatal "no prior install,
network required" path on a machine that can never reach
`gitlab.prolifics.com` at all.

**Acceptance Criteria:**
- [x] Investigated directly, not assumed: found and read `aaf-start`'s own
      source (`agentic-assembly-framework/src/aaf/cli/start.py`) to confirm
      there are genuinely TWO separate network-dependent install points, not
      one — `start.bat`'s own bootstrap of `%USERPROFILE%\.aaf\venv`, AND a
      second, separate step *inside* `aaf-start` itself that reinstalls each
      toolkit's own `capabilities` package on every run. Both already
      degrade gracefully (warn and continue) when a prior successful install
      exists; neither does on a genuinely first-ever run.
- [x] Confirmed no lockfile exists anywhere in `agentic-assembly-framework`,
      `agent-impl-tool-kit`, `knowledgeassistant`, or `connected-ai-dlc-tlc`
      — every dependency is a loose `>=` floor with no pin. This rules out a
      reproducible `pip download`-based offline wheel bundle as the
      approach; there is no version set to reproduce.
- [x] `pack.ps1` copies `%USERPROFILE%\.aaf\venv` and
      `\.aaf\capabilities-venv` (if they exist on the packaging machine —
      i.e., it has run both toolkits successfully at least once already)
      into a fifth top-level `vendor\` folder in the zip, alongside the four
      repos. Missing on the packaging machine is a warning, not a failure —
      `-SkipVendorAaf` opts out entirely for a target machine that will have
      its own VPN.
- [x] `unpack.ps1` restores `vendor\aaf-venv`/`vendor\aaf-capabilities-venv`
      to `%USERPROFILE%\.aaf\venv`/`\.aaf\capabilities-venv` on the target
      machine, ONLY if nothing is already there — never clobbers a real
      local install with a stale vendored one.

**Notes:**
- **Real, documented risk, not a guarantee: venv relocation.** A Python venv
  created on the packaging machine and placed at a different absolute path
  on the target machine is generally fine on Windows specifically (the
  `Scripts\*.exe` launchers typically resolve their companion script by a
  path relative to their own location, unlike POSIX shebang launchers which
  embed an absolute interpreter path) — but this is not a universal
  guarantee for every package, particularly ones with compiled C extensions
  that could embed an absolute build-time path. This could not be verified
  against a real `.aaf` venv in this environment (none exists on this
  machine — the toolkits have never been run here). If a restored venv
  doesn't work on the target machine, the existing "warn and continue with
  online install" fallback in each toolkit's own `start.bat` is still there
  as a safety net, provided the target machine does have some network path
  to the registry after all.
- **Verified, 2026-09-10, with fake venvs standing in for real ones.** Built
  fake `%USERPROFILE%\.aaf\venv`/`\.aaf\capabilities-venv` directories with
  marker files, ran `pack.ps1` against them (vendored correctly into the
  zip), extracted the zip, and ran `unpack.ps1`'s restore logic against a
  clean fake target profile — the exact bytes landed at the exact expected
  path. Also verified: re-running against a target that already has the
  venv leaves it untouched, and a package built with `-SkipVendorAaf` (or
  from a machine with no local venv to vendor) correctly warns and skips
  restoring, rather than failing.
- **Deliberately out of scope:** `knowledgeassistant/knowledge-service`'s own
  separate venv (chromadb, document parsers, etc.) is not vendored — its
  entire dependency tree is public PyPI, confirmed by reading its
  `pyproject.toml` directly, so it needs ordinary internet access but not
  VPN specifically, which is what this story is scoped to.

---

### PKG-4: Restore each toolkit's real envconfig.yaml from a backup

**Type:** tool
**Status:** done
**Epic:** Handoff packaging

**As a** person unpacking this on a target machine,
**I want** each toolkit's real, already-filled-in
`capabilities/config/envconfig.yaml` (with a real LLM provider connection)
restored automatically from a backup folder, without that file ever having
been inside the `pack.ps1` zip,
**so that** the toolkits can answer real questions immediately after
`unpack.ps1` finishes, not just start up with a placeholder key that can't
actually call an LLM.

**Acceptance Criteria:**
- [x] The backup folder is the SAME folder that holds `-EnvFile`'s
      `.env.local` — not a separate parameter to remember, resolved once at
      the top of `unpack.ps1` (via `$BackupConfigDir`) regardless of whether
      `-SkipWorkspace` is passed, since part two needs it even when part one
      (which is what used to own `-EnvFile`) is skipped.
- [x] Backup files are named `<toolkit-folder-name>.envconfig.yaml` —
      `knowledgeassistant.envconfig.yaml` and
      `connected-ai-dlc-tlc.envconfig.yaml` — copied to that toolkit's own
      `capabilities\config\envconfig.yaml`.
- [x] Never overwrites a `capabilities\config\envconfig.yaml` that's already
      in place on the target machine (e.g., a repeat run) — restore-from-
      backup and the `.example` placeholder fallback are both lowest
      priority to "it's already there."

**Notes:**
- **Verified, 2026-09-10, not just traced by hand.** Extracted
  `Confirm-ToolkitEnvConfig` verbatim and ran it against 5 real scenarios:
  an already-configured toolkit (left untouched), a real backup file present
  (restored, exact content matched), a backup dir given but no matching file
  in it (falls back to `.example`, warning names the exact backup path it
  checked), no backup dir at all (falls back to `.example` silently on that
  point), and nothing available at all — no `envconfig.yaml`, no backup, no
  `.example` (warns, creates nothing, doesn't throw). All 5 passed.

---

## Follow-up: pack-time build caching, and two real-world reports acted on

**2026-09-10, after the team reported `pack.ps1` taking 9+ minutes.** Traced
the cost to `offline_aaf.py`'s `build()` — four independent wheel builds
(framework/capabilities/knowledge-service/workbench, deliberately isolated so
one group's pinned deps can't constrain another's), each with a fresh venv,
`pip wheel`, `pip install --no-index` verification, and (for `capabilities`)
an extra exercise of AAF's own installer twice per project. Real, expected
cost of the wheel-bundle rewrite — not a regression.

Since AAF/toolkit dependency updates are rare, added build-time caching:
`build()` now checks `%USERPROFILE%\.aaf\pack-cache` first and reuses it
(a fast copy, not a rebuild) when the packaging machine's Python, this
script's own build recipe (`digest(__file__)` — catches a version bump or a
new `GROUPS` entry that `sources(root)` alone can't see), and every current
project source file all still match what the cache was built from. Falls
through to a full rebuild on any mismatch or any problem reading the cache —
this is purely a speed optimization, a bad cache must never be worse than no
cache. `-NoCache` forces a real rebuild regardless. **First build after
adopting this still pays the full cost once** — the cache only helps from the
second build on, since nothing was cached before this existed.

Refactored `verified_manifest`'s integrity/content checks into
`manifest_intact`/`bundle_problem`, shared with the new
`try_reuse_cached_bundle` — deliberately the same trust standard for "is this
a valid target" and "is this a valid cache," including the bundle_id
tamper-check, not just the file-content one.

10 new tests added (17 total, all passing): cache hit/miss on no-cache,
corrupted manifest, recipe mismatch, tampered `bundle_id`, and a changed
source file; a full round-trip through `save_bundle_to_cache`; and three
`build()`-level tests confirming a cache hit skips `venv.create`/`run`
entirely, a miss checks then populates the cache, and `use_cache=False` never
consults it. **Two of the new tests (`recipe mismatch`, `tampered
bundle_id`) initially passed for the wrong reason** — mutating the field
under test also happened to break an unrelated check further down, so
disabling the intended check didn't fail them. Caught by deliberately
disabling each check under test one at a time and confirming the
corresponding test failed before trusting it — both fixed to isolate the
specific check (recompute `bundle_id` after the recipe mutation so only the
recipe check can catch it; corrupt only `bundle_id` itself, leaving every
other field genuinely valid, for the tamper test).

**Separately, acted on a real report from the field**: a Corpay AWS
recipient had Python 3.13 while the packaging machine had built with 3.12 —
`verified_manifest`'s old error message ("Install the matching Python
version") reads as an instruction to the *recipient*, which is exactly
backwards for a locked-down box that can't easily install an arbitrary
Python, and wheels aren't ABI-portable across CPython minor versions anyway
regardless of who installs what. Rewrote the error to say plainly that the
fix is on the packaging side — rebuild with `-Python` pointed at an
interpreter matching the recipient's actual version — with the exact
`pack.ps1` command in the message itself.

**And a follow-up from that same conversation**: retrying `pack.ps1` the same
day (exactly the "fix the Python version, rebuild" workflow above) hit the
pre-existing `-OutputZip already exists` guard, which required `-Force` and,
worse, deleted the old zip immediately - before `$StagingRoot` even existed,
long before the ~9-minute rebuild could fail partway and leave nothing at
all. User asked "should it always force" and, once the backup gap was named,
proposed the fix directly: back the old zip up instead of requiring a flag
to proceed. Changed the default to always continue, moving an existing
`-OutputZip` to `<OutputZip>.bak` first rather than deleting it - a failed
rebuild now always leaves the last good zip recoverable. `-Force` is
repurposed to mean "skip the backup, overwrite directly," not "permission to
proceed at all." Verified directly (not just read): all three cases run for
real - default backs up and clears the path, `-Force` deletes outright with
no backup, no pre-existing zip is a no-op either way.
