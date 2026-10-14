<#
.SYNOPSIS
  Unpack a package produced by scripts\pack.ps1 and provision the CLC
  Playwright workspace. By default that is all it does. Pass
  -IncludeWorkbench to also stand up the Toolkit Workbench and the
  Knowledge Assistant / connected-ai-dlc-tlc toolkits (part two below) -
  only from a package that pack.ps1 built with -IncludeWorkbench too.

.DESCRIPTION
  Run this from wherever the package was unzipped on the target machine -
  this script lives at scripts\unpack.ps1, one level under the
  playwright-aidlc repo root, which itself is expected to sit alongside
  three sibling folders (knowledgeassistant, toolkit-workbench,
  connected-ai-dlc-tlc) - exactly the layout scripts\pack.ps1 produces.
  This was formerly named provision-workspace.ps1; everything it used to do
  (steps 1-6 below) still happens exactly as before - this just also brings
  the rest of the environment up afterward (steps 7-11).

  PART ONE - the CLC workspace (unchanged from provision-workspace.ps1):

    1. Creates a new destination workspace folder and git-initializes it.
    2. Runs `pw-aidlc init` there - this is what actually installs the
       generic AI-DLC config: skills\ and commands\ into .claude\, the
       CLAUDE.md kit section, .github\copilot-instructions.md (a pointer to
       CLAUDE.md/.claude\skills for GitHub Copilot, which doesn't auto-load
       either the way Claude Code does), knowledge\org\, a generic
       e2e.config.yml and a stub seed test. Requires `pw-aidlc` on PATH (npm
       link, once per machine, from this repo's root).
    3. Overlays the handful of files that are genuinely CLC-specific and
       that `init` cannot know about: the real e2e.config.yml (actual app
       URL, execution tuning), the real playwright.config.ts (init doesn't
       generate one at all - that normally comes from `npm init playwright`),
       the real tests\seed.spec.ts (the working Okta sign-in logic, replacing
       init's generic stub), .mcp.json and .vscode\mcp.json (the Playwright
       MCP server registration for Claude Code and Copilot respectively -
       also not something init creates; .vscode\mcp.json uses the "servers"
       key VS Code actually reads, not "mcpServers"), this project's own
       package.json, and the whole of clc-framework\ (real, live-verified
       navigation/locator helpers, an auto-sign-in test fixture, known-good
       QA data constants, and an exploration-script harness - see
       clc-framework\README.md - deployed as tests\support\clc.ts,
       tests\support\test.ts, tests\support\fixtures.ts, tests\support\xlsx.ts and
       tests\support\explore-harness.js, so a new workspace's first bolt
       starts from proven code instead of re-deriving sign-in and
       known-hazardous navigation from scratch), and knowledge\project\
       (this project's current, real findings, added alongside the README
       init already wrote there).
    4. Sorts the story/requirement .md files from an artifacts folder into
       inputs\stories and inputs\requirements, if one was supplied - this
       step is skipped, not a failure, when -ArtifactsSource is blank or not
       found (a fresh remote machine typically has no such folder yet).
       Where a .md has its own "images" or "<name>.media" folder alongside
       it, the whole containing folder is copied as one unit, unrenamed, so
       nothing breaks any reference the document's own text makes to that
       folder by name.
    5. Optionally layers in any further knowledge files newer than what's
       currently in this repo's own knowledge\project\.
    6. Copies a pre-filled .env.local into place if -EnvFile was supplied and
       found; otherwise falls back to this repo's own
       templates\env.local.example, so the workspace still has every var
       named (blank) rather than none at all.

  PART TWO - the rest of the environment. OFF by default since 2026-09-25:
  the workbench no longer ships, so these steps run only with
  -IncludeWorkbench. The logic is kept, disabled, rather than deleted.

    7. Validates the local Windows wheel bundle and installs fresh Python
       environments at this machine's own paths, without private-registry
       access. A missing or damaged offline bundle stops setup clearly.
       Then starts the Toolkit Workbench and waits for its API on :8099.
    8. Restores each toolkit's real, pre-filled capabilities\config\
       envconfig.yaml from a backup living in the SAME folder as -EnvFile's
       .env.local (named "<toolkit-folder-name>.envconfig.yaml"), if one is
       there - this is what actually lets the toolkit answer real questions
       with a real LLM key, without that key ever having been inside the
       pack.ps1 zip. Falls back to the toolkit's own .example (a placeholder
       that only satisfies start.bat's mere-existence check) when no backup
       is found. Then registers the sibling knowledgeassistant folder with
       the Workbench (POST /api/toolkits) and starts it
       (POST /api/toolkits/{id}/start) - this runs knowledgeassistant's OWN
       start.bat, which brings up its knowledge-service, agentic-platform
       and aaf-gateway processes.
    9. Registers and starts the sibling connected-ai-dlc-tlc folder the same
       way (same envconfig.yaml restore first) - its own start.bat brings up
       its Python AAF toolkit side.
   10. connected-ai-dlc-tlc's start.bat does NOT start its own Node
       components, so this script does that part directly: `npm install`
       (only if node_modules is missing) then `npm run dev` for both
       app-state (:3202) and ui (:5173) - the actual Quality Workbench UI
       this whole environment is for.
   11. Prints a summary of every phase (workspace, Workbench, each toolkit,
       app-state, ui) with what worked and what didn't, and the URLs to open.
       A phase failing does not abort the ones after it - see each phase's
       own try/catch below; this mirrors PART ONE's own path-not-found
       "warn and skip that step" convention rather than "throw and stop
       everything," since one toolkit failing to start (e.g. invalid toolkit config)
       should never prevent the rest of the environment from coming up.

  Pass -SkipWorkspace to skip part one entirely (steps 1-6) - useful on a
  repeat run where the CLC workspace already exists and only the toolkit
  environment needs restarting (with -IncludeWorkbench). Part two (steps
  7-10b) is skipped unless -IncludeWorkbench is passed; -SkipToolkits still
  skips it even then.

  Every path below has a default. Press Enter at each prompt to accept it,
  or type a different path. Re-run with -Destination pointing at a different
  leaf folder (e.g. ...\CLC\CC vs ...\CLC\GHC) to provision a second
  workspace for a different AI-IDE loop from the same sources.

  Keep this repo's own overlay files (knowledge\project\, clc-framework\,
  e2e.config.yml, playwright.config.ts, tests\seed.spec.ts, .mcp.json) current as new
  findings come in - that's what every future workspace provisioned from it
  starts with. Don't edit a deployed workspace's copy and expect it to flow
  back here; it won't.

  Every example below runs from the playwright-aidlc repo root (the folder
  holding this script's own scripts\ folder), which is also where `npm link`
  has to run, so both steps happen in one place. Nothing here reads the
  current directory - paths resolve from the script's own location - so the
  repo root is a convention, not a requirement.

  -ExecutionPolicy Bypass is part of the command, not an optional extra: a
  default Windows execution policy refuses to run a .ps1 that arrived in a
  zip from another machine, and a bare .\scripts\unpack.ps1 dies before it
  does anything. Passed this way it applies to that single invocation, and
  changes no machine-wide policy and needs no admin rights.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\unpack.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\unpack.ps1 -Destination "D:\ai-dlc-workspaces\CLC\GHC" -NonInteractive

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\unpack.ps1 -IncludeWorkbench -SkipWorkspace
  # Just (re)start the Toolkit Workbench, both toolkits, and the Quality
  # Workbench UI - skip creating a new CLC Playwright workspace. Needs a
  # package built with pack.ps1 -IncludeWorkbench.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\unpack.ps1 -EnvFile "D:\handoff\Environment_Config_Files\.env.local"
  # Same folder is checked for knowledgeassistant.envconfig.yaml and
  # connected-ai-dlc-tlc.envconfig.yaml backups - see Confirm-ToolkitEnvConfig
  # in part two.
#>

param(
  [string]$ConfigSource     = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  # Optional - blank or not found just skips step 4 (story/requirement
  # sorting), it is not an error. A fresh unpackaged environment typically
  # has no such folder yet; add stories to inputs\stories by hand instead.
  [string]$ArtifactsSource  = '',
  # Optional - knowledge/project already ships in this repo. Only needed if
  # you have findings newer than what's currently here. Leave blank (or
  # decline when prompted) to skip this step entirely.
  [string]$KnowledgeSource  = '',
  # Optional - blank or not found falls back to this repo's own
  # templates\env.local.example (every var named, none filled in) rather
  # than failing step 6.
  [string]$EnvFile          = '',
  [string]$Destination      = (Join-Path $HOME 'ai-dlc-workspaces\CLC'),
  [switch]$Force,
  [switch]$NonInteractive,
  # Skip part one (steps 1-6, the CLC workspace) entirely.
  [switch]$SkipWorkspace,
  # Part two (steps 7-10b: Workbench + toolkits + app-state/ui) is OFF by
  # default - the workbench no longer ships. Pass this to turn it back on;
  # the package must then contain the three sibling repos (pack.ps1
  # -IncludeWorkbench).
  [switch]$IncludeWorkbench,
  # Skip part two even with -IncludeWorkbench. Kept so existing command
  # lines that pass it still work.
  [switch]$SkipToolkits,
  # Workbench API base URL - override only if it's already running somewhere
  # other than the default local port.
  [string]$WorkbenchUrl     = 'http://localhost:8099'
)

$ErrorActionPreference = 'Stop'

# Part two runs only when asked for and not also skipped. Everything below
# reads $RunToolkits, never the two switches directly.
$RunToolkits = $IncludeWorkbench -and -not $SkipToolkits

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "  !   $msg" -ForegroundColor Yellow }
function Fail($msg)     { Write-Host "  X   $msg" -ForegroundColor Red }

# --- prompt-with-default, so every path can be accepted or overridden ------
function Read-PathWithDefault($label, $default) {
  $answer = Read-Host "$label [$default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
  return $answer
}

function Confirm-SourceExists($label, $path) {
  while (-not (Test-Path $path)) {
    Fail "$label not found: $path"
    $path = Read-Host "Re-enter path for $label (or leave blank to abort)"
    if ([string]::IsNullOrWhiteSpace($path)) { throw "Aborted - $label is required." }
  }
  return $path
}

# --- run a native command with the same 'stderr is not failure, exit code
# is' handling the pw-aidlc init call below needs, reused for every npm/git
# call in part two so a harmless warning on stderr can never abort the
# script under $ErrorActionPreference = 'Stop'. ---------------------------
function Invoke-NativeCommand([scriptblock]$Command, [string]$FailureMessage) {
  $prevEAP = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | ForEach-Object { Write-Host "    $_" }
  } finally {
    $ErrorActionPreference = $prevEAP
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit $LASTEXITCODE)"
  }
}

# --- one-shot "is this already up" probe, distinct from Wait-ForHttp below
# (which polls and warns on failure) - used to decide whether to spawn a new
# process at all, so re-running this script against an already-running
# app-state/ui doesn't start a second copy fighting the first one for the
# same port. ------------------------------------------------------------
function Test-HttpUp([string]$Url) {
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
  } catch {
    return $false
  }
}

# --- poll a URL until it answers 2xx, or give up after $TimeoutSec --------
function Wait-ForHttp([string]$Url, [int]$TimeoutSec, [string]$Label) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) { return $true }
    } catch {
      # Not up yet (connection refused, still starting) - keep polling.
    }
    Start-Sleep -Seconds 2
  }
  Warn "$Label did not answer at $Url within $TimeoutSec s"
  return $false
}

# --- results table for the final summary in step 11 ------------------------
$PhaseResults = New-Object System.Collections.ArrayList
function Record-Phase([string]$Name, [bool]$Success, [string]$Detail) {
  [void]$PhaseResults.Add([PSCustomObject]@{ Phase = $Name; Success = $Success; Detail = $Detail })
}

Write-Host "AI-DLC Workbench - unpack and start" -ForegroundColor Cyan

# --- resolve EnvFile up front, regardless of -SkipWorkspace ----------------
# Part One (below) uses it directly for .env.local; part two also needs it,
# via BackupConfigDir, to find each toolkit's own pre-filled envconfig.yaml
# backup - both live in the same handoff folder, so this can't be resolved
# only inside the part-one block the way it used to be.
if (-not $NonInteractive) {
  $EnvFile = Read-PathWithDefault 'Pre-filled .env.local file (also where each toolkit''s backup envconfig.yaml lives) - blank to use this repo''s template instead' $EnvFile
}
$hasEnvFile = -not [string]::IsNullOrWhiteSpace($EnvFile)
if ($hasEnvFile -and (Test-Path $EnvFile -PathType Container)) {
  # A very easy mistake: the prompt above asks for the handoff FOLDER's
  # .env.local FILE, but the folder itself is also a perfectly reasonable
  # answer to "where do your pre-filled files live" - so accept it instead
  # of failing much later with Copy-Item's own cryptic "Container cannot
  # be copied onto existing leaf item" once part two tries to use it.
  $candidate = Join-Path $EnvFile '.env.local'
  if (Test-Path $candidate -PathType Leaf) {
    Warn "$EnvFile is a folder - using $candidate instead"
    $EnvFile = $candidate
  }
}
if ($hasEnvFile -and -not (Test-Path $EnvFile -PathType Leaf)) {
  Warn ".env.local source file not found: $EnvFile - will use this repo's templates\env.local.example instead, and no toolkit envconfig.yaml backups will be used either"
  $hasEnvFile = $false
}
# The same folder that holds the pre-filled .env.local is where real,
# already-filled-in envconfig.yaml backups for each toolkit are expected -
# see Confirm-ToolkitEnvConfig in part two. $null (not found) when there is
# no EnvFile at all, in which case part two falls back to each toolkit's own
# .example placeholder, same as before.
$BackupConfigDir = if ($hasEnvFile) { Split-Path $EnvFile -Parent } else { $null }

# =============================================================================
# PART ONE - the CLC workspace (steps 1-6, unchanged behavior from
# provision-workspace.ps1 except that ArtifactsSource/EnvFile are now
# optional - see the param block comments above).
# =============================================================================
if (-not $SkipWorkspace) {
  # Everything in Part One - the interactive prompts and every pre-flight
  # check below, not just steps 1-6 - is inside ONE try/catch, so a bad
  # -ConfigSource, a missing pw-aidlc, or declining to overwrite an existing
  # -Destination records a failed 'CLC workspace' phase and lets Part Two
  # still run, instead of an uncaught throw (or the old standalone script's
  # own `exit 1`, replaced below with `throw` for the same reason) killing
  # the whole process before Part Two ever gets a chance.
  try {
    if (-not $NonInteractive) {
      Write-Host "Each value below shows its default in [brackets] - press Enter to accept it, or type a different path (blank where noted to skip that step).`n" -ForegroundColor DarkGray
      $ConfigSource    = Read-PathWithDefault 'AI-DLC config source (this repo root)' $ConfigSource
      $ArtifactsSource = Read-PathWithDefault 'Artifacts folder (stories + business process flows) - blank to skip' $ArtifactsSource
      $KnowledgeSource = Read-PathWithDefault 'Additional knowledge files folder (blank to skip - knowledge/project already ships in this repo)' $KnowledgeSource
      $Destination     = Read-PathWithDefault 'New workspace destination' $Destination
    }

    $ConfigSource = (Confirm-SourceExists 'AI-DLC config source' $ConfigSource)

    # Optional, same "blank/missing just skips the step" treatment as
    # KnowledgeSource already had - a fresh unpackaged environment typically
    # has neither of these yet.
    $hasArtifactsSource = -not [string]::IsNullOrWhiteSpace($ArtifactsSource)
    if ($hasArtifactsSource -and -not (Test-Path $ArtifactsSource)) {
      Warn "Artifacts folder not found: $ArtifactsSource - skipping step 4 (story/requirement sorting)"
      $hasArtifactsSource = $false
    }

    foreach ($f in @('e2e.config.yml', 'playwright.config.ts', '.mcp.json', 'clc.package.json')) {
      if (-not (Test-Path (Join-Path $ConfigSource $f))) {
        throw "$ConfigSource does not look like the playwright-aidlc repo root (expected $f there)."
      }
    }

    if (-not (Get-Command pw-aidlc -ErrorAction SilentlyContinue)) {
      throw "'pw-aidlc' is not on PATH. Run once per machine, from $ConfigSource :  npm link"
    }

    # Optional, unlike ArtifactsSource/EnvFile above - blank or missing just
    # means "nothing newer than what's already here," not an error.
    $hasKnowledgeSource = -not [string]::IsNullOrWhiteSpace($KnowledgeSource)
    if ($hasKnowledgeSource -and -not (Test-Path $KnowledgeSource)) {
      Warn "additional knowledge folder not found: $KnowledgeSource - skipping step 5"
      $hasKnowledgeSource = $false
    }

    if (Test-Path $Destination) {
      if ($Force) {
        Warn "Destination already exists: $Destination - removing it (-Force)"
        Remove-Item -Path $Destination -Recurse -Force
      } elseif ($NonInteractive) {
        # No prompt possible here - fail rather than silently delete something
        # in a scripted run with nobody watching.
        throw "Destination already exists: $Destination - re-run with -Force to delete it and provision anyway, or pick a new folder."
      } else {
        Fail "Destination already exists: $Destination"
        $answer = Read-Host "  Delete it and continue? (y/N)"
        if ($answer -match '^[Yy]') {
          Remove-Item -Path $Destination -Recurse -Force
          Ok "existing destination removed"
        } else {
          throw "Aborted - pick a different -Destination and re-run."
        }
      }
    }

    # --- 1. workspace folder -------------------------------------------------
    Step 1 "Creating workspace: $Destination"
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Ok "folder created"

    # --- 2. generic AI-DLC scaffolding, via the kit's own installer ----------
    Step 2 "Running pw-aidlc init"
    Push-Location $Destination
    try {
      git init | Out-Null
      $initArgs = @('init', 'CLC', '--mode', 'brownfield', '--type', 'webapp', '--yes')
      if ($Force) { $initArgs += '--force' }
      # Captured, not streamed: `init` prints its own "Next, in order"
      # guidance (drop a story into inputs/stories, make seed.spec.ts real,
      # ...) which step 3 below immediately does for real - showing it here
      # reads as contradictory instructions in the middle of this script's
      # own narrative. On success this repeats none of that; on failure, the
      # real output is exactly what's needed to debug it, so it's shown then
      # and only then.
      #
      # $ErrorActionPreference is set to 'Continue' for just this call: with
      # 'Stop' (the script-wide default) still active, 2>&1 on a native
      # command turns the first stderr line - even a harmless npx/Node
      # notice, nothing to do with whether init actually succeeded - into a
      # terminating error, aborting here despite a real exit code of 0.
      # $LASTEXITCODE below is the actual, reliable success/failure signal.
      $prevEAP = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $initOutput = & pw-aidlc @initArgs 2>&1
      } finally {
        $ErrorActionPreference = $prevEAP
      }
      if ($LASTEXITCODE -ne 0) {
        $initOutput | ForEach-Object { Write-Host $_ }
        throw "pw-aidlc init failed (exit $LASTEXITCODE)"
      }
    } finally {
      Pop-Location
    }
    Ok "skills, commands, CLAUDE.md, knowledge\org, generic e2e.config.yml and a seed-test stub scaffolded"

    # --- 3. the CLC-specific overlay -----------------------------------------
    # The handful of files `init` either can't know the real values for
    # (e2e.config.yml, playwright.config.ts, seed.spec.ts) or doesn't create
    # at all (.mcp.json, package.json). Each is a straight overwrite/add, not
    # a tree copy - small and easy to keep correct as this list changes.
    Step 3 "Overlaying CLC-specific config from $ConfigSource"
    Copy-Item -Path (Join-Path $ConfigSource 'e2e.config.yml')      -Destination (Join-Path $Destination 'e2e.config.yml') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'playwright.config.ts') -Destination (Join-Path $Destination 'playwright.config.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'tests\seed.spec.ts')   -Destination (Join-Path $Destination 'tests\seed.spec.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource '.mcp.json')            -Destination (Join-Path $Destination '.mcp.json') -Force
    New-Item -ItemType Directory -Path (Join-Path $Destination '.vscode') -Force | Out-Null
    Copy-Item -Path (Join-Path $ConfigSource '.vscode\mcp.json')     -Destination (Join-Path $Destination '.vscode\mcp.json') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'clc.package.json')     -Destination (Join-Path $Destination 'package.json') -Force
    New-Item -ItemType Directory -Path (Join-Path $Destination 'tests\support') -Force | Out-Null
    Copy-Item -Path (Join-Path $ConfigSource 'clc-framework\support\clc.ts')        -Destination (Join-Path $Destination 'tests\support\clc.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'clc-framework\support\test.ts')       -Destination (Join-Path $Destination 'tests\support\test.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'clc-framework\support\fixtures.ts')   -Destination (Join-Path $Destination 'tests\support\fixtures.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'clc-framework\support\xlsx.ts')       -Destination (Join-Path $Destination 'tests\support\xlsx.ts') -Force
    Copy-Item -Path (Join-Path $ConfigSource 'clc-framework\explore-harness.js')    -Destination (Join-Path $Destination 'tests\support\explore-harness.js') -Force

    # knowledge\project\ - init already wrote a generic README.md there; add
    # this project's real findings alongside it without disturbing it.
    $knowledgeProjectSource = Join-Path $ConfigSource 'knowledge\project'
    $knowledgeProjectDest   = Join-Path $Destination 'knowledge\project'
    Get-ChildItem -Path $knowledgeProjectSource -File | ForEach-Object {
      Copy-Item -Path $_.FullName -Destination $knowledgeProjectDest -Force
    }
    Ok "e2e.config.yml, playwright.config.ts, seed test, .mcp.json, .vscode\mcp.json, package.json, clc-framework (clc.ts, test.ts, fixtures.ts, xlsx.ts, explore-harness.js) and knowledge\project overlaid"

    # --- 3a. install dependencies, Chromium and the official Playwright agents -
    # Previously left as "Next steps" for a human to run after this script
    # finished, printed below - and skipped often enough in practice that
    # every real bolt audited so far (run-1 through run-4) hit "npm install
    # had never been run" fresh in its own preflight, several confused
    # minutes each time before pw-aidlc doctor's own node_modules check
    # (added after run-4) started naming it directly. Automating it here
    # removes the detour entirely instead of just diagnosing it faster.
    #
    # Order matters for two separate reasons:
    #  - npm install needs the REAL package.json (clc.package.json, just
    #    copied above at step 3) - running it any earlier would install
    #    against pw-aidlc init's generic one instead.
    #  - init-agents overwrites tests\seed.spec.ts with its own stub
    #    (confirmed live, bolt US-CLC-001, "CLC_21_09" run, 2026-09-21 - a
    #    real credential-smoke seed silently replaced, then "passing" in
    #    1.3s asserting nothing). Re-copying the real seed.spec.ts
    #    immediately afterward - not merely running init-agents before step 3
    #    and hoping the ordering holds forever - is what actually guarantees
    #    the real seed always wins, regardless of what init-agents does.
    #
    # None of the three is fatal to this phase: each already had a documented
    # manual fallback (the "Next steps" block below), so a transient failure
    # here (no network, a slow registry) degrades to that instead of failing
    # workspace provisioning outright.
    Step "3a" "Installing dependencies, Chromium and the official Playwright agents"
    Push-Location $Destination
    try {
      $npmInstallOk = $true
      if (-not (Test-Path (Join-Path $Destination 'node_modules'))) {
        try {
          Invoke-NativeCommand { npm install } "npm install failed"
          Ok "npm install complete"
        } catch {
          $npmInstallOk = $false
          Warn "npm install failed: $($_.Exception.Message) - run it manually before the first bolt (see 'Next steps' below)"
        }
      } else {
        Ok "node_modules already present - skipped"
      }

      # Both commands below resolve the LOCAL playwright install
      # (node_modules\.bin\playwright) - the one whose version this project
      # actually pins. Without node_modules, npx would instead try to fetch
      # a temporary copy of the playwright package itself to run either
      # subcommand, which can prompt for confirmation on some npm/npx
      # versions - fine for a human running this by hand, not safe to risk
      # in this non-interactive script. Skip both rather than gamble on it.
      if ($npmInstallOk) {
        try {
          Invoke-NativeCommand { npx playwright install chromium } "playwright install chromium failed"
          Ok "Chromium installed"
        } catch {
          Warn "npx playwright install chromium failed: $($_.Exception.Message) - run it manually before the first bolt (see 'Next steps' below)"
        }

        if (-not (Test-Path (Join-Path $Destination '.claude\agents'))) {
          try {
            Invoke-NativeCommand { npx playwright init-agents --loop=claude } "playwright init-agents failed"
            Ok "planner/generator/healer agents installed"
          } catch {
            Warn "npx playwright init-agents --loop=claude failed: $($_.Exception.Message) - run it manually before the first bolt (see 'Next steps' below)"
          }
        } else {
          Ok ".claude\agents already present - skipped"
        }
      } else {
        Warn "Chromium install and init-agents both skipped - npm install did not complete, so npx would resolve neither from a pinned local copy (see 'Next steps' below to run all three by hand once npm install succeeds)"
      }
    } finally {
      Pop-Location
    }
    # Guaranteed last, regardless of whether init-agents ran, failed, or was
    # skipped above - the one line that actually makes the ordering safe,
    # rather than trusting init-agents never to have run at all.
    Copy-Item -Path (Join-Path $ConfigSource 'tests\seed.spec.ts') -Destination (Join-Path $Destination 'tests\seed.spec.ts') -Force
    Ok "real tests\seed.spec.ts re-asserted after init-agents (never trust its own stub to have survived)"

    # --- 4. sort artifacts into stories vs requirements, if supplied ---------
    Step 4 "Sorting artifacts"
    if ($hasArtifactsSource) {
      Write-Host "  from $ArtifactsSource"
      $storyCount = 0
      $reqCount = 0
      Get-ChildItem -Path $ArtifactsSource -Recurse -Filter '*.md' | ForEach-Object {
        $isStory = $_.Name -match 'UserStory'
        $destDir = if ($isStory) { Join-Path $Destination 'inputs\stories' } else { Join-Path $Destination 'inputs\requirements' }

        # Some artifacts are a bare .md; others sit in their own folder
        # alongside an "images" (or "<name>.media") subfolder holding the
        # document's screenshots. When one exists, copy the WHOLE containing
        # folder as a single unit rather than the .md alone - never rename or
        # separate the images folder from it. Confirmed why this matters: a
        # converted doc's own text can embed the images folder's literal
        # name/path inline (e.g. "open `<name>.media/image-01.png`"), so
        # moving the .md without its folder, or renaming that folder,
        # silently breaks those references.
        $siblingImages = Get-ChildItem -Path $_.DirectoryName -Directory -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -eq 'images' -or $_.Name -like '*.media' }

        if ($siblingImages) {
          # Guard against a folder shared by more than one .md - copying the
          # whole folder would then pull in an unrelated artifact too. Only
          # seen so far as one .md per images-bearing folder, but check
          # rather than assume.
          $mdSiblingCount = (Get-ChildItem -Path $_.DirectoryName -Filter '*.md' -File).Count
          if ($mdSiblingCount -eq 1) {
            $folderName = Split-Path $_.DirectoryName -Leaf
            $dest = Join-Path $destDir $folderName
            if (Test-Path $dest) {
              Warn "$folderName already copied from another artifact folder - overwriting, check both are actually the same content"
            }
            Copy-Item -Path $_.DirectoryName -Destination $dest -Recurse -Force
          } else {
            Warn "$($_.Name) shares its folder with $($mdSiblingCount - 1) other .md file(s) plus an images folder - copying the .md alone; move its images manually"
            if (Test-Path (Join-Path $destDir $_.Name)) {
              Warn "$($_.Name) already copied from another subfolder - overwriting, check both are actually the same content"
            }
            Copy-Item -Path $_.FullName -Destination $destDir -Force
          }
        } else {
          if (Test-Path (Join-Path $destDir $_.Name)) {
            Warn "$($_.Name) already copied from another subfolder - overwriting, check both are actually the same content"
          }
          Copy-Item -Path $_.FullName -Destination $destDir -Force
        }
        if ($isStory) { $storyCount++ } else { $reqCount++ }
      }
      if ($storyCount -eq 0) { Warn "no file matched 'UserStory' in its name - check inputs\stories manually" }
      Ok "$storyCount story file(s) -> inputs\stories, $reqCount requirement file(s) -> inputs\requirements"
    } else {
      Ok "no artifacts folder supplied - skipped; add stories to inputs\stories manually"
    }

    # --- 5. additional knowledge files, if any -------------------------------
    Step 5 "Additional knowledge files"
    if ($hasKnowledgeSource) {
      Write-Host "  layering in updates from $KnowledgeSource"
      $kFiles = Get-ChildItem -Path $KnowledgeSource -File
      foreach ($f in $kFiles) {
        if (Test-Path (Join-Path $knowledgeProjectDest $f.Name)) {
          Warn "$($f.Name) overwrites a file that shipped with the repo - make sure this copy is actually newer"
        }
        Copy-Item -Path $f.FullName -Destination $knowledgeProjectDest -Force
      }
      Ok "$($kFiles.Count) file(s) layered into knowledge\project"
    } else {
      Ok "none supplied - using knowledge\project as shipped in this repo"
    }

    # --- 6. environment file - supplied, or this repo's own template --------
    Step 6 "Copying environment file"
    if ($hasEnvFile) {
      Copy-Item -Path $EnvFile -Destination (Join-Path $Destination '.env.local') -Force
      Ok ".env.local copied from $EnvFile"
    } else {
      $templateEnvFile = Join-Path $ConfigSource 'templates\env.local.example'
      if (Test-Path $templateEnvFile) {
        Copy-Item -Path $templateEnvFile -Destination (Join-Path $Destination '.env.local') -Force
        Ok ".env.local created from templates\env.local.example - every var is named but blank; fill in real values before running a bolt that needs them"
      } else {
        Warn "no .env.local source supplied and no template found at $templateEnvFile - create $Destination\.env.local manually"
      }
    }
    Warn "never commit .env.local - confirm it's listed in .gitignore before this workspace's first commit"

    Write-Host "`nWorkspace ready: $Destination" -ForegroundColor Green
    Write-Host @"

Next, from inside that folder:
  1. git remote add origin <url>   and set your git user.name / user.email
     (skip only if this will stay a local-only workspace)
  2. npx pw-aidlc doctor   (step 3a above already ran npm install, installed
     Chromium, and installed the official planner/generator/healer agents -
     doctor confirms all three landed rather than re-running them; if step 3a
     warned about any of the three, run the matching one by hand first -
     npm install, or npx playwright install chromium, or
     npx playwright init-agents --loop=claude)
  3. code .   then in Claude Code:  /bolt <STORY-ID>

"@
    Record-Phase 'CLC workspace' $true $Destination
  } catch {
    Fail "CLC workspace provisioning failed: $($_.Exception.Message)"
    Record-Phase 'CLC workspace' $false $_.Exception.Message
  }
} else {
  Write-Host "`nSkipping part one (CLC workspace) - (-SkipWorkspace)" -ForegroundColor DarkGray
}

# =============================================================================
# PART TWO - Toolkit Workbench, both toolkits, and connected-ai-dlc-tlc's
# own app-state/ui. Every phase below is wrapped in its own try/catch and
# recorded independently in $PhaseResults - one phase failing (e.g. invalid config
# yet for a toolkit's first-run package install) never stops the rest from
# being attempted, the same "warn and move on" spirit as part one's
# optional-source handling above.
# =============================================================================
if ($RunToolkits) {

  # Siblings of this repo (ConfigSource), exactly the layout pack.ps1
  # produces: <common parent>\playwright-aidlc, \toolkit-workbench,
  # \knowledgeassistant, \connected-ai-dlc-tlc.
  $SiblingRoot            = (Resolve-Path (Join-Path $ConfigSource '..')).Path
  $ToolkitWorkbenchDir    = Join-Path $SiblingRoot 'toolkit-workbench'
  $KnowledgeAssistantDir  = Join-Path $SiblingRoot 'knowledgeassistant'
  $ConnectedAiDlcTlcDir   = Join-Path $SiblingRoot 'connected-ai-dlc-tlc'

  Step 7 "Validating/installing the local Python package bundle"
  $offlineMarker = Join-Path $KnowledgeAssistantDir '.aaf-offline'
  $offlineManifest = Join-Path $SiblingRoot 'vendor\aaf\manifest.json'
  if ((Test-Path $offlineMarker) -or (Test-Path $offlineManifest)) {
    $offlineHelper = Join-Path $ConfigSource 'scripts\offline_aaf.py'
    if (-not (Test-Path $offlineHelper)) { throw "Offline setup helper is missing; re-extract the package." }
    & python $offlineHelper prepare --root $SiblingRoot
    if ($LASTEXITCODE -ne 0) {
      throw "Offline Python setup failed. Fix the reported bundle/Python mismatch before starting toolkits; do not use VPN as a workaround."
    }
    Ok "Offline Python runtime validated. Each toolkit launcher uses this bundle directly."
  } elseif ((Test-Path (Join-Path $SiblingRoot 'vendor\aaf-venv')) -or (Test-Path (Join-Path $SiblingRoot 'vendor\aaf-capabilities-venv'))) {
    throw "This package contains copied Python environments, which are not portable. Rebuild it with the updated pack.ps1."
  } else {
    Warn "No offline Python bundle: this is an online-only checkout/package. Toolkit setup requires private-registry access."
  }

  # --- ensure a toolkit can pass its own start.bat's config preflight -------
  # Three sources, in preference order: (1) already in place - never
  # overwritten; (2) a real, pre-filled backup living in $BackupConfigDir
  # (the same handoff folder as .env.local), named "<Label>.envconfig.yaml" -
  # this is what actually lets the toolkit answer real questions, since it
  # carries a real LLM provider key without one ever having to be baked into
  # the pack.ps1 zip; (3) the toolkit's own .example, a placeholder that
  # satisfies start.bat's mere-existence preflight, but nothing more.
  #
  # That placeholder is only harmless for a toolkit with no LLM agents
  # defined (connected-ai-dlc-tlc's agents.yaml today: "agents: []"). For
  # knowledgeassistant, whose agents.yaml defines real OpenAI-backed agents,
  # it is NOT harmless: those agents are built eagerly when the toolkit's
  # agentic-platform process starts (not lazily on first question), and
  # building one with no api_key raises immediately - confirmed by reading
  # agentic_platform's own OpenAI_agent.py and platform_bootstrap.py.
  # So a placeholder envconfig.yaml means knowledgeassistant fails to start
  # at all, not "starts but can't answer" - warn accordingly.
  function Confirm-ToolkitEnvConfig([string]$ToolkitDir, [string]$Label, [string]$BackupConfigDir) {
    $envConfigPath = Join-Path $ToolkitDir 'capabilities\config\envconfig.yaml'
    if (Test-Path $envConfigPath) {
      Ok "$Label already has capabilities\config\envconfig.yaml"
      Record-Phase "$Label envconfig.yaml" $true 'already present'
      return
    }

    if ($BackupConfigDir) {
      $backupPath = Join-Path $BackupConfigDir "$Label.envconfig.yaml"
      if (Test-Path $backupPath) {
        New-Item -ItemType Directory -Path (Split-Path $envConfigPath -Parent) -Force | Out-Null
        Copy-Item -Path $backupPath -Destination $envConfigPath -Force
        Ok "$Label : capabilities\config\envconfig.yaml restored from backup ($backupPath) - real connection details, ready to use"
        Record-Phase "$Label envconfig.yaml" $true "restored from $backupPath"
        return
      }
      # Confirmed real mistake, not hypothetical: Windows can hide a
      # trailing extension in Explorer, so a file that LOOKS like exactly
      # "$Label.envconfig.yaml" there can actually be
      # "$Label.envconfig.yaml.yaml" on disk - an exact Test-Path miss
      # with nothing to show why. A same-named-but-not-quite match is
      # worth calling out by name rather than only failing generically
      # below.
      $nearMiss = @(Get-ChildItem -Path $BackupConfigDir -Filter "$Label.envconfig.yaml*" -File -ErrorAction SilentlyContinue)
      if ($nearMiss.Count -gt 0) {
        Fail "$Label : found $($nearMiss.Name -join ', ') in $BackupConfigDir, but not the exact name '$Label.envconfig.yaml' this script requires - check for a hidden double extension (Explorer often hides the true last one) and rename it, then re-run"
        Record-Phase "$Label envconfig.yaml" $false "near-miss in $BackupConfigDir - see warning above"
        return
      }
    }

    $examplePath = Join-Path $ToolkitDir 'capabilities\config\envconfig.yaml.example'
    if (Test-Path $examplePath) {
      Copy-Item -Path $examplePath -Destination $envConfigPath -Force
      $backupHint = if ($BackupConfigDir) { "no backup found at $BackupConfigDir\$Label.envconfig.yaml either - " } else { '' }
      if ($Label -eq 'knowledgeassistant') {
        Fail "$Label had no capabilities\config\envconfig.yaml - $($backupHint)created a placeholder from its .example, but this toolkit builds its LLM agents at startup and WILL FAIL TO START with no real key. Add a real one and re-run, or start it will not."
        Record-Phase "$Label envconfig.yaml" $false 'placeholder only - no real LLM key, this toolkit will fail to start'
      } else {
        Warn "$Label had no capabilities\config\envconfig.yaml - $($backupHint)created a placeholder from its .example so it can start. Edit it with a real LLM provider key once it defines agents that need one; today it defines none, so this placeholder is harmless."
        Record-Phase "$Label envconfig.yaml" $true 'placeholder - harmless today, no agents need a key yet'
      }
    } else {
      Fail "$Label has no capabilities\config\envconfig.yaml, no backup, and no .example - it may refuse to start until you create one"
      Record-Phase "$Label envconfig.yaml" $false 'no config, no backup, no .example'
    }
  }

  # --- keep agents.yaml on the same LLM provider as envconfig.yaml ----------
  # Confirm-ToolkitEnvConfig above puts the real envconfig.yaml (which
  # credential exists) in place, but which LLM *client class* each agent loads
  # lives in a different file - capabilities\config\agents.yaml - and that file
  # ships in the pack.ps1 zip verbatim from the knowledgeassistant checkout. If
  # the two disagree the toolkit does not "start but stay quiet"; it fails to
  # start at all: platform_bootstrap.py builds every agent eagerly, and
  # OpenAI_agent.py's __init__ raises immediately when it can't find
  # OPENAI_API_KEY (the same eager-build fact PKG-2's notes and DEMO-RUNBOOK
  # already record). That is exactly what a re-unpack hit: agents.yaml pinned
  # all three agents to OpenAI_agent:OpenAIAgent while the only credential
  # present was the azure_openai block, so agentic-platform died at boot and
  # had to be hand-patched on the target machine.
  #
  # This reconciles the two automatically. When the in-place envconfig.yaml has
  # an active azure_openai block and no active openai block, and agents.yaml
  # still loads the OpenAI client, rewrite it to the Azure client and convert
  # each agent's `model:` (an OpenAI-platform model name) into the
  # `deployment_name:` Azure addresses models by - the identical edit made by
  # hand on the target, now done at unpack time so it never regresses.
  # Idempotent: a no-op once agents.yaml already loads the Azure client, and a
  # no-op for a genuine OpenAI setup (openai block active), so it never fights a
  # correct config. Never fatal - warns and leaves the file untouched on any
  # problem, the same warn-and-continue spirit as the rest of part two.
  function Confirm-ToolkitAgentsProvider([string]$ToolkitDir, [string]$Label) {
    $configDir  = Join-Path $ToolkitDir 'capabilities\config'
    $envPath    = Join-Path $configDir 'envconfig.yaml'
    $agentsPath = Join-Path $configDir 'agents.yaml'
    if (-not (Test-Path $agentsPath)) {
      Warn "$Label has no capabilities\config\agents.yaml - nothing to reconcile"
      return
    }
    if (-not (Test-Path $envPath)) {
      # No envconfig at all: Confirm-ToolkitEnvConfig already warned about that,
      # and without it there is no way to know which provider to target - so
      # leave agents.yaml alone rather than guess.
      return
    }

    # An "active" provider is a non-commented top-level block. `^\s*openai\s*:`
    # deliberately does NOT match `azure_openai:` (the first non-space token
    # there is `azure_`, not `openai`), so the two are told apart cleanly.
    $envLines     = Get-Content -Path $envPath
    $azureActive  = $false
    $openaiActive = $false
    foreach ($line in $envLines) {
      if ($line -match '^\s*#') { continue }
      if ($line -match '^\s*azure_openai\s*:') { $azureActive  = $true }
      elseif ($line -match '^\s*openai\s*:')   { $openaiActive = $true }
    }
    if (-not $azureActive -or $openaiActive) {
      # Either Azure is not the configured provider, or a real OpenAI setup is
      # active - in both cases agents.yaml's own class is (or should be) right.
      return
    }

    $agents = Get-Content -Path $agentsPath -Raw
    if ($agents -notmatch 'OpenAI_agent:OpenAIAgent') {
      Ok "$Label : agents.yaml already matches the azure_openai provider - no change"
      return
    }

    # The deployment name Azure addresses models by. Prefer one the envconfig's
    # own azure_openai block already names; fall back to this environment's one
    # known deployment (qf-gpt-4o) with a clear warning, so a missing field
    # degrades to "probably right" rather than "definitely broken at boot".
    $deployment = $null
    $inAzure    = $false
    foreach ($line in $envLines) {
      if ($line -match '^\s*#') { continue }
      if ($line -match '^\s*azure_openai\s*:') { $inAzure = $true; continue }
      if ($inAzure) {
        if ($line -match '^\S') { break }   # next top-level key ends the block
        if ($line -match '^\s*(deployment_name|azure_deployment|deployment)\s*:\s*["'']?([^"''\r\n#]+)') {
          $deployment = $matches[2].Trim()
          break
        }
      }
    }
    if (-not $deployment) {
      $deployment = 'qf-gpt-4o'
      Warn "$Label : envconfig.yaml's azure_openai block names no deployment - defaulting agents.yaml to '$deployment' (this environment's known deployment); edit agents.yaml if your Azure resource uses a different one"
    }

    # Token-level replacements only, so existing CRLF line endings and the rest
    # of the file stay byte-for-byte intact (a whole-file rewrite here once
    # turned a 4-line diff into a 362-line one on the target machine). The
    # `model:` match anchors on the exact token, so `default_model:` /
    # commented `# model:` lines are left alone.
    $updated = $agents -replace 'OpenAI_agent:OpenAIAgent', 'AzureOpenAI_agent:AzureOpenAIAgent'
    $updated = $updated -replace '(?m)^(\s*)model:[^\r\n]*', ('${1}deployment_name: "' + $deployment + '"')
    if ($updated -eq $agents) {
      Ok "$Label : agents.yaml already matches the azure_openai provider - no change"
      return
    }

    # A .bak next to it is the only rollback (the target machine has no git) -
    # write it once, never clobber an existing one from a prior run.
    $backupPath = "$agentsPath.bak"
    if (-not (Test-Path $backupPath)) {
      Copy-Item -Path $agentsPath -Destination $backupPath -Force
    }
    [System.IO.File]::WriteAllText($agentsPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
    Ok "$Label : agents.yaml reconciled to the azure_openai provider (AzureOpenAIAgent, deployment '$deployment') - backup at $backupPath"
  }

  function Register-Toolkit([string]$ToolkitDir, [string]$Label) {
    if (-not (Test-Path $ToolkitDir)) {
      Warn "$Label not found at $ToolkitDir - skipping"
      return $null
    }
    try {
      $existing = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits" -Method Get -TimeoutSec 10
      # Match by leaf folder name, not the full path - the parent package
      # folder is date-stamped (pack.ps1's own "ai-dlc-workbench-package-
      # <date>" default, or Windows appending " 2"/"(2)" to a duplicate
      # download/extraction), so it differs on every rollout even though
      # it's still logically the same toolkit. An exact-path match never
      # fires across rollouts, so every re-unpack silently created a
      # brand-new Workbench entry and left the previous one behind - stale,
      # possibly pointing at a folder since deleted, but sitting in the
      # Workbench's list looking exactly as real as the current one.
      # Confirmed live, 2026-09-10: a leftover "Connected Ai Dlc Tlc" entry
      # from an earlier extraction was started straight from the Workbench
      # UI - it still pointed at a copy nothing had ever run unpack.ps1
      # against, so it fell into the online VPN-dependent install path and
      # failed with a GitLab DNS error unrelated to the (successful) unpack
      # this function's own caller had just run, moments earlier, elsewhere.
      $leaf = [IO.Path]::GetFileName($ToolkitDir.TrimEnd('\', '/'))
      $sameName = @($existing | Where-Object { [IO.Path]::GetFileName($_.path.TrimEnd('\', '/')) -ieq $leaf })
      # $existing is already newest-first (the API orders by created_at
      # DESC) - the first same-named match is the one from the most recent
      # prior rollout, the one worth updating in place.
      $match = $sameName | Select-Object -First 1
      if ($sameName.Count -gt 1) {
        Warn "$Label has $($sameName.Count) entries already registered with the Workbench (same folder name, different past paths) - updating the most recent (id $($match.id)); the rest are stale leftovers from earlier rollouts and can be deleted from the Workbench UI"
      }
      if ($match -and $match.path -eq $ToolkitDir) {
        Ok "$Label already registered with the Workbench (id $($match.id))"
        return $match.id
      }
      if ($match) {
        # Same toolkit, new rollout's path - retarget the existing entry
        # instead of creating a duplicate. Force-stop first, while its
        # record still has the OLD path/ports, so it can actually find and
        # kill whatever it thinks is running there (or safely no-op if that
        # folder is gone) - stopping AFTER the path patch would search the
        # NEW location instead, finding nothing there to clean up.
        try {
          Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$($match.id)/force-stop" -Method Post -TimeoutSec 20 | Out-Null
        } catch {
          # Best-effort - a failure here just means Start-RegisteredToolkit's
          # own idempotency check below might see a stale "running" status
          # instead of "stopped"; not fatal, still worth attempting.
        }
        $body = @{ path = $ToolkitDir } | ConvertTo-Json
        $updated = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$($match.id)" -Method Patch -Body $body -ContentType 'application/json' -TimeoutSec 20
        Ok "$Label re-pointed at this rollout's path (id $($updated.id)), was $($match.path)"
        return $updated.id
      }
      $body = @{ path = $ToolkitDir } | ConvertTo-Json
      $created = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20
      Ok "$Label registered with the Workbench (id $($created.id))"
      return $created.id
    } catch {
      Warn "$Label could not be registered with the Workbench: $($_.Exception.Message)"
      return $null
    }
  }

  function Start-RegisteredToolkit([string]$Id, [string]$Label, [int]$TimeoutSec) {
    if (-not $Id) { return $false }

    # Idempotency: the Workbench's own /start endpoint returns HTTP 409
    # "Already running" if the toolkit is already up - checked directly in
    # its source (api/routers/toolkits.py), not assumed. Without this check,
    # re-running unpack.ps1 against an already-healthy toolkit would treat
    # that 409 as a generic failure and wrongly report the toolkit as failed
    # in the final summary, even though nothing is actually wrong.
    try {
      $existingStatus = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$Id" -Method Get -TimeoutSec 10
      if ($existingStatus.status -eq 'running') {
        Ok "$Label is already running"
        return $true
      }
    } catch {
      # Couldn't check current status - fall through and try starting it;
      # the loop below will surface whatever's actually wrong.
    }

    try {
      Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$Id/start" -Method Post -TimeoutSec 20 | Out-Null
    } catch {
      # A 409 here (a start race with something else, since the check above
      # already said it wasn't running a moment ago) means "already
      # running" too, not a real failure - confirm via status rather than
      # trust the racy 409 alone.
      $statusCode = $null
      if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
      if ($statusCode -eq 409) {
        try {
          $recheck = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$Id" -Method Get -TimeoutSec 10
          if ($recheck.status -eq 'running') {
            Ok "$Label is already running"
            return $true
          }
        } catch {
          # Fall through to the generic failure below.
        }
      }
      Warn "$Label failed to start: $($_.Exception.Message)"
      return $false
    }
    Write-Host "  waiting for $Label to report healthy (first run can take several minutes - dependencies come from the local bundle) ..."
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
      try {
        $status = Invoke-RestMethod -Uri "$WorkbenchUrl/api/toolkits/$Id" -Method Get -TimeoutSec 10
        if ($status.status -eq 'running') { Ok "$Label is running"; return $true }
        if ($status.status -eq 'failed') { Fail "$Label reported status 'failed' - check its log ($($status.log_path))"; return $false }
      } catch {
        # Workbench API itself not answering this poll - keep trying until timeout.
      }
      Start-Sleep -Seconds 5
    }
    Warn "$Label did not report 'running' within $TimeoutSec s - it may still be installing; check the Workbench UI at $($WorkbenchUrl -replace ':8099', ':5199') or the toolkit's own log"
    return $false
  }

  # --- 7 (continued). start the Toolkit Workbench itself --------------------
  Step 7 "Starting the Toolkit Workbench"
  $workbenchOk = $false
  try {
    $workbenchStartBat = Join-Path $ToolkitWorkbenchDir 'start.bat'
    if (-not (Test-Path $workbenchStartBat)) {
      throw "toolkit-workbench not found at $ToolkitWorkbenchDir"
    }
    # Idempotency: if it's already up, don't relaunch it - start.bat's own
    # port-conflict handling would kill and restart it cleanly either way,
    # but that's a pointless disruption (and a brief window where it's down)
    # on a simple re-run against an already-healthy environment.
    if (Test-HttpUp "$WorkbenchUrl/api/health") {
      $workbenchOk = $true
    } else {
      Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"$workbenchStartBat`"" -WorkingDirectory $ToolkitWorkbenchDir | Out-Null
      Write-Host "  waiting for the Workbench API on :8099 ..."
      # start.bat runs offline_aaf.py's prepare step before it ever launches
      # uvicorn, and prepare rebuilds any runtime group whose venv doesn't
      # validate against the CURRENT bundle - normal the first time a run
      # points at a new package rollout, since every prior venv was keyed to
      # the old one. Confirmed live: a real first-run-on-a-new-rollout prepare
      # spanned ~5.5 minutes rebuilding two of four groups from scratch, well
      # past a 90s budget - which then reported a false "did not answer"
      # failure pointing at a console window that was, in fact, working fine.
      # Every run after the first against the same rollout is warm and
      # answers in well under 20s, so this ceiling costs nothing there - it
      # only matters for whichever run pays the one-time rebuild.
      $workbenchStartupTimeoutSec = 600
      $workbenchOk = Wait-ForHttp "$WorkbenchUrl/api/health" $workbenchStartupTimeoutSec 'Toolkit Workbench API'
    }
    if ($workbenchOk) {
      Ok "Toolkit Workbench is up - UI http://localhost:5199, API docs $WorkbenchUrl/docs"
      Record-Phase 'Toolkit Workbench' $true 'http://localhost:5199'
    } else {
      throw "Workbench API did not answer within ${workbenchStartupTimeoutSec}s - check the 'Workbench API' console window it opened"
    }
  } catch {
    Fail "Toolkit Workbench: $($_.Exception.Message)"
    Record-Phase 'Toolkit Workbench' $false $_.Exception.Message
  }

  # Registering/starting a toolkit needs the Workbench API up - skip steps 8-9
  # (but not step 10, which doesn't depend on the Workbench at all) if it
  # never came up.
  if ($workbenchOk) {
    # --- 8. knowledgeassistant -----------------------------------------------
    Step 8 "Registering and starting knowledgeassistant"
    try {
      Confirm-ToolkitEnvConfig $KnowledgeAssistantDir 'knowledgeassistant' $BackupConfigDir
      Confirm-ToolkitAgentsProvider $KnowledgeAssistantDir 'knowledgeassistant'
      $kaId = Register-Toolkit $KnowledgeAssistantDir 'knowledgeassistant'
      $kaOk = Start-RegisteredToolkit $kaId 'knowledgeassistant' 300
      if ($kaOk) {
        Record-Phase 'knowledgeassistant' $true 'gateway http://localhost:9004, knowledge-service http://localhost:8011'
      } else {
        Record-Phase 'knowledgeassistant' $false 'did not report running - see warnings above'
      }
    } catch {
      Fail "knowledgeassistant: $($_.Exception.Message)"
      Record-Phase 'knowledgeassistant' $false $_.Exception.Message
    }

    # --- 9. connected-ai-dlc-tlc (AAF/Python side) ---------------------------
    Step 9 "Registering and starting connected-ai-dlc-tlc's toolkit"
    try {
      Confirm-ToolkitEnvConfig $ConnectedAiDlcTlcDir 'connected-ai-dlc-tlc' $BackupConfigDir
      $cId = Register-Toolkit $ConnectedAiDlcTlcDir 'connected-ai-dlc-tlc'
      $cOk = Start-RegisteredToolkit $cId 'connected-ai-dlc-tlc' 300
      if ($cOk) {
        Record-Phase 'connected-ai-dlc-tlc toolkit' $true 'gateway http://localhost:9011'
      } else {
        Record-Phase 'connected-ai-dlc-tlc toolkit' $false 'did not report running - see warnings above'
      }
    } catch {
      Fail "connected-ai-dlc-tlc toolkit: $($_.Exception.Message)"
      Record-Phase 'connected-ai-dlc-tlc toolkit' $false $_.Exception.Message
    }
  } else {
    Warn "Skipping steps 8-9 (knowledgeassistant, connected-ai-dlc-tlc toolkit registration) - the Workbench API never came up"
    Record-Phase 'knowledgeassistant' $false 'skipped - Toolkit Workbench API did not come up'
    Record-Phase 'connected-ai-dlc-tlc toolkit' $false 'skipped - Toolkit Workbench API did not come up'
  }

  # --- 9a. Knowledge Assistant seeding — deliberately OFF for CLC ------------
  # CLC does not use Knowledge Assistant grounding. Decided after two real
  # bolts (CLC_Automation, CLC_18_09) both hit it either unauthorized (403 -
  # the grounding key's project_ids allowlist never included a CLC/CrewHub
  # project) or pointed at the wrong corpus (its own diagnosis: `success:
  # true, has_knowledge: false`, `retrieval.project_id` came back "mdui" -
  # KNOWLEDGE_ASSISTANT_PROJECT_ID was still MDUI's). Getting it working would
  # mean minting and authorizing a dedicated "clc" KA project server-side for
  # a corpus that does not exist yet - not worth it while e2e-intake's step
  # 4a already degrades to source + live-app grounding with no error, and
  # this project has neither a source checkout nor, now, a KA key to lose.
  # No .knowledge-assistant-grounding.env is ever written as a result, so
  # step 10a's Workbench seeding passes no --ka-grounding-env and step 10b
  # has no KA merge step at all (both updated accordingly). Revisit only
  # alongside an actual decision to stand up a CLC knowledge corpus, not by
  # re-enabling this silently.
  Record-Phase 'Knowledge Assistant seed data' $false 'deliberately skipped for CLC - see unpack.ps1 step 9a comment'

  # --- 10. connected-ai-dlc-tlc's own Node components ------------------------
  # Its start.bat (step 9, above) only brings up the Python AAF side - it
  # never starts app-state or ui, so that happens here directly. This runs
  # regardless of whether steps 8-9 succeeded: app-state works standalone,
  # falling back to placeholder data when its AAF/Knowledge gateways aren't
  # reachable, so there's no reason to withhold the actual Quality Workbench
  # UI just because a toolkit registration failed.
  Step 10 "Starting connected-ai-dlc-tlc's app-state and UI"
  try {
    if (-not (Test-Path $ConnectedAiDlcTlcDir)) {
      throw "connected-ai-dlc-tlc not found at $ConnectedAiDlcTlcDir"
    }
    $appStateDir = Join-Path $ConnectedAiDlcTlcDir 'app-state'
    $uiDir       = Join-Path $ConnectedAiDlcTlcDir 'ui'

    # Idempotency: if app-state is already answering, don't spawn a second
    # `npm run dev` fighting the first one for :3202 - re-running this
    # script against an already-running environment should recognize that,
    # not pile on a duplicate, half-working process.
    if (Test-HttpUp 'http://localhost:3202/api/health') {
      Ok "app-state is already running - http://localhost:3202"
      $appStateOk = $true
    } else {
      if (-not (Test-Path (Join-Path $appStateDir 'node_modules'))) {
        Write-Host "  installing app-state dependencies (npm install) ..."
        Push-Location $appStateDir
        try {
          Invoke-NativeCommand { npm install } "npm install failed in $appStateDir"
        } finally {
          Pop-Location
        }
      }
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/k title "connected-ai-dlc-tlc - app-state" && npm run dev' -WorkingDirectory $appStateDir | Out-Null
      Write-Host "  waiting for app-state on :3202 ..."
      $appStateOk = Wait-ForHttp 'http://localhost:3202/api/health' 60 'app-state'
      if ($appStateOk) { Ok "app-state is up - http://localhost:3202" }
    }

    if (Test-HttpUp 'http://localhost:5173') {
      Ok "Quality Workbench UI is already running - http://localhost:5173"
      $uiOk = $true
    } else {
      if (-not (Test-Path (Join-Path $uiDir 'node_modules'))) {
        Write-Host "  installing ui dependencies (npm install) ..."
        Push-Location $uiDir
        try {
          Invoke-NativeCommand { npm install } "npm install failed in $uiDir"
        } finally {
          Pop-Location
        }
      }
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/k title "connected-ai-dlc-tlc - ui" && npm run dev' -WorkingDirectory $uiDir | Out-Null
      Write-Host "  waiting for the Quality Workbench UI on :5173 ..."
      $uiOk = Wait-ForHttp 'http://localhost:5173' 60 'Quality Workbench UI'
      if ($uiOk) { Ok "Quality Workbench UI is up - http://localhost:5173 (access code: quality-workbench-dev unless UI_ACCESS_CODE was changed)" }
    }

    if ($appStateOk -and $uiOk) {
      Record-Phase 'Quality Workbench (app-state + ui)' $true 'http://localhost:5173'
    } else {
      Record-Phase 'Quality Workbench (app-state + ui)' $false 'one or both did not answer in time - see warnings above, check their console windows'
    }
  } catch {
    Fail "connected-ai-dlc-tlc app-state/ui: $($_.Exception.Message)"
    Record-Phase 'Quality Workbench (app-state + ui)' $false $_.Exception.Message
  }

  # --- 10a. seed Quality Workbench + mint a bolt-push key --------------------
  # Optional and never fatal, same shape as step 9a's Knowledge Assistant
  # seeding - seed_workbench.py health-checks app-state itself and just
  # prints one line and returns 0 if it never came up above. Safe to re-run:
  # the project and each historical release are matched by
  # code/label and reused, not duplicated; an already-provisioned key is
  # reused verbatim (a raw bolt-ingest key is only ever readable once, at
  # creation). The release to actually push against is deliberately NOT
  # written here at all - it's resolved fresh by the ingest endpoint itself
  # at push time (see connected-ai-dlc-tlc's routes/bolts.ts), since this
  # team tests the next release ahead of its own start date as routine
  # practice, and a release id baked in now would be the wrong one within
  # days.
  Step "10a" "Seeding Quality Workbench with a baseline project and release history"
  $workbenchEnvFile = Join-Path $SiblingRoot '.workbench-grounding.env'
  try {
    # No --ka-grounding-env: Knowledge Assistant is deliberately off for CLC
    # (see step 9a) - no .knowledge-assistant-grounding.env is ever written,
    # so passing one here would only make seed_workbench.py print "no
    # KNOWLEDGE_ASSISTANT_PROJECT_ID found" and skip the KA link anyway;
    # omitting the flag says that directly instead.
    & python (Join-Path $ConfigSource 'scripts\seed_workbench.py') --out-env $workbenchEnvFile
    if (Test-Path $workbenchEnvFile) {
      Ok "Workbench config at $workbenchEnvFile - merged into this run's own workspace at step 10b below, and into any later one by new-project.ps1"
      Record-Phase 'Quality Workbench seed data' $true $workbenchEnvFile
    } else {
      Ok "Skipped (app-state not reachable) - not required, e2e-bolt's Workbench push degrades gracefully without it"
      Record-Phase 'Quality Workbench seed data' $false 'app-state not reachable - optional, skipped'
    }
  } catch {
    Warn "Quality Workbench seeding failed: $($_.Exception.Message) - optional, not required"
    Record-Phase 'Quality Workbench seed data' $false $_.Exception.Message
  }
} elseif ($IncludeWorkbench) {
  Write-Host "`nSkipping part two (Toolkit Workbench + toolkits + app-state/ui) - (-SkipToolkits)" -ForegroundColor DarkGray
} else {
  Write-Host "`nSkipping part two (Toolkit Workbench + toolkits + app-state/ui) - disabled by default; pass -IncludeWorkbench to enable" -ForegroundColor DarkGray
}

# --- 10b. merge grounding config into the workspace's own .env.local ------
# Part One's own step 6 (which creates this workspace's .env.local) runs
# BEFORE part two even starts - the grounding files step 9a/10a just wrote
# above cannot exist yet at that point on a first-ever unpack, so a merge
# there (the same thing new-project.ps1 does for a LATER workspace, created
# after this run already has grounding data) would always find nothing.
# This has to happen down here, after both grounding files are guaranteed
# to exist (or be known absent), against the workspace this same run
# created. Silently does nothing if either file is missing (seeding was
# skipped or failed above - both optional) or the workspace has no
# .env.local at all (-SkipWorkspace against a location nothing ever
# provisioned) - same degrade-gracefully rule as everywhere else here.
function Merge-ProvisionedEnv([string]$SourceFile, [string]$TargetEnvLocal, [string]$MarkerPattern, [string]$Description) {
  if (-not (Test-Path $TargetEnvLocal)) {
    Ok "$Description skipped - no .env.local at $TargetEnvLocal (-SkipWorkspace, or provisioning failed above)"
    return $false
  }
  if (-not (Test-Path $SourceFile)) {
    Ok "$Description skipped - $SourceFile not written (seeding was skipped or failed above, both optional)"
    return $false
  }
  if (Select-String -Path $TargetEnvLocal -Pattern $MarkerPattern -Quiet) {
    Ok "$Description already present in $TargetEnvLocal"
    return $true
  }
  Add-Content -Path $TargetEnvLocal -Value "`n# Merged from $SourceFile by unpack.ps1`n"
  Get-Content $SourceFile | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | Add-Content -Path $TargetEnvLocal
  Ok "$Description merged into $TargetEnvLocal"
  return $true
}
if (-not $RunToolkits) {
  # $SiblingRoot is only ever assigned inside part two's own block, and
  # nothing was seeded this run, so there is nothing to merge. Not recorded
  # as a phase: a skipped step recorded as failed turned every
  # workspace-only run into "PARTIAL SUCCESS" with exit 1.
} else {
  Step "10b" "Merging grounding config into this workspace's .env.local"
  $workspaceEnvLocal = Join-Path $Destination '.env.local'
  # No Knowledge Assistant merge here - deliberately off for CLC (step 9a).
  $wbMerged = Merge-ProvisionedEnv (Join-Path $SiblingRoot '.workbench-grounding.env') $workspaceEnvLocal '^WORKBENCH_URL=' 'Quality Workbench bolt-push config'
  Record-Phase 'Grounding merged into workspace .env.local' $wbMerged $workspaceEnvLocal
}

# --- 11. summary -------------------------------------------------------
# Deliberately OUTSIDE both part blocks: -SkipToolkits (the exact flag
# DEMO-RUNBOOK.md's own bolt-demo setup uses) still needs a real
# success/failure declaration for whatever DID run, not just Part One's own
# "Workspace ready" line - and if both parts are skipped, $PhaseResults is
# empty, which must not read as a vacuous "SUCCESS" (an empty loop below
# would never flip $allOk to $false on its own).
Step 11 "Summary"
if ($PhaseResults.Count -eq 0) {
  Write-Host "Nothing to summarize - -SkipWorkspace was passed and part two did not run (no -IncludeWorkbench, or -SkipToolkits), so nothing ran." -ForegroundColor Yellow
} else {
  $allOk = $true
  foreach ($r in $PhaseResults) {
    if ($r.Success) {
      Ok "$($r.Phase): $($r.Detail)"
    } else {
      Fail "$($r.Phase): $($r.Detail)"
      $allOk = $false
    }
  }
  Write-Host ""
  if ($allOk) {
    Write-Host "SUCCESS - everything attempted came up." -ForegroundColor Green
  } else {
    Write-Host "PARTIAL SUCCESS - see the failed phase(s) above. Nothing else was blocked by them." -ForegroundColor Yellow
    # A non-zero exit code even though the console output above already
    # says which phase(s) failed: this script is graceful about letting
    # every OTHER phase still run, but it must not also report success to
    # anything checking $LASTEXITCODE/%ERRORLEVEL% afterward - a wrapping
    # script or CI job has no other way to detect "some of this didn't work".
    exit 1
  }
}
