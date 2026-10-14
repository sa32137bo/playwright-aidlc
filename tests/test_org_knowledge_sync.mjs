/**
 * Guard: knowledge/org/ and templates/knowledge/org/ must be identical.
 *
 *   node tests/test_org_knowledge_sync.mjs
 *
 * `pw-aidlc init` scaffolds a new project's knowledge/org from
 * templates/knowledge/org (lib/init.mjs), but merge-backs have historically
 * been written to the top-level knowledge/org. The two drifted for weeks —
 * review-checklist items 24/25 and several locator/assertion rules never
 * reached a freshly provisioned workspace (found reviewing bolt
 * US-CLC-MISSINGCREWNAME-001, "CLC_DEMO", 2026-09-24). Edit knowledge/org,
 * then copy it over:
 *   cp knowledge/org/*.md templates/knowledge/org/                     (macOS/Linux)
 *   Copy-Item knowledge\org\*.md templates\knowledge\org\ -Force      (PowerShell)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const a = join(root, 'knowledge/org');
const b = join(root, 'templates/knowledge/org');
const md = (d) => readdirSync(d).filter((f) => f.endsWith('.md')).sort();

const fails = [];
const names = new Set([...md(a), ...md(b)]);
for (const f of names) {
  let x, y;
  try { x = readFileSync(join(a, f), 'utf8'); } catch { fails.push(`${f}: missing from knowledge/org`); continue; }
  try { y = readFileSync(join(b, f), 'utf8'); } catch { fails.push(`${f}: missing from templates/knowledge/org`); continue; }
  if (x !== y) fails.push(`${f}: differs`);
}

if (fails.length) {
  console.error(`org knowledge out of sync:\n  ${fails.join('\n  ')}\n  fix: copy knowledge/org/*.md over templates/knowledge/org/ (cp, or Copy-Item -Force on Windows)`);
  process.exit(1);
}
console.log(`org knowledge in sync (${names.size} files)`);
