import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'),
  yellow: wrap('33'), blue: wrap('36'), grey: wrap('90'),
};

export const ok = (m) => console.log(`  ${c.green('✓')} ${m}`);
export const warn = (m) => console.log(`  ${c.yellow('!')} ${m}`);
export const bad = (m) => console.log(`  ${c.red('✗')} ${m}`);
export const info = (m) => console.log(`  ${c.dim('·')} ${c.dim(m)}`);
export const head = (m) => console.log(`\n${c.bold(m)}`);

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const VALUE_FLAGS = new Set(['src', 'url', 'jira', 'mode', 'type', 'name', 'root', 'out', 'paths', 'grep', 'bolt', 'file', 'dir', 'depth', 'grounding', 'max-files', 'since', 'export', 'import', 'format', 'stamp', 'check', 'story-diff', 'story']);
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = VALUE_FLAGS.has(k) ? '' : true;
    } else out._.push(a);
  }
  return out;
}

/** Write a file, creating parents. Never clobbers unless force. */
export function write(path, content, { force = false, quiet = false } = {}) {
  if (existsSync(path) && !force) {
    if (!quiet) info(`exists, left alone: ${path}`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  if (!quiet) ok(path);
  return true;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

/** Append lines to .gitignore that are not already present. */
export function ensureGitignore(root, lines) {
  const p = join(root, '.gitignore');
  const existing = existsSync(p) ? readFileSync(p, 'utf8').split('\n').map((l) => l.trim()) : [];
  const missing = lines.filter((l) => !existing.includes(l));
  if (!missing.length) return 0;
  const block = `${existing.length ? '\n' : ''}# playwright-aidlc-kit — never commit these\n${missing.join('\n')}\n`;
  appendFileSync(p, block, 'utf8');
  return missing.length;
}

export async function prompt(question, { default: dflt, choices } = {}) {
  const rl = createInterface({ input: stdin, output: stdout });
  const hint = choices ? ` ${c.grey(`(${choices.join(' / ')})`)}` : '';
  const def = dflt ? ` ${c.grey(`[${dflt}]`)}` : '';
  try {
    for (;;) {
      const answer = (await rl.question(`${question}${hint}${def}: `)).trim();
      const value = answer || dflt || '';
      if (choices && value && !choices.includes(value)) {
        console.log(c.red(`  must be one of: ${choices.join(', ')}`));
        continue;
      }
      return value;
    }
  } finally {
    rl.close();
  }
}

export function loadConfig(root = process.cwd()) {
  const p = join(root, 'e2e.config.yml');
  if (!existsSync(p)) return null;
  return { path: p, raw: readFileSync(p, 'utf8'), ...parseSimpleYaml(readFileSync(p, 'utf8')) };
}

/**
 * Minimal YAML reader for our own config shape: nested maps, scalars and
 * "- " lists, two-space indent. Deliberately not a general YAML parser —
 * it keeps the kit dependency-free and our config is ours to keep simple.
 */
export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  // Split on both line endings. Splitting on "\n" alone leaves a trailing "\r"
  // on CRLF files, and since "." does not match "\r", the comment-stripping
  // regex below then fails to anchor — silently folding every inline comment
  // into the value it follows. That made every commented scalar in a
  // Windows-checked-out config parse wrong.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (body.startsWith('- ')) {
      const key = stack[stack.length - 1].lastKey;
      const holder = stack[stack.length - 1].node;
      if (key && !Array.isArray(holder[key])) holder[key] = [];
      if (key) holder[key].push(coerce(body.slice(2).trim()));
      continue;
    }
    const m = /^([\w.-]+):\s*(.*)$/.exec(body);
    if (!m) continue;
    const [, key, value] = m;
    if (value === '') {
      const node = {};
      parent[key] = node;
      stack[stack.length - 1].lastKey = key;
      stack.push({ indent, node, lastKey: null });
    } else {
      parent[key] = coerce(value);
      stack[stack.length - 1].lastKey = key;
    }
  }
  return root;
}

function coerce(v) {
  const trimmed = v.trim();
  // Inline list — `browsers: ["chromium"]` — used throughout our own templates,
  // but never actually parsed as a list: without this, every inline-bracket
  // value came back as the literal string "[\"chromium\"]", so `Array.isArray()`
  // checks against it (e.g. the browsers-drift check below) silently saw
  // nothing and never fired. Not a general CSV parser — a comma inside a
  // quoted item (`["a, b"]`) will split wrong, which is an acceptable limit
  // for config values that are themselves simple tokens (browser names, globs,
  // URLs), not prose.
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => coerce(item.trim())) : [];
  }
  const s = trimmed.replace(/^["']|["']$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

export function get(obj, path, dflt = undefined) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj) ?? dflt;
}

export const GROUNDING_LEVELS = ['off', 'scan', 'deep'];

/**
 * Resolve how much code-side grounding a run should do.
 *
 * Precedence, highest first:
 *   1. an explicit --depth / --grounding flag
 *   2. `grounding:` in the bolt's intake.yml
 *   3. risk escalation — `risk: high` forces deep
 *   4. `source.grounding` in e2e.config.yml
 *   5. the default, "scan"
 *
 * With one override on top of all of it: no usable `source.path` means there is
 * nothing to read, so the answer is "off" regardless of what anyone asked for.
 * That is what makes the setting safe to leave alone — a project without source
 * simply plans from the live app.
 *
 * Returns { depth, reason, sourcePath } so callers can *say* why, which matters
 * at Gate 1: a bolt that silently ran shallow is worse than a slow one.
 */
export function resolveGrounding({ cfg = null, flag = '', intake = '', risk = '' } = {}) {
  const rawPath = get(cfg, 'source.path');
  const sourcePath = typeof rawPath === 'string' ? rawPath.trim() : '';

  const clean = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const valid = (v) => (GROUNDING_LEVELS.includes(v) ? v : '');

  if (!sourcePath) {
    return { depth: 'off', sourcePath: '', reason: 'no source.path configured — planning from the live app only' };
  }

  const fromFlag = valid(clean(flag));
  if (fromFlag) return { depth: fromFlag, sourcePath, reason: `--depth ${fromFlag}` };

  const fromIntake = valid(clean(intake));
  if (fromIntake) return { depth: fromIntake, sourcePath, reason: `intake.yml grounding: ${fromIntake}` };

  if (clean(risk) === 'high') {
    return { depth: 'deep', sourcePath, reason: 'escalated to deep because this bolt is risk: high' };
  }

  const rawCfg = get(cfg, 'source.grounding');
  const fromCfg = valid(clean(rawCfg));
  if (fromCfg) return { depth: fromCfg, sourcePath, reason: `e2e.config.yml source.grounding: ${fromCfg}` };

  // Set but not one of the three levels: fall back, and say so rather than
  // reporting it as unset — otherwise a typo looks like a deliberate default.
  if (rawCfg !== undefined && rawCfg !== null && String(rawCfg).trim() !== '') {
    return { depth: 'scan', sourcePath, reason: `source.grounding "${rawCfg}" is not valid — falling back to scan` };
  }

  return { depth: 'scan', sourcePath, reason: 'default (source.grounding not set)' };
}
