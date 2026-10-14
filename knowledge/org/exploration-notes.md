# Exploration tooling notes

Gotchas in the exploration *tooling itself* — the harness, the interop, the MCP
browser tools — as distinct from anything about a specific application. A
locator or app quirk belongs in `knowledge/project/*-known-flaky-areas.md`
instead; this file is for "the tool lied to you about what actually failed."
`locator-policy.md` and `assertion-catalog.md` cover generated specs, not the
throwaway exploration scripts that precede them — record exploration-tooling
facts here, not only in `explore-harness.js`'s header, which a bolt may never open.

## `page.evaluate` cannot be called through the `tsx/cjs` exploration interop

`explore-harness.js` documents a `require('tsx/cjs')` interop for calling a
real `support/clc.ts` helper from a plain CommonJS `.explore/*.js` script,
instead of hand-copying its code. A helper built on `page.evaluate(fn, ...)`
is the one shape that interop cannot carry: tsx injects a `__name` helper into
the *module's* scope, but `page.evaluate` serialises the function body and
re-executes it in the *browser's page context*, which never had that helper.
The failure is `ReferenceError: __name is not defined` — indistinguishable
from a broken locator at first sight (bolt `US-CLC-003`, 2026-09-20: cost a
wasted diagnostic-sweep attempt).

Not a reason to avoid the interop generally — only `page.evaluate`-based
helpers are affected. Re-derive that one helper's logic directly in the
exploration script instead of calling it through the interop; everything else
in `clc.ts` (or an equivalent project support module) is unaffected.
