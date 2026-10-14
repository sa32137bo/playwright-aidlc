# GitHub Copilot Discovery Shim

Originally scoped as a full port of the kit's content to Copilot-native
formats. Downgraded to a minimal discovery/registration shim after a real
MDUI bolt (`US-MDUI-CUST-001`, "run-4 GHC") was driven through GitHub
Copilot against the **unmodified Claude-Code-native kit** — same
`CLAUDE.md`, same `.claude/skills/`, same `.mcp.json` — and produced audit
quality on par with an equivalent Claude Code run (correct gate sequence,
evidence-based failure classification, a real product bug found and
reported, discrepancies logged rather than silently resolved). The
methodology content is already portable as-is. What's missing is not a
rewrite — it's the two files that make Copilot find that content and the
MCP server automatically, instead of relying on however this one session
happened to pick them up.

**What does NOT need to change:** `bin/`, `lib/`, `e2e.config.yml`,
`knowledge/`, `.claude/skills/`, `.claude/commands/`, `CLAUDE.md`. None of
the kit's actual methodology content is rewritten, duplicated, or forked by
this unit.

## Groundwork confirmed before writing this unit

- **The content transfers unmodified.** Confirmed empirically, not just by
  reading Copilot's docs: a real bolt run under Copilot against the
  Claude-Code-shaped files produced correct gate behavior and audit
  discipline. This is the load-bearing finding that shrank the unit from a
  content port down to a discovery shim.
- **The MCP connection itself was never exercised, by either tool.**
  Checked directly: both CC run-4 and GHC run-4 have `knowledge/project/mdui-known-flaky-areas.md`
  on record that the Playwright MCP browser tool hangs on MDUI's multi-level
  menus, and both audits confirm live exploration was done instead through
  standalone `.explore/*.js` scripts that `require('@playwright/test')` and
  drive their own `chromium.launch()` — plain Node automation, not
  `mcp__playwright-test__browser_*` tool calls. So run-4's success is
  evidence the *instructions* transfer to Copilot; it is **not** evidence
  that `.mcp.json`'s `"mcpServers"` key ever actually connected under
  Copilot, since nothing in either run depended on that connection working.
  This is a real, untested gap, not a confirmed-but-undocumented success —
  COP-2 below is scoped to close it from a clean state, not to explain how
  it already worked.
- **Always-on repo instructions**: `.github/copilot-instructions.md`,
  natural-language Markdown, read automatically across VS Code, Visual
  Studio, and JetBrains. This is the pointer file — it does not need to
  contain the kit's rules itself, only tell Copilot where they live.
- **MCP server support**: real, in VS Code agent mode (1.99+), via
  `.vscode/mcp.json`. **Confirmed gotcha**: the root key is `"servers"`,
  not `"mcpServers"` — a config file using the Claude Code key name is
  silently ignored, not an error. This is the single easiest thing to get
  wrong and the main reason this shim is worth doing even though the
  content itself already works.

Explicitly out of scope, unless a real need shows up later: prompt-file
equivalents of the `/bolt`-style commands, subagent delegation via
`playwright init-agents --loop=vscode`, and an `--agent` flag on
`pw-aidlc init`. The run-4 evidence is that none of these were necessary
for a real bolt to succeed under Copilot.

---

## Epic: Copilot Discovery Shim

---

### COP-1: Add .github/copilot-instructions.md as a pointer, not a copy

**Type:** reference
**Status:** in-progress
**Epic:** Copilot Discovery Shim

**As a** developer using Copilot on a project scaffolded from this kit,
**I want** a short `.github/copilot-instructions.md` that tells Copilot to
read `CLAUDE.md` and `.claude/skills/` before doing any AI-DLC work,
**so that** Copilot finds the kit's rules on its own instead of depending
on someone manually pasting or referencing them in chat.

**Acceptance Criteria:**
- [x] `.github/copilot-instructions.md` is a few lines, not a duplicate of
      `CLAUDE.md`'s content — it names the files to read and the bolt
      lifecycle by name (intake → context → plan → Gate 1 → generate →
      matrix → run → heal → Gate 2 → ship → Gate 3), and stops there.
- [x] `pw-aidlc init` scaffolds this file alongside the existing Claude
      Code output, unconditionally — no new flag, since both files are
      cheap and there's no maintained Copilot-only or Claude-only variant
      to choose between.
- [ ] Verified live in a fresh VS Code Copilot Chat session, with nothing
      manually pasted, that the rules are actually being followed (Gate 1
      still a hard stop, story text still treated as data not
      instructions).

**Notes:**
- **2026-09-09: first two ACs done.** `templates/copilot-instructions.md`
  added (points at `CLAUDE.md` and `.claude/skills/`, states the bolt
  lifecycle, stops there — no rule content duplicated) and `lib/init.mjs`
  now writes it unconditionally alongside the existing Claude Code output,
  verified with a real `pw-aidlc init` run against a scratch project. The
  third AC — live verification in an actual Copilot Chat session — needs a
  real IDE session this environment can't produce; left open.

---

### COP-2: Register .vscode/mcp.json with the correct key

**Type:** tool
**Status:** in-progress
**Epic:** Copilot Discovery Shim

**As a** developer using Copilot,
**I want** the Playwright MCP server registered at `.vscode/mcp.json`
under the `"servers"` key,
**so that** live exploration (real navigation, real snapshots, real
locators) works through Copilot's own MCP integration, not through
whatever undocumented path let run-4 succeed.

**Acceptance Criteria:**
- [x] `.vscode/mcp.json` registers the same `npx playwright run-test-mcp-server`
      command `.mcp.json` already uses, under `"servers"` — confirmed by
      inspecting the file, not just by the run passing (a silently-ignored
      `.mcp.json`-shaped file failing open into some other tool path would
      also look like "it worked").
- [x] `.vscode/mcp.json` lives and travels the same way `.mcp.json` already
      does. **Corrected, 2026-09-09:** `pw-aidlc init` never scaffolded
      `.mcp.json` either — checked directly (`grep` across `lib/`), not
      assumed. `.mcp.json` is a static kit-root file `scripts/unpack.ps1`
      (renamed 2026-09-10, formerly `provision-workspace.ps1`) overlays into
      new MDUI workspaces, not something `init` generates. So
      "`init` scaffolds this alongside `.mcp.json`" was never a coherent
      requirement — `.vscode/mcp.json` now exists at the kit root the same
      way `.mcp.json` does and is overlaid by the same script step, which is
      the real mechanism that keeps the two from falling out of sync.
- [x] `pw-aidlc doctor` checks both `.mcp.json` and `.vscode/mcp.json`,
      parses each file's actual JSON, and fails by name on the specific
      `"servers"`/`"mcpServers"` swap in either direction — verified against
      three real cases (file missing, correctly keyed, wrong key) with a
      scratch project.
- [ ] Verified live: a real VS Code Copilot agent-mode session calls the
      Playwright MCP tools (navigate, click, snapshot) with `.vscode/mcp.json`
      present and `.mcp.json` absent — isolating that this file, not
      leftover Claude Code config, is what's making the connection. Needs a
      real IDE session this environment can't produce.

---

## Closing this unit

- [ ] Both stories are `done`, `descoped`, or `parked`.
- [ ] COP-2's live check confirms the Playwright MCP tools are actually
      reachable under Copilot via `.vscode/mcp.json` — a connection neither
      CC run-4 nor GHC run-4 ever exercised, since both worked around it
      with standalone scripts instead.
- [ ] `README.md` documents that Copilot is a supported IDE.
- [ ] Rename this unit with the `[closed]-` prefix once the above is true.
