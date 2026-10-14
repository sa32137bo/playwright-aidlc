# Glossary — org baseline

Terms this kit uses in a specific way. Add project terms in
`knowledge/project/domain-glossary.md`, not here.

| Term | Meaning |
|---|---|
| **Bolt** | One unit of work = one story = one PR. The AI-DLC equivalent of a sprint, measured in hours. Capped at 25 scenarios so a human can actually review it. |
| **Gate 1** | Plan approval. A hard stop under every autonomy mode. A wrong plan produces a dozen wrong tests. |
| **Gate 2** | Generated-code review against the checklist. |
| **Gate 3** | PR review and merge. Humans only. |
| **Greenfield** | Stories exist, the app does not yet. Tests are written first and expected to fail. |
| **Brownfield** | Stories and a running app both exist. Both are consulted and disagreements are reported. |
| **Characterization** | A running app with no usable requirements. Tests describe current behaviour; nothing is called a bug. |
| **Discrepancy** | Source code and the live app disagree. Reported, never silently resolved. Often a real bug. |
| **Seed test** | `tests/seed.spec.ts`. Bootstraps auth, fixtures and global setup. Every generated test inherits its shape. |
| **App context** | `context/app-context.md`. Code-side grounding: routes, validation rules, exact messages, API calls, flags. |
| **Audit log** | `bolts/<ID>/audit.md`. Every question asked, decision made and approval given. |
| **Classification** | The healer's first act: product bug / test defect / environment / flake. Repair only follows classification. |
| **Traceability matrix** | `docs/traceability-matrix.md`. story → scenario → test → last result. Release visibility. |
