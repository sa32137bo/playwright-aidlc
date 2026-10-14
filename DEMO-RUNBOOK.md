# Demo runbook — Bolt A and Bolt B

Bolt A: the bulk/heavy story. Bolt B: one small scenario, fast. Run both
end-to-end now, exactly as written — this same walkthrough is what gets
repeated for the actual client demo, so whatever you find here is what you'd
otherwise find out live.

> ⚠️  **The Bolt A / Bolt B scenarios below are the original MDUI demo** (the
> FleetNet Customer Create wizard and Driver ID Update, with MDUI-specific
> stories, screens and QA data such as customer `98480` / Prompted Id `69977`).
> They are kept as a worked reference. For a **CLC** demo against
> `https://crewhub-qa.taconnections.com/`, replace them with real CLC stories
> and data — do not run these MDUI story IDs against CrewHub. The Step 1
> pack/unpack instructions are current and apply as-is; only the Bolt A/B
> content is MDUI-specific.
>
> **Step 2.1 changed, 2026-09-21**: `unpack.ps1` now runs `npm install`,
> installs Chromium, and installs the official Playwright agents itself
> (its own step 3a) — the four commands previously listed under Step 2.1
> are no longer something you need to run by hand on a normal pass. See
> Step 2.1's own note below for what's actually left to do there now.

**None of this is a one-off.** `playwright-aidlc`, the pack/unpack scripts,
and the toolkits are all still under active development — there is always
new work to reflect. Steps 1.1–1.3 are safe and expected to redo before any
session that needs the latest changes; Step 1.4 (creating the workspace
itself) is not — see its own note on `-Force` below before touching it a
second time.

---

## Step 1 — Roll out the latest changes to the Corpay AWS workspace machine

This is how changes get from the Prolifics network onto the Corpay AWS
workspace machine, which has no VPN access into the Prolifics network and
can't clone these repos or reach Prolifics' private package registry
itself — first time or the hundredth. Two different machines, two
different scripts, one manual hop between them — do not run both scripts
on the same box:

| | Machine | Does what |
|---|---|---|
| **1.1 Pack** | Prolifics-network machine (VPN-connected) | `scripts/pack.ps1` — the only machine that can `git pull`/`git clone` all four repos and reach the private package registry |
| **1.2 Copy the zip across & unzip** | Corpay AWS workspace machine (receiving) | *(manual - see below)* |
| **1.3 Check/create envconfig.yaml files** | Corpay AWS workspace machine | *(manual - see below)* |
| **1.4 Unpack** | Corpay AWS workspace machine (no VPN at all) | `scripts/unpack.ps1` |

> **Workbench disabled by default (2026-09-25).** The workbench (Toolkit
> Workbench, Knowledge Assistant, connected-ai-dlc-tlc and the offline Python
> bundle) no longer ships. `pack.ps1` now packages `playwright-aidlc` alone,
> and `unpack.ps1` provisions the CLC workspace alone. Everything about the
> workbench below still works, but only behind a switch: `pack.ps1
> -IncludeWorkbench` and `unpack.ps1 -IncludeWorkbench`.

### Step 1.1 — Pack, on the Prolifics-network machine (VPN connected)

Run this **every time** there's new work to hand off, not just once. No
manual `git pull` first - `pack.ps1` does that itself, for all four repos
INCLUDING playwright-aidlc (the one you just `cd`'d into - it's one of the
four, not just the thing running the script), each on whatever branch is
currently checked out, so the zip it produces always reflects whatever is
on this machine right now:

```powershell
cd playwright-aidlc
.\scripts\pack.ps1
# Produces a zip on your Desktop by default - see its own output for the
# exact path. Pulls playwright-aidlc and all three sibling repos to their
# current branch's latest first, and vendors %USERPROFILE%\.aaf\venv /
# \.aaf\capabilities-venv so the Corpay machine doesn't need VPN access for
# those either.
```

### Step 1.2 — Copy the zip across and unzip it, on the Corpay AWS workspace machine

**This is a real, separate step - the zip does not get there on its own.**
Move it across whatever approved transfer path connects the two
environments (e.g. the file-transfer mechanism already used for this
engagement), confirm it landed on the Corpay AWS workspace machine, then
extract it there - Windows' own "Extract All..." is fine, it creates the
right folder for you.

### Step 1.3 — Check/create the envconfig.yaml files, on the Corpay AWS workspace machine

**Do this before running `unpack.ps1` in Step 1.4.** `knowledgeassistant`
builds its LLM agents at startup, before it ever sees a question - with no
real key it fails to start at all, it doesn't just answer badly.

In the folder where you'll keep the `.env.local` file you pass to
`-EnvFile` (pick any folder - e.g. next to the extracted zip), add:

- `knowledgeassistant.envconfig.yaml` - **required**, or the toolkit won't start
- `connected-ai-dlc-tlc.envconfig.yaml` - not required today (it defines no
  LLM agents yet), but fill it in anyway so it's ready as soon as it does

Create each by copying that toolkit's own
`capabilities\config\envconfig.yaml.example` (inside the extracted
`knowledgeassistant\` / `connected-ai-dlc-tlc\` folders) and uncommenting
**one** LLM provider block - `azure_openai`, `openai`, `anthropic`, or
`gemini` - with real values filled in.

If `knowledgeassistant.envconfig.yaml` is missing, `unpack.ps1` falls back
to the unfilled `.example` and `knowledgeassistant` will fail to start -
have the real file ready before moving on.

### Step 1.4 — Unpack, on the Corpay AWS workspace machine (no VPN)

From inside the extracted `playwright-aidlc` folder:

```powershell
npm link       # once per machine — makes `pw-aidlc` global; unpack.ps1 needs this on PATH
powershell -ExecutionPolicy Bypass -File .\scripts\unpack.ps1
```

`-ExecutionPolicy Bypass` is not optional on a locked-down machine: a
default Windows execution policy refuses to run a downloaded `.ps1` at
all, and `.\scripts\unpack.ps1` fails before it does anything. Passing it
this way applies to that one invocation only - it changes no machine
policy and needs no admin rights.

This single command creates the CLC workspace (installing its npm
dependencies, Chromium, and the official planner/generator/healer agents as
part of that - previously separate manual steps, see Step 2.1's own note)
AND brings up the Toolkit Workbench, registers and starts both
`knowledgeassistant` and `connected-ai-dlc-tlc` (restoring each one's
`envconfig.yaml` from Step 1.3 first), and starts connected-ai-dlc-tlc's own
`app-state`/`ui` (the Quality Workbench, showing release health) - ending in
a summary of what came up and what didn't. It does not need VPN access
itself as long as Step 1.1 vendored the AAF framework (the default - only
skipped with `-SkipVendorAaf`).

`-Force` deletes the whole destination workspace before recreating it, so
only use it before any bolt work exists there - e.g. retrying right after a
failed or partial unpack. Once a workspace has real bolt work in it
(`inputs/`, `bolts/`, results), don't re-run this against it - that work
would be deleted along with everything else.

Bolts now call out to `knowledgeassistant` and `connected-ai-dlc-tlc` for
knowledge grounding and release-health reporting — this is the path to get
both, but it is not a hard requirement to run a bolt at all. Both calls are
deliberately non-blocking (real connect-timeout/max-time limits, never
retried): with neither toolkit up, a bolt still plans, generates, runs and
ships normally, it just skips grounding (one line noted in `audit.md`) and
doesn't push results to the release-health rollup. Useful if the toolkit
side is stuck on something (e.g. the offline Python bundle) and there's no
reason to also block the bolt itself on it.

---

## Step 2 — Finish setting up the new workspace (before either bolt)

Continue here once Step 1 is complete.

### Step 2.1 — verify its dependencies installed

`unpack.ps1`'s own step 3a already ran `npm install`, installed Chromium,
and installed the official Playwright agents — this step is now a check,
not an install:

```powershell
cd <the workspace Step 1 just created>
npx pw-aidlc doctor
```

**`doctor` must come back clean (or with only warnings you understand) before
either bolt starts.** If it reports a dead session, a backend outage, or
missing git config, fix that now — it will only be harder to diagnose mid-bolt.

If `doctor` reports node_modules or `.claude\agents` still missing, step 3a
warned about that specific one during unpack (network issue, a slow
registry) — run only that one command by hand, then re-run `doctor`:

```powershell
npm install                                # if node_modules is missing
npx playwright init-agents --loop=claude   # if .claude\agents is missing
```

`doctor` has no dedicated check for whether Chromium itself is installed —
only whether `execution.browsers` and `playwright.config.ts` agree on which
browsers *should* run. A missing Chromium binary surfaces indirectly, as
the seed test failing with `Executable doesn't exist` rather than a normal
assertion failure. If you see that specific error, that's step 3a's
Chromium install having failed or been skipped:

```powershell
npx playwright install chromium
```

### Step 2.2 — open it in your AI-IDE

```powershell
code .
```

---

## Step 3 — Bolt A: bulk generation (run in advance, no time pressure)

**Goal:** finish a real, substantial bolt end-to-end so there's a genuine
finished artifact (PR, results, traceability matrix) to point at during the
demo — not something anyone re-runs live.

**Story: `US-MDUI-CUST-001`** — the FleetNet Customer Create wizard. This is
the largest, most complex bolt seen so far (13 scenarios, a single long
journey test spanning General → Shipping → Volume/Bill/Card Groups →
Financial), which is exactly why it belongs here and not live: in `run-3` it
hit a real backend outage on the Mule account API and a determinism failure
on the second run. Both are already understood and written into
`knowledge/project/` — running it again now should go smoother, but it's
still not something to risk live.

3.1. In your AI-IDE (Claude Code or GitHub Copilot):
   ```
   /bolt US-MDUI-CUST-001
   ```
3.2. Work through the sequence at whatever pace it takes:
   `intake → context → plan → GATE 1 (approve) → generate → run → heal → GATE 2 checklist → ship`
3.3. Confirm it actually finished clean:
   - `results/summary.md` — suite passing, ideally twice in a row (determinism)
   - `docs/traceability-matrix.md` — coverage looks right
   - A PR exists (or, if this workspace stays local, the working tree has
     everything `e2e-ship`'s checklist expects — see `bolts/<ID>/audit.md`)
3.4. **Do not touch this bolt again before the demo.** If something's wrong,
   fix it now, not on demo day.

No timing target here — just needs to be genuinely done and verified before
moving on to Bolt B.

---

## Step 4 — Bolt B: one scenario, fast

**Story:** `US-MDUI-DRV-002` (Driver ID Update) — a real artifact, lands in
`inputs/stories/` automatically.

**Scenario:** search Driver ID by Prompted Id `69977` (an existing driver) →
grid returns exactly one matching row. Read-only, nothing created.

4.1. **Create the intake file BEFORE running the bolt.** `/bolt` does not
generate this for you to edit afterward; without it, `/bolt US-MDUI-DRV-002`
will plan the *whole* story. Copy `bolts/_template.intake.yml` to a new file
at `bolts/US-MDUI-DRV-002/intake.yml` (the folder doesn't exist yet either —
create it) and replace its contents with:

```yaml
bolt_id: "US-MDUI-DRV-002"
intent: "Search Driver ID by Prompted Id narrows the grid to the matching driver"
story_file: "inputs/stories/MDUI_Driver_ID_Update_UserStory.md"
acceptance_criteria:
  - "AC-4: entering a Prompted Id and pressing Search returns exactly one matching row"
max_scenarios: 1
scope:
  routes: ["/employees/98480/customer"]
```

(`scope.source_paths` is left out on purpose — it only narrows a code scan,
and grounding is effectively off right now; see below.)

This scenario hasn't been run under the current environment before (post
storage_state fix) — running it now is how you find out if it's still
clean, not a formality.

`source.path` in `e2e.config.yml` is blank, which means grounding is
effectively `off` regardless of the `scan` setting next to it (the kit's own
rule: a blank source.path always resolves to off) — so **expect the context
step to be skipped and planning to be live-app-only**, the same as every
bolt run so far. If a real checkout of the MDUI frontend is available on
this machine, pointing `source.path` at it would enable faster, code-grounded
planning — but nothing here currently does that, so don't expect it unless
someone sets it up first.

4.2. Now run it:

```
/bolt US-MDUI-DRV-002
```

Reaching Driver IDs goes through the Account & Customer Settings menu, which
is known to hang the AI-IDE's live-exploration step if it drives the menu
one MCP tool call at a time (documented in
`knowledge/project/mdui-known-flaky-areas.md`, which the agent reads at
intake). Nothing for a person to do up front — but if you see it stall on
that exact menu during the session, tell it directly to navigate the menu
as one script rather than step by step, rather than waiting it out.

Confirm: Gate 1's plan is just this one scenario and takes about a minute to
approve, generate+run+heal finish in a few minutes with ideally zero heal
rounds, suite passes clean.
