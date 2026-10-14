<#
.SYNOPSIS
  Package this repo (playwright-aidlc) into one zip file, ready to hand to
  scripts\unpack.ps1 on another machine.

  By default the package contains playwright-aidlc only. The workbench (the
  three sibling toolkit repos knowledgeassistant, toolkit-workbench and
  connected-ai-dlc-tlc, plus the offline Python bundle they need) no longer
  ships as of 2026-09-25. Its logic is kept, disabled: pass -IncludeWorkbench
  to package it again, and unpack.ps1 -IncludeWorkbench to stand it up.

.DESCRIPTION
  Everything below about the three sibling repos, their exclusions and the
  offline Python bundle applies only with -IncludeWorkbench.

  Run this from wherever playwright-aidlc was cloned - this script lives at
  scripts\pack.ps1, one level under the repo root. It looks for the other
  three repos as SIBLINGS of this one (the same layout the .code-workspace
  file already assumes: ..\knowledgeassistant, ..\toolkit-workbench,
  ..\connected-ai-dlc-tlc).

  For each of the four repos:
    - If it already exists locally, `git pull` on whatever branch is
      currently checked out (never forced to a specific branch), then copy
      its working tree into the package as-is - including any uncommitted
      local changes, since this is meant to hand off a working snapshot, not
      a clean release build. A failed pull is a warning, not an abort: the
      repo is still packaged using whatever local state it has.
    - If it is not found locally, `git clone --depth 1` its default branch
      fresh - a remote packaging machine won't necessarily have every repo
      already checked out.

  Every repo is copied WITHOUT: .git history, node_modules/.venv/build
  output, .claude (personal Claude Code state, not project config), and any
  real secrets (.env, .env.local, envconfig.yaml - the .example templates
  that ship in the repos ARE included, since unpack.ps1 uses those as
  fallbacks). This keeps the zip small and, more importantly, makes it safe
  to hand to someone else - a real API key sitting in a local
  envconfig.yaml never leaves this machine in the zip.

  Two repos have their own extra exclusion on top of the above (see
  $Repos' own ExtraExcludeDirs) - both gitignored already, but NOT excluded
  from a working-tree copy like this one by that fact alone:
    - connected-ai-dlc-tlc's project-docs\inputs: local-only reference
      material nothing downstream ever reads, that has held a 1GB+
      unrelated codebase and another client's own meeting transcripts -
      neither belongs in a package handed to a different client's
      environment.
    - knowledgeassistant's knowledge-service\data: chroma's local vector
      store plus whatever's been uploaded into it during testing - runtime
      state the service regenerates as sources are (re-)synced, not
      something to carry in the package.

  Builds a Windows Python wheel bundle in vendor\aaf, including AAF,
  toolkit capabilities, Knowledge Service and Workbench API dependencies.
  Build on Windows with Python 3.11+ and access to the private registry.
  The recipient must use the same Python major/minor and architecture.
  A fresh offline install validates the bundle before the zip is produced.
  Missing dependencies are fatal. -SkipVendorAaf explicitly opts into the
  legacy online installation path for recipients with registry access.

  This build step is cached under %USERPROFILE%\.aaf\pack-cache and reused
  on the next run - AAF/toolkit dependency updates are rare, so most runs
  should be a fast cache hit, not a several-minute rebuild. The cache
  self-invalidates the moment anything that would actually change the
  bundle does: a project source file, this script's own build recipe
  (offline_aaf.py), or the packaging machine's Python. -NoCache forces a
  full rebuild anyway - only needed if you suspect the cache mechanism
  itself, not something it already checks for.

  The output is a plain zip with the four repo folders (plus vendor\, if
  produced) at its top level (no extra wrapper folder) - extracting it
  (Windows' own "Extract All..." already creates a folder for you)
  reproduces exactly the sibling layout unpack.ps1 expects.

.EXAMPLE
  .\pack.ps1
  # Safe to re-run as-is, any day - an existing -OutputZip is backed up to
  # "<OutputZip>.bak" first, never just deleted before the rebuild finishes.

.EXAMPLE
  .\pack.ps1 -OutputZip "D:\handoff\ai-dlc-workbench.zip" -Force
  # -Force skips the automatic backup and overwrites -OutputZip directly.

.EXAMPLE
  .\pack.ps1 -IncludeWorkbench
  # The old full package: all four repos plus the offline Python bundle.

.EXAMPLE
  .\pack.ps1 -IncludeWorkbench -SkipVendorAaf
  # Full package without the Python bundle; recipient needs private registry
  # access.
#>

param(
  # Where to look for the three sibling repos - defaults to this repo's own
  # parent folder, i.e. wherever playwright-aidlc, knowledgeassistant,
  # toolkit-workbench and connected-ai-dlc-tlc all sit side by side.
  [string]$SiblingRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  # Blank = a dated name on the Desktop, which says whether the workbench is in it.
  [string]$OutputZip   = '',
  # An existing -OutputZip is always rebuilt over, never a reason to stop -
  # the default backs it up to "<OutputZip>.bak" first so a failed rebuild
  # doesn't leave you with neither. -Force skips that backup and overwrites
  # -OutputZip directly.
  [switch]$Force,
  # Explicit opt-out of the no-VPN Python bundle.
  [string]$Python = 'python',
  [string]$PackageRegistry = 'https://gitlab.prolifics.com/api/v4/projects/2434/packages/pypi/simple',
  [switch]$SkipVendorAaf,
  # Force a full wheel rebuild even if a cached bundle from a previous run
  # would otherwise be reused - see Build-OfflineAaf below for when you'd
  # actually want this (normally never; the cache already rebuilds itself
  # whenever anything relevant changed).
  [switch]$NoCache,
  # OFF by default: the workbench no longer ships. Pass to add the three
  # sibling toolkit repos and the offline Python bundle back into the package.
  [switch]$IncludeWorkbench
)

$ErrorActionPreference = 'Stop'

if (-not $OutputZip) {
  $zipStem = if ($IncludeWorkbench) { 'ai-dlc-workbench-package' } else { 'playwright-aidlc-package' }
  $OutputZip = Join-Path $HOME ("Desktop\{0}-{1}.zip" -f $zipStem, (Get-Date -Format 'yyyy-MM-dd'))
}
# The offline Python bundle is built for the workbench's toolkits (AAF,
# Knowledge Service, Workbench API); without them there is nothing to build.
$BuildVendorAaf = $IncludeWorkbench -and -not $SkipVendorAaf

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "  !   $msg" -ForegroundColor Yellow }
function Fail($msg)     { Write-Host "  X   $msg" -ForegroundColor Red }

# Names and remotes of the repos this package contains: playwright-aidlc
# always, plus the three workbench repos with -IncludeWorkbench. Not
# configurable beyond that, since unpack.ps1 -IncludeWorkbench on the other
# end expects exactly these sibling folders by exactly these names.
$Repos = @(
  @{ Name = 'playwright-aidlc';     Remote = 'https://gitlab.prolifics.com/InnovationCenter/playwright-aidlc.git' }
)
$WorkbenchRepos = @(
  # knowledge-service\data is chroma's own local vector store plus whatever
  # has been uploaded into it during testing - runtime state the service
  # regenerates as sources are (re-)synced, not something to carry in the
  # package. Gitignored already, but robocopy doesn't consult .gitignore;
  # *.db alone doesn't catch it either (chroma.sqlite3, .db-shm/-wal, and
  # its .bin index files all have other extensions).
  @{ Name = 'knowledgeassistant';   Remote = 'https://gitlab.prolifics.com/InnovationCenter/ai-toolkits/knowledgeassistant.git'; ExtraExcludeDirs = @('knowledge-service\data') }
  # project-docs\inputs is where past bolt-run dumps, screenshots, and
  # other loose reference material accumulate - none of it is read by
  # unpack.ps1 or by any bolt, it's local-only working material, and it has
  # been observed to contain: (1) a full unrelated 1GB+ legacy codebase kept
  # only as migration reference, and (2) another client's meeting
  # transcripts, saved here as demo reference. Neither belongs in a package
  # handed to a different client's own environment - excluded by full path,
  # not by bare "inputs" name, since playwright-aidlc has its own
  # legitimate top-level inputs\ (stories/requirements bolts actually read)
  # that must NOT be caught by this.
  @{ Name = 'connected-ai-dlc-tlc'; Remote = 'https://gitlab.prolifics.com/InnovationCenter/ai-toolkits/connected-ai-dlc-tlc.git'; ExtraExcludeDirs = @('project-docs\inputs') }
  @{ Name = 'toolkit-workbench';    Remote = 'https://gitlab.prolifics.com/InnovationCenter/agentic-automation-framework/toolkit-workbench.git' }
)
if ($IncludeWorkbench) { $Repos += $WorkbenchRepos }

# Directories/files never copied into the package, matched by bare name at
# any depth - generated output the target machine regenerates on first run,
# plus anything that can hold a real secret. .claude is personal Claude
# Code state (each of these repos' own top-level .claude holds nothing but
# settings.local.json - a local Bash-permission allowlist, not project
# config), same category as .git: tooling-local, never needed by the
# target environment.
$ExcludeDirs  = @('node_modules', '.venv', 'venv', 'dist', 'dist-server', '.git', '.claude', '.state', '__pycache__', '.pytest_cache', '.tmp', 'coverage', 'build', '.turbo')
$ExcludeFiles = @('.env', '.env.local', 'envconfig.yaml', '*.db', '.aaf-offline')

# No path handed to robocopy may end in a backslash. PowerShell quotes any
# argument containing a space, which turns a trailing "\" into "\"" - an
# escaped quote - and robocopy then folds every argument after it into a
# single malformed parameter and dies with exit 16 / "Invalid Parameter #n".
# Load-bearing here rather than cosmetic: every path in this script sits
# under a folder whose name contains spaces, -SiblingRoot may legitimately
# be passed with a trailing slash, and Join-Path with an empty child element
# appends one on its own.
function Remove-TrailingSlash([string]$Path) { return $Path.TrimEnd('\', '/') }

function Invoke-RobocopyMirror([string]$Source, [string]$Destination, [string[]]$ExtraExcludeDirs = @()) {
  $Source      = Remove-TrailingSlash $Source
  $Destination = Remove-TrailingSlash $Destination

  # Extra excludes are joined onto $Source so robocopy matches them as full
  # paths, not bare names - see $Repos' own comment on why that distinction
  # matters here (a bare-name exclude would also catch playwright-aidlc's
  # unrelated, legitimate top-level inputs\ in a different repo's copy).
  #
  # The guard is required, not defensive: $ExtraExcludeDirs arrives as $null
  # (not @()) for every repo in $Repos without an ExtraExcludeDirs key, since
  # an absent hashtable key reads as $null and passing $null explicitly
  # overrides this parameter's own @() default. Piping $null runs ONE
  # iteration with $_ = $null - not zero, the way @() would - so an
  # unguarded ForEach-Object here appended "$Source\" as a bogus exclude:
  # the malformed trailing-backslash argument described above and, quoting
  # aside, an instruction to exclude the very tree being copied.
  $fullPathExcludes = @()
  if ($ExtraExcludeDirs) {
    $fullPathExcludes = @(
      $ExtraExcludeDirs |
        Where-Object { $_ } |
        ForEach-Object { Remove-TrailingSlash (Join-Path $Source $_) }
    )
  }

  $roboArgs = @($Source, $Destination, '/E') + @('/XD') + $ExcludeDirs + $fullPathExcludes + @('/XF') + $ExcludeFiles + @('/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  $roboOutput = robocopy @roboArgs
  # Robocopy's own exit-code convention: 0-7 are all success (various shades
  # of "some files copied" / "nothing to do"), 8+ is a real failure - not the
  # usual "0 = success, anything else = failure" most native commands use.
  if ($LASTEXITCODE -ge 8) {
    # Robocopy's output is the only thing that says WHY it failed (bad
    # parameter vs. locked file vs. access denied vs. path too long), and the
    # staging tree it refers to is deleted on the way out of this script - so
    # print it rather than discarding it and leaving only an exit number.
    $roboOutput | ForEach-Object { Write-Host "    $_" }
    throw "robocopy failed copying $Source -> $Destination (exit $LASTEXITCODE)"
  }
}

function Get-RepoIntoStaging([string]$Name, [string]$RemoteUrl, [string]$StagingRoot, [string[]]$ExtraExcludeDirs = @()) {
  $localPath   = Join-Path $SiblingRoot $Name
  $stagingPath = Join-Path $StagingRoot $Name

  if (Test-Path (Join-Path $localPath '.git')) {
    $branch = (git -C $localPath branch --show-current 2>$null)
    if ($branch) { $branch = $branch.Trim() } else { $branch = '(detached HEAD)' }

    # Only pull a branch that actually tracks a remote. A local-only branch -
    # a feature branch never pushed, so it has no upstream - has nothing to
    # pull: `git pull` there fails with "no tracking information", which is
    # NOT the stale-checkout / lost-network risk the fatal pull below guards
    # against. Package its working tree as-is instead (the same
    # working-snapshot, uncommitted changes included, this script already
    # ships for every repo) rather than refusing over a pull that could never
    # have run in the first place.
    $hasUpstream = $false
    if ($branch -ne '(detached HEAD)') {
      git -C $localPath rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>$null | Out-Null
      $hasUpstream = ($LASTEXITCODE -eq 0)
    }

    if (-not $hasUpstream) {
      Warn "$Name : branch '$branch' has no upstream (local-only branch) - skipping pull, packaging the working tree as-is"
    } else {
      Write-Host "  found locally on branch '$branch' - pulling latest..."

      Push-Location $localPath
      $prevEAP = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        git pull 2>&1 | ForEach-Object { Write-Host "    $_" }
        $pullExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $prevEAP
        Pop-Location
      }
      if ($pullExit -ne 0) {
        # Deliberately fatal, not a warning: a silently-stale pull can ship a
        # checkout that's missing a fix landed on the remote after this
        # machine's last successful pull, with nothing but an easy-to-miss
        # warning line to show for it. "Package what we have and hope
        # someone notices the warning" is worse than stopping here - same
        # reasoning as the clone failure below.
        throw "$Name : git pull failed (exit $pullExit) - check network/VPN access before packaging. Refusing to package a possibly-stale local checkout."
      }
      Ok "$Name : up to date on '$branch'"
    }

    Write-Host "  copying working tree into the package (excluding node_modules, .venv, build output, secrets)..."
    Invoke-RobocopyMirror $localPath $stagingPath $ExtraExcludeDirs
    Ok "$Name : copied from local checkout (branch '$branch')"
  } else {
    Write-Host "  not found locally at $localPath - cloning $RemoteUrl (default branch)..."
    $prevEAP = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      git clone --depth 1 $RemoteUrl $stagingPath 2>&1 | ForEach-Object { Write-Host "    $_" }
      $cloneExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEAP
    }
    if ($cloneExit -ne 0) {
      # Deliberately fatal, unlike a failed `git pull` above: a pull failure
      # still leaves usable (if slightly stale) local content to package,
      # but a clone failure means there is NOTHING for this repo - silently
      # shipping a zip missing one of the four required repos would be a
      # worse, more confusing outcome than stopping here. This also runs on
      # the packaging operator's own machine, not unattended on a remote
      # one, so "fix your VPN and re-run" is the right answer, not "package
      # what we could and hope someone notices what's missing."
      throw "git clone failed for $Name (exit $cloneExit) - check network/VPN access to $RemoteUrl"
    }
    # Fresh clones are stripped of .git too, same as local copies - this
    # package is for running the environment, not for carrying git history
    # to the target machine.
    Remove-Item -Path (Join-Path $stagingPath '.git') -Recurse -Force -ErrorAction SilentlyContinue
    Ok "$Name : cloned fresh (default branch)"
  }
}

# Build from package contents so the wheels and shipped sources match
# exactly. AAF/toolkit dependency updates are rare, so offline_aaf.py caches
# a successful build under %USERPROFILE%\.aaf\pack-cache and reuses it on
# the next run unless the project sources, this script's own build recipe,
# or the packaging machine's Python have actually changed - most runs
# should be a fast cache hit, not a full rebuild. -NoCache forces a real
# rebuild regardless; use it if you suspect the cache itself, not the
# things it already checks for.
function Build-OfflineAaf([string]$StagingRoot) {
  $builder = Join-Path $StagingRoot 'playwright-aidlc\scripts\offline_aaf.py'
  $cacheArgs = if ($NoCache) { @('--no-cache') } else { @() }
  & $Python $builder build --root $StagingRoot --registry $PackageRegistry @cacheArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Offline Python bundle build/validation failed. No runnable no-VPN package was produced."
  }
}

Write-Host "AI-DLC - pack" -ForegroundColor Cyan
if ($IncludeWorkbench) {
  Write-Host "Including the workbench (-IncludeWorkbench). Looking for sibling repos in: $SiblingRoot" -ForegroundColor DarkGray
} else {
  Write-Host "Packaging playwright-aidlc only - the workbench is disabled by default (pass -IncludeWorkbench to add it)" -ForegroundColor DarkGray
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "'git' is not on PATH - required to pull/clone the packaged repos."
}

if ($BuildVendorAaf) {
  & $Python -c "import sys; assert sys.platform == 'win32' and sys.version_info >= (3,11), 'Packaging requires Windows Python 3.11+'"
  if ($LASTEXITCODE -ne 0) { throw "Select a Windows Python 3.11+ interpreter with -Python before packaging." }
}

if (Test-Path $OutputZip) {
  if ($Force) {
    Warn "output zip already exists: $OutputZip - overwriting (-Force, no backup kept)"
    Remove-Item -Path $OutputZip -Force
  } else {
    # Default is to always proceed, not throw - but a fresh rebuild can fail
    # partway (network blip mid-wheel-build, a repo fails to pull) long
    # after this point, and $OutputZip is only written at the very end
    # (Compress-Archive below). Deleting the old, working zip THIS early
    # would leave nothing at all if that happens. Move it aside instead, so
    # a failed rebuild still leaves the last good zip recoverable.
    $backupZip = "$OutputZip.bak"
    Warn "output zip already exists: $OutputZip - backing it up to $backupZip before rebuilding (pass -Force to skip this and overwrite directly)"
    Move-Item -Path $OutputZip -Destination $backupZip -Force
  }
}

$StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ai-dlc-workbench-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $StagingRoot -Force | Out-Null

try {
  $n = 0
  foreach ($repo in $Repos) {
    $n++
    Step $n "Packaging $($repo.Name)"
    Get-RepoIntoStaging -Name $repo.Name -RemoteUrl $repo.Remote -StagingRoot $StagingRoot -ExtraExcludeDirs $repo.ExtraExcludeDirs
  }

  if ($BuildVendorAaf) {
    $n++
    Step $n "Building and validating the offline Windows Python bundle"
    Build-OfflineAaf $StagingRoot
  }

  $aafLine = if (-not $IncludeWorkbench) {
    "Workbench not included (the default): playwright-aidlc only. No Python bundle; nothing here needs the private registry."
  } elseif ($SkipVendorAaf) {
    "ONLINE-ONLY package (-SkipVendorAaf): recipient requires private-registry access."
  } else {
    "Python dependencies bundled and fresh offline install verified. Recipient needs matching Windows Python; no private-registry/VPN access for Python setup."
  }
  $excludedExtra = if ($IncludeWorkbench) {
    " Also excluded:`nconnected-ai-dlc-tlc's project-docs\inputs (local-only reference material)`nand knowledgeassistant's knowledge-service\data (its local vector store) -`nneither is ever read by unpack.ps1 or any bolt."
  } else { '' }
  # What unpack.ps1 needs to be told on the other end.
  $unpackCmd = if ($IncludeWorkbench) { '.\scripts\unpack.ps1 -IncludeWorkbench' } else { '.\scripts\unpack.ps1' }

  # Written into the zip itself, not just the packager's own terminal - a
  # recipient who extracts and double-clicks straight into Toolkit Workbench
  # (skipping npm link + unpack.ps1) previously hit a confusing "installing
  # agentic-assembly-framework - VPN required" -> GitLab DNS failure with
  # nothing telling them a manual unpack step existed. This file is the fix:
  # the instructions travel with the package instead of living only in
  # scrollback the packager has to remember to relay.
  $n++
  Step $n "Writing START-HERE.txt into the package"
  $startIntro = if ($IncludeWorkbench) {
    "Run these from the extracted folder BEFORE launching Toolkit Workbench or`neither toolkit's start.bat/start.sh - skipping this is what produces a`n""VPN required"" install failure trying to reach a private package registry:"
  } else {
    'Run these from the extracted folder to provision a CLC Playwright workspace:'
  }
  $startOutro = if ($IncludeWorkbench) { 'Only after unpack.ps1 finishes should you start Toolkit Workbench.' } else { 'unpack.ps1 prints the next steps (open the workspace, then /bolt <STORY-ID>).' }
  Set-Content -Path (Join-Path $StagingRoot 'START-HERE.txt') -Value @"
Start here
==========

$aafLine

$startIntro

  1. cd into the extracted playwright-aidlc folder - the repo root, NOT its
     scripts\ subfolder (that's where npm link has to run, and unpack.ps1
     resolves its own paths from its own location either way)
  2. npm link   (once per machine - puts pw-aidlc on PATH, which unpack needs)
  3. powershell -ExecutionPolicy Bypass -File $unpackCmd

     The -ExecutionPolicy Bypass is required, not decorative: a default
     Windows execution policy refuses to run a .ps1 that came out of a zip
     from another machine. It applies to that one invocation only - no
     machine-wide policy change, no admin rights.

$startOutro
"@
  Ok "START-HERE.txt"

  $n++
  Step $n "Compressing into $OutputZip"
  $outputDir = Split-Path $OutputZip -Parent
  if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
  }
  Compress-Archive -Path (Join-Path $StagingRoot '*') -DestinationPath $OutputZip -Force
  $sizeMb = [math]::Round((Get-Item $OutputZip).Length / 1MB, 1)
  Ok "$OutputZip ($sizeMb MB)"

  Write-Host "`nSUCCESS" -ForegroundColor Green
  Write-Host @"

Package contains: $(($Repos | ForEach-Object { $_.Name }) -join ', ')

Excluded from every repo, by design: .git history, node_modules/.venv/build
output, and any real secrets (.env, .env.local, envconfig.yaml - the
.example templates ARE included so unpack.ps1 has something to fall
back to). The target machine regenerates the first two on first run and
needs to fill in its own copies of the third.$excludedExtra

$aafLine

Next, on the target Windows machine:
  1. Copy $OutputZip across and extract it
  2. cd into the extracted playwright-aidlc folder - the repo root, NOT its
     scripts\ subfolder (that's where npm link has to run, and unpack.ps1
     resolves its own paths from its own location either way)
  3. npm link   (once per machine - puts pw-aidlc on PATH, which unpack needs)
  4. powershell -ExecutionPolicy Bypass -File $unpackCmd

     The -ExecutionPolicy Bypass is required, not decorative: a default
     Windows execution policy refuses to run a .ps1 that came out of a zip
     from another machine. It applies to that one invocation only - no
     machine-wide policy change, no admin rights.

"@
} finally {
  Remove-Item -Path $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
