import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { c, ok, warn, bad, info, head, loadConfig, get } from './util.mjs';

/**
 * Preflight and inventory for binding a greenfield bolt to a live application.
 *
 * The agent does the binding; this establishes deterministically whether it is
 * safe to start and how much there is to do. Both halves matter. A rebind that
 * starts against an unreachable app wastes a session; one that starts with unset
 * credentials is worse, because the app answers with a login page and every
 * locator bound is bound to the wrong screen — with no error anywhere.
 */

const UNVERIFIED = /\/\/[^\n]*UNVERIFIED|UNVERIFIED/g;
const PENDING = /@pending/g;
const PLACEHOLDER = /^\s*$|CHANGE_ME|your-|<[^>]*>|xxx+/i;

export async function rebind(args = {}) {
  const root = resolve(args.root || process.cwd());
  const cfg = loadConfig(root);
  if (!cfg) throw new Error('e2e.config.yml not found');

  const bolt = args.bolt || args._?.[1];
  if (!bolt) throw new Error('which bolt? use --bolt <ID>');

  const boltDir = join(root, 'bolts', bolt);
  if (!existsSync(boltDir)) throw new Error(`no such bolt: bolts/${bolt}`);

  const testsDir = get(cfg, 'paths.tests', 'tests/e2e');
  const specDir = join(root, testsDir, bolt);

  console.log(c.bold(`\nRebind preflight — ${bolt}\n`));

  const blockers = [];

  // --- what the bolt already has -------------------------------------------
  head('The bolt');
  const audit = existsSync(join(boltDir, 'audit.md')) ? readFileSync(join(boltDir, 'audit.md'), 'utf8') : '';
  const gate1 = /GATE 1 approved|Gate 1 approved/i.test(audit);
  existsSync(join(boltDir, 'plan.md')) ? ok('plan.md') : blockers.push('bolts/' + bolt + '/plan.md is missing — nothing to rebind against');
  gate1 ? ok('Gate 1 approval recorded in audit.md') : blockers.push('no Gate 1 approval in audit.md — this is a bolt, not a rebind. Run /bolt ' + bolt);

  const allTs = existsSync(specDir) ? readdirSync(specDir).filter((f) => f.endsWith('.ts')) : [];
  const specs = allTs.filter((f) => f.endsWith('.spec.ts'));
  if (!specs.length) blockers.push(`no specs in ${testsDir}/${bolt}/ — generate them first`);

  // --- how much work ---------------------------------------------------------
  // Count across every .ts, not just the specs. Generated bolts put their
  // locators and their env reads in helpers.ts, so a spec-only scan under-reports
  // the work and — worse — misses required variables entirely.
  let totalUnverified = 0;
  let totalPending = 0;
  const rows = [];
  for (const f of allTs) {
    const src = readFileSync(join(specDir, f), 'utf8');
    const u = (src.match(UNVERIFIED) || []).length;
    const p = (src.match(PENDING) || []).length;
    totalUnverified += u;
    totalPending += p;
    rows.push({ file: f, unverified: u, pending: p, isSpec: f.endsWith('.spec.ts') });
  }

  if (specs.length) {
    head('To bind');
    for (const r of rows) {
      const tag = r.isSpec ? (r.pending ? c.yellow('@pending') : c.green('bound')) : c.dim('helper');
      console.log(`  ${r.file.padEnd(34)} ${String(r.unverified).padStart(3)} unverified  ${tag}`);
    }
    console.log(`\n  ${specs.length} spec(s), ${totalUnverified} unverified locator reference(s)`);
    if (!totalUnverified && !totalPending) info('nothing marked unverified — this bolt may already be bound');
  }

  // --- can we actually observe anything? -----------------------------------
  head('Application');
  const mode = get(cfg, 'project.mode');
  const url = String(get(cfg, 'app.url') || '').trim();

  if (mode === 'greenfield') {
    blockers.push('project.mode is still "greenfield" — set it to "brownfield" in e2e.config.yml, or the config disagrees with what you are about to do');
  } else {
    ok(`mode: ${mode}`);
  }

  if (!url) {
    blockers.push('app.url is empty — there is nothing to observe');
  } else {
    const reachable = await ping(url);
    if (reachable.ok) ok(`${url} (${reachable.status})`);
    else blockers.push(`${url} is not reachable (${reachable.detail})`);
  }

  const seed = join(root, 'tests/seed.spec.ts');
  existsSync(seed)
    ? ok('tests/seed.spec.ts present — run it before binding, every test inherits its shape')
    : blockers.push('tests/seed.spec.ts is missing');

  // --- credentials: the quiet one ------------------------------------------
  head('Credentials');
  const envFile = join(root, '.env.local');
  const env = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const needed = [
    get(cfg, 'app.auth.user_env', 'E2E_USER'),
    get(cfg, 'app.auth.password_env', 'E2E_PASSWORD'),
  ].filter(Boolean);

  // Anything the specs read from process.env is also required, or the bound
  // suite cannot run even if every locator resolves.
  // A variable read with a fallback -- process.env.X || 'default', ?? 'default' --
  // is optional by construction. Reporting it as a blocker blocks on nothing, and
  // a blocker list with nothing at stake in it is one people learn to skim past.
  const referenced = new Set();
  const optional = new Set();
  for (const f of allTs) {
    const src = readFileSync(join(specDir, f), 'utf8');
    const scan = (re, group = 1) => {
      for (const m of src.matchAll(re)) {
        referenced.add(m[group]);
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 40);
        if (/^\s*(\|\||\?\?)/.test(after)) optional.add(m[group]);
      }
    };
    scan(/process\.env\.([A-Z][A-Z0-9_]*)/g);
    scan(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g);
  }
  for (const r of referenced) if (!needed.includes(r)) needed.push(r);

  const values = new Map();
  for (const line of env.split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) values.set(m[1], m[2].trim());
  }

  for (const name of needed) {
    const v = values.get(name);
    if (v === undefined && optional.has(name)) {
      info(`${name} not set — the code supplies a default, so this is optional`);
    } else if (v === undefined) blockers.push(`${name} is not set in .env.local`);
    else if (PLACEHOLDER.test(v)) {
      blockers.push(`${name} is still a placeholder ("${v}") — the app will answer with a login page and every locator bound will be the wrong one`);
    } else ok(`${name} is set`);
  }

  // --- verdict --------------------------------------------------------------
  console.log('');
  if (blockers.length) {
    head(`${blockers.length} blocker(s) — do not start`);
    for (const b of blockers) bad(b);
    console.log(`\n  ${c.dim('Fix these, re-run this command, then:')}  ${c.blue(`/rebind ${bolt}`)}\n`);
    process.exitCode = 1;
    return { ok: false, blockers, specs: specs.length, unverified: totalUnverified };
  }

  ok('ready to rebind');
  console.log(`\n  In Claude Code:  ${c.blue(`/rebind ${bolt}`)}`);
  console.log(`  ${c.dim('Gate 1 and Gate 2 stay approved. Only the locators are in question.')}\n`);
  return { ok: true, blockers: [], specs: specs.length, unverified: totalUnverified };
}

async function ping(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    clearTimeout(t);
    return { ok: res.status < 500, status: res.status, detail: String(res.status) };
  } catch (err) {
    return { ok: false, status: 0, detail: err.name === 'AbortError' ? 'timed out' : err.message };
  }
}
