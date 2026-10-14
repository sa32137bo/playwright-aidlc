#!/usr/bin/env bash
# Set up a new Playwright AI-DLC project in one command (macOS / Linux / WSL).
#
#   ./new-project.sh OrdersUI brownfield http://localhost:3000 src
#   ./new-project.sh NewFeature greenfield
#   ./new-project.sh Legacy characterization https://staging.acme.io
#
# Assumes the kit is already linked globally (npm link, once per machine).
set -euo pipefail

NAME="${1:?usage: new-project.sh <name> [mode] [url] [src]}"
MODE="${2:-brownfield}"
URL="${3:-}"
SRC="${4:-}"

step() { printf '\n\033[36m[%s] %s\033[0m\n' "$1" "$2"; }
ok()   { printf '  \033[32mOK\033[0m  %s\n' "$1"; }

command -v pw-aidlc >/dev/null || {
  echo "pw-aidlc not on PATH. Run 'npm link' once from the kit folder." >&2; exit 1; }

[ -e "$NAME" ] && { echo "Folder $NAME already exists." >&2; exit 1; }

step 1 "Creating $NAME"
mkdir "$NAME" && cd "$NAME"
git init -q && npm init -y >/dev/null
ok "git repo + package.json"

# Playwright is a LOCAL devDependency — required per project, not global.
step 2 "Installing Playwright (a few minutes)"
npm install --save-dev @playwright/test@latest >/dev/null
npx playwright install chromium >/dev/null
ok "Playwright + chromium"

[ -f playwright.config.ts ] || cat > playwright.config.ts <<CFG
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'html',
  use: { baseURL: process.env.BASE_URL || '${URL}', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
CFG
ok "playwright.config.ts"

step 3 "Installing Playwright test agents"
npx playwright init-agents --loop=claude
[ -d .claude/agents ] && ok "planner, generator, healer" || echo "  WARNING: .claude/agents missing — run: npx playwright init-agents --loop=claude"

step 4 "Scaffolding the AI-DLC kit"
ARGS=(init "$NAME" --mode "$MODE" --yes --src "$SRC")
[ -n "$URL" ] && ARGS+=(--url "$URL")
pw-aidlc "${ARGS[@]}"

[ -d specs ] && rm -rf specs && ok "removed unused specs/ folder"

cat <<NEXT

Ready: $(pwd)

Next:
  1. Stories       → inputs/stories/       (filename stem = bolt ID)
  2. Requirements  → inputs/requirements/  (.md, not .docx)
  3. Credentials   → .env.local            (skip for greenfield)
  4. Make tests/seed.spec.ts real          (skip for greenfield)
  5. pw-aidlc doctor$([ "$MODE" = greenfield ] && echo " --no-run")
  6. code .   then in Claude Code:  /bolt <STORY-ID>

NEXT
