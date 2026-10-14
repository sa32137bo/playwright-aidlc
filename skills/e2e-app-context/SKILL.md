---
name: e2e-app-context
description: Derive a testable map of a web application from its source code - routes, components, test IDs, forms, validation rules, error messages, API calls, roles and feature flags - and write it to context/app-context.md. Use before planning end-to-end tests, when the user asks what a feature actually does, when test coverage needs to be grounded in code rather than clicking around, or when app-context.md is stale or missing.
license: Proprietary
---

# Application Context From Source

Produces `context/app-context.md`: the code-side half of test grounding. The live app tells you what renders; this tells you what is *supposed* to happen and which branches exist.

## First: what depth are you running at?

`source.grounding` in `e2e.config.yml` decides how much of this skill applies. Resolve it before doing anything, in this order:

1. an explicit `--depth` / `--grounding` flag
2. `code_grounding:` in `bolts/<ID>/intake.yml`
3. **`risk: high` in the intake → `deep`**, overriding the project default
4. `source.grounding` in `e2e.config.yml`
5. default `scan`

A blank or missing `source.path` means `off` regardless of the above — there is nothing to read, and that is a normal configuration, not an error.

| Depth | You do | Discrepancy detection |
|---|---|---|
| `off` | **nothing.** Skip this skill entirely. Say so at Gate 1. | disabled |
| `scan` | run the scanner, stop there | **partial** — strings, test IDs, form fields, routes |
| `deep` | run the scanner, then the semantic pass below | full |

**Always state the depth and its consequence at Gate 1.** A `scan` bolt that implies full discrepancy detection is lying to the reviewer.

**This depth setting is scoped to this skill alone — reading source code.** It has no bearing on Knowledge Assistant grounding (`e2e-intake` step 4a), which always runs on its own, independent gate regardless of what this resolves to. Confirmed as a real miss, not theoretical (GHC run-9): a bolt with `code_grounding` at `off` never even attempted a correctly-configured Knowledge Assistant call, because the shared word "grounding" led the agent to treat the two as one decision. They are not.

## Run the scanner

```bash
npx pw-aidlc context --depth <scan|deep> --paths "<bolt scope>" --if-stale
```

It reads `source.path` from `e2e.config.yml`. Deterministic and cheap. It emits routes, `data-testid` values, aria-labels, form fields, HTTP calls, exact user-facing strings, feature flags and detected OpenAPI/GraphQL files.

Two flags that matter for speed:

- **`--paths`** — pass the bolt's `scope.source_paths`. Scanning one subtree instead of the whole tree is the difference between seconds and minutes on a large repo. Always pass it when the bolt has a scope.
- **`--if-stale`** — no-ops when the source has not changed since the last scan, verified by a content hash rather than a guess.

**At `scan`, you are done here.** Do not read source files. That restraint is the whole point of the setting.

## Only at `deep`: fill the gaps the scanner cannot

The scanner does regex-level extraction. You do the semantic layer. Read only the files it flagged as relevant to the bolt's `scope`, not the whole repo.

For each route or component in scope, extract and record:

**Validation rules.** Every branch that can reject input. Field, rule, and the *exact* user-visible message. `"Email is required"` is testable; "shows an error" is not. Quote the string from the source, and note the i18n key if messages come from a bundle.

**State transitions.** What can this screen be in — empty, loading, populated, error, partial, permission-denied? Which of these does the code actually produce? Empty and error states are the ones manual exploration always misses.

**Server interactions.** Endpoint, method, when it fires, and what the UI does with each response class (2xx / 4xx / 5xx / timeout). Note anything the UI handles optimistically, because that is where flaky assertions come from.

**Authorization.** Which roles see which controls. Anything gated behind a permission check is a scenario.

**Feature flags.** Any flag that changes the flow in scope, its default, and where it is read. A plan that ignores flags generates tests that pass locally and fail in CI.

**Async and timing.** Debounces, polling, retries, animations, optimistic updates. These are the source of the waits the generator will need — and the reason never to reach for a fixed sleep.

**Locator readiness.** Do the elements in scope carry `data-testid` or accessible roles and names? If a flow in scope has neither, say so loudly. Tests written against div-soup will be brittle no matter how good the agent is, and the honest recommendation is to add test IDs to the source first.

## Output format

```markdown
---
generated_at: <ISO>
commit: <sha>
scope: <what was scanned>
code_grounding: <off|scan|deep — the depth resolved above, for e2e-plan to read>
---

# Application Context

## Routes
| Path | Component | Auth | Notes |

## Surfaces in scope
### <Route or feature>
- **Purpose:**
- **Test IDs present:** <list, or NONE — flag this>
- **Forms:** field → type → validation rule → exact message
- **States:** empty / loading / error / …
- **API calls:** METHOD /path — fires when — UI response per status class
- **Roles:**
- **Feature flags:**
- **Async behaviour:**

## Locator readiness
<per surface: good / partial / poor, with what is missing>

## Open questions for the team
<things the code does not answer>
```

## When source is front-end only

If `source.frontend_only` is true you can see client-side validation but not what
the server enforces. Say so explicitly in the output, and read
`inputs/contracts/` if a contract is present — an OpenAPI spec recovers most of
the missing validation, status codes and required fields. Without either, note in
`## Open questions` that server-side rules are unverified, so Gate 1 knows the
discrepancy check is partial.

## Rules

- Cite file paths. Every non-obvious claim should be traceable to a file the reviewer can open.
- Quote user-visible strings exactly. Do not paraphrase an error message you intend to assert on.
- Do not speculate. If you cannot tell from the code whether something happens, put it under open questions.
- Never copy secrets, tokens, connection strings, or real customer data into this file. It gets committed.
- Keep it under about 600 lines. If the app is larger, scope it to the bolt and say what you excluded.
