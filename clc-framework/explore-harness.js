// Shared boilerplate for throwaway .explore/*.js scripts.
//
// Every real exploration script across every bolt reviewed so far
// (aidlc-claudecode-run-4, aidlc-gitcopilot-run-4, aidlc-gitcopilot-run-4-
// boltb, aidlc-gitcopilot-run-5) independently re-wrote near-identical
// versions of everything in this file: .env.local loading, JWT/token
// redaction before anything touches disk, browser+context setup, and an
// accessibility-snapshot dump writer. That's pure retyping cost paid on
// every single exploration pass, on top of the actual navigation being
// explored. Requiring this instead means a throwaway script only has to
// contain the NEW thing being explored.
//
// Deliberately plain CommonJS (clc.package.json is "type": "commonjs",
// and every real exploration script observed uses bare `node script.js`,
// not a build step) — this file has zero CLC-app-specific locators in it,
// so it needs no TypeScript/ESM interop to be useful on its own.
//
// For CLC-specific navigation helpers (signIn, openHotelAdmin, etc.) from
// an exploration script, see the note at the bottom of this file — the
// require('tsx/cjs') interop loads a real support/clc.ts and exposes its
// exports as callable functions from plain CommonJS, verified against a
// real live CLC app (with one known limitation, also noted at the bottom).
// Use it instead of retyping a helper's code into a fresh .explore script
// — a hand-copy can drift from the real function silently, which calling
// it directly cannot.

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/** Reads .env.local (the same file the kit's own tests read via dotenv)
 * without adding a new dependency — walks up from this file's own location,
 * so it works whether it's required from .explore/ or from a subfolder. */
function loadEnvLocal(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env.local');
    if (fs.existsSync(candidate)) {
      for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        const v = m[2].trim().replace(/^["'](.*)["']$/, '$1');
        if (v && process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
      return;
    }
    dir = path.dirname(dir);
  }
}

/** Strips JWTs and common token query/form params before anything is
 * written to disk. `.explore/` is gitignored, but a captured token in a
 * throwaway file is still a real credential sitting on disk. */
function redact(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<REDACTED-JWT>')
    .replace(/(access_token|id_token|token)=[^&\s"']+/gi, '$1=<REDACTED>');
}

/**
 * Launches a browser + context the way every real exploration script has,
 * independently: headless, HTTPS errors ignored (the QA host's corporate CA
 * trips a default-strict context — see knowledge/project/environment-notes.md).
 *
 * `BASE_URL` in `.env.local` is documented as an *optional* override — the
 * authoritative URL is `e2e.config.yml`'s `app.url`, which this plain Node
 * harness cannot read (it's not a YAML parser). So `BASE_URL` is very
 * plausibly unset in a real project, and `signIn()`/other helpers in
 * `clc.ts` navigate with relative paths (`page.goto('/')`), which throws
 * without a baseURL configured somewhere. Pass `opts.baseURL` explicitly
 * (the real QA URL, or `e2e.config.yml`'s `app.url` value) rather than
 * relying on `BASE_URL` alone — this only falls back to it, and warns
 * loudly instead of failing silently on the first relative navigation if
 * neither is given.
 */
async function launch(opts = {}) {
  const baseURL = opts.baseURL || process.env.BASE_URL;
  if (!baseURL) {
    console.warn(
      '[explore-harness] No baseURL given and BASE_URL is not set in .env.local. ' +
      'signIn() and other relative page.goto() calls will throw. Pass launch({ baseURL: <app.url from e2e.config.yml> }).'
    );
  }
  const browser = await chromium.launch({ headless: opts.headless !== false });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL,
    viewport: opts.viewport || { width: 1600, height: 1200 },
  });
  const page = await context.newPage();
  return { browser, context, page };
}

/** Writes a redacted accessibility snapshot to <outDir>/<name>.snapshot.md.
 * `sel` scopes to one element; omit it to snapshot the whole body. */
async function dump(page, outDir, name, sel) {
  const target = sel ? page.locator(sel).first() : page.locator('body');
  const snap = redact(await target.ariaSnapshot());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${name}.snapshot.md`),
    `# ${name}\nURL: ${redact(page.url())}\n\n\`\`\`yaml\n${snap}\n\`\`\`\n`,
    'utf8'
  );
  console.log(`[dump] ${name} (${snap.length} chars)`);
}

/**
 * Checks whether THIS SCREEN pages its results, and says so explicitly.
 *
 * Confirmed live (bolt US-CLC-003, 2026-09-20): a grid's own "1 - 10 of 108
 * items" summary was on screen throughout three heal attempts, and no
 * exploration pass's inventory had checked for it — the retro's own words:
 * "my inventories captured headings, buttons, inputs and tables — but not
 * pagination." Call this once per screen, UNSCOPED, on arrival — before
 * deciding a grid's visible rows are the complete list of anything.
 *
 * The check is a text pattern ("N - N of N", "Page N of N"), not a widget
 * library's own CSS class — CrewHub's own pager happened to be plain text,
 * and a selector guessed from one occurrence on one library is exactly the
 * kind of unconfirmed generalisation this kit avoids elsewhere (see
 * `fixtures.ts`'s own header on the same discipline). A pattern match is
 * evidence either way; the absence of one is NOT proof the screen never
 * pages — say so rather than implying false confidence.
 */
async function dumpPager(page, outDir, name) {
  const text = redact(await page.locator('body').innerText());
  const match = text.match(/\b\d+\s*-\s*\d+\s+of\s+\d+\b/i) || text.match(/\bpage\s+\d+\s+of\s+\d+\b/i);
  const note = match
    ? `Pagination indicator found: "${match[0]}" — this screen's visible rows are NOT the complete list. Read the full set from a network response or an explicit "show all" control, not from the rendered DOM alone.`
    : 'No "N - N of N" / "Page N of N" text found on this screen. This does NOT prove the screen shows everything — a different pagination style (infinite scroll, a page-number control with no summary text) would not match either. Treat "no match" as inconclusive, not as confirmation.';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.pager.txt`), note + '\n', 'utf8');
  console.log(`[dumpPager] ${name}: ${note}`);
  return match ? match[0] : null;
}

module.exports = { loadEnvLocal, redact, launch, dump, dumpPager };

// ---------------------------------------------------------------------------
// Reusing CLC-specific navigation helpers (signIn, openHotelAdmin, ...) from
// a plain CommonJS exploration script:
//
//   require('tsx/cjs');
//   const { signIn, openHotelAdmin } = require('../tests/support/clc.ts');
//
// VERIFIED against a real, live CLC app (bolt US-CLC-003, 2026-09-20, the
// heal-bound diagnostic sweep): the require() interop itself works, loading
// the real support/clc.ts (not a stand-in) at its real path depth, and a
// plain navigation helper called through it drives a real live `page`
// correctly.
//
// ONE REAL LIMITATION, found the same run: a helper that internally calls
// `page.evaluate(fn, ...)` — e.g. `altListHotelKeys()` — fails when called
// through this interop, as `ReferenceError: __name is not defined`. tsx's
// compilation injects a `__name` helper into the MODULE's own scope, but
// `page.evaluate` serialises the function body as a string and re-runs it
// inside the BROWSER's page context, which never had that helper to begin
// with — the failure reads exactly like a broken locator, not a tooling
// limitation, and cost a wasted sweep run before it was diagnosed. Any
// clc.ts helper built on `page.evaluate` should therefore be re-derived
// directly in the exploration script when explored through this interop,
// not called through it — everything else in clc.ts is unaffected. See
// `knowledge/org/exploration-notes.md` for the general form of this.
// ---------------------------------------------------------------------------
