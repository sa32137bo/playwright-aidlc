<#
.SYNOPSIS
  Set up a new Playwright AI-DLC project in one command.

.DESCRIPTION
  Collapses the four per-project setup steps into one:
    1. git init + npm init
    2. npm init playwright@latest      (Playwright is a LOCAL devDependency -
                                        it must be installed per project)
    3. npx playwright init-agents --loop=claude
    4. pw-aidlc init

  Assumes the kit is already linked globally (npm link, done once per machine).

.EXAMPLE
  .\new-project.ps1 -Name OrdersUI -Mode brownfield -Url http://localhost:3000 -Src src

.EXAMPLE
  .\new-project.ps1 -Name NewFeature -Mode greenfield

.EXAMPLE
  .\new-project.ps1 -Name Legacy -Mode characterization -Url https://staging.acme.io
#>

param(
  [Parameter(Mandatory = $true)][string]$Name,
  [ValidateSet('greenfield', 'brownfield', 'characterization')][string]$Mode = 'brownfield',
  [ValidateSet('webapp', 'api')][string]$Type = 'webapp',
  [string]$Url = '',
  [string]$Src = '',
  [string]$Jira = '',
  [string]$Path = '.'
)

$ErrorActionPreference = 'Stop'

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "  OK  $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "  !   $msg" -ForegroundColor Yellow }

# --- preflight -------------------------------------------------------------
if (-not (Get-Command pw-aidlc -ErrorAction SilentlyContinue)) {
  Write-Host "pw-aidlc not found on PATH." -ForegroundColor Red
  Write-Host "Run once per machine, from the kit folder:  npm link" -ForegroundColor Red
  exit 1
}

if ($Mode -ne 'greenfield' -and -not $Url) {
  Warn "$Mode mode normally needs -Url. Continuing; set app.url in e2e.config.yml later."
}

$target = Join-Path (Resolve-Path $Path) $Name
if (Test-Path $target) {
  Write-Host "Folder already exists: $target" -ForegroundColor Red
  Write-Host "Pick another name, or cd into it and run 'pw-aidlc init --force' instead." -ForegroundColor Red
  exit 1
}

# --- 1. project shell ------------------------------------------------------
Step 1 "Creating $target"
New-Item -ItemType Directory -Path $target | Out-Null
Push-Location $target
try {
  git init | Out-Null
  npm init -y | Out-Null
  Ok "git repo + package.json"

  # --- 2. Playwright (local devDependency - required per project) ----------
  Step 2 "Installing Playwright (this takes a few minutes)"
  npm install --save-dev "@playwright/test@latest" | Out-Null
  npx playwright install chromium | Out-Null
  Ok "Playwright + chromium"

  if (-not (Test-Path 'playwright.config.ts')) {
    @"
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: process.env.BASE_URL || '$Url',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
"@ | Set-Content -Path 'playwright.config.ts' -Encoding UTF8
    Ok "playwright.config.ts"
  }

  # --- 3. official Playwright agents ---------------------------------------
  Step 3 "Installing Playwright test agents"
  npx playwright init-agents --loop=claude
  if (-not (Test-Path '.claude/agents')) {
    Write-Host "  init-agents did not create .claude/agents - the bolt will not run." -ForegroundColor Red
    Write-Host "  Run manually:  npx playwright init-agents --loop=claude" -ForegroundColor Red
  } else { Ok "planner, generator, healer" }

  # --- 4. the kit ----------------------------------------------------------
  Step 4 "Scaffolding the AI-DLC kit"
  $kitArgs = @('init', $Name, '--mode', $Mode, '--type', $Type, '--yes')
  if ($Url)  { $kitArgs += @('--url',  $Url)  }
  $kitArgs += @('--src', $Src)          # empty string is valid - means no code grounding
  if ($Jira) { $kitArgs += @('--jira', $Jira) }
  & pw-aidlc @kitArgs

  # Playwright's init-agents leaves a specs/ folder the kit does not use.
  if (Test-Path 'specs') { Remove-Item 'specs' -Recurse -Force; Ok "removed unused specs/ folder" }

  # --- 5. Auto-provisioned config, if unpack.ps1 set any of it up ----------
  # Each file below is written by its own seed_*.py (called from unpack.ps1
  # into the sibling root shared by every toolkit) - this script lives at
  # <repo root>\scripts\new-project.ps1, and <repo root> is that same
  # sibling root's own child in the standard unpack.ps1 layout, so ..\..
  # from here reaches it without needing this project's own location
  # relative to anything. Silently does nothing for a file that isn't there
  # - all of this is optional, additive config that degrades gracefully
  # without it either way (e2e-intake's Knowledge Assistant grounding,
  # e2e-bolt's Workbench push).
  function Merge-ProvisionedEnv([string]$SourceFile, [string]$MarkerPattern, [string]$Description) {
    if (-not ((Test-Path $SourceFile) -and (Test-Path '.env.local'))) { return }
    if (Select-String -Path '.env.local' -Pattern $MarkerPattern -Quiet) { return }
    Add-Content -Path '.env.local' -Value "`n# Merged from $SourceFile by new-project.ps1`n"
    Get-Content $SourceFile | Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() } | Add-Content -Path '.env.local'
    Ok "$Description merged into .env.local"
  }

  Merge-ProvisionedEnv (Join-Path $PSScriptRoot '..\..\.knowledge-assistant-grounding.env') '^KNOWLEDGE_ASSISTANT_URL=' 'Knowledge Assistant grounding'
  Merge-ProvisionedEnv (Join-Path $PSScriptRoot '..\..\.workbench-grounding.env') '^WORKBENCH_URL=' 'Quality Workbench bolt-push config'

  Write-Host "`nReady: $target" -ForegroundColor Green
  Write-Host @"

Next:
  1. Put your stories in    inputs\stories\       (filename stem = bolt ID)
  2. Requirements in        inputs\requirements\  (convert .docx to .md first)
  3. Credentials in         .env.local            (skip for greenfield)
  4. Make tests\seed.spec.ts real                 (skip for greenfield)
  5. pw-aidlc doctor$(if ($Mode -eq 'greenfield') { ' --no-run' })
  6. code .   then in Claude Code:  /bolt <STORY-ID>

"@
} finally {
  Pop-Location
}
