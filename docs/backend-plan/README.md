# Backend documentation: current state and historical design

**Start with the [2026-10-22 backend audit](../backend-audit/README.md)** for observed capability, defects, frontend gaps, commands/results and the completion roadmap. The API is implemented under [api/](../../api/README.md); this directory is the design/policy history, not a guarantee every described feature exists.

Observed local R1/R1a–R5 commits have focused clean proofs. At clean R5, API tests passed 335/17 PostgreSQL skips and typecheck/build passed, but full frontend verification recorded **2 failed/471 passed**; see the [committed receipt](../backend-audit/delivery-notes.md). Earlier dirty 367/578 passes are separate history. CORS/compiler repairs are not future tasks; remaining frontend suite failures, member reload/history/itemized reads, typed frontend errors and authorized PG proof remain. Documentation D1–D3/receipt closure is pending under approved local `auto-chain` / `feature-branch-chain`; no PR/push or full-backend completion is implied.

## Authority and reading path

1. [Business rules and decision register](02-business-rules-and-decisions.md): confirmed versus unresolved owner policy; do not infer answers from demo UI.
2. [Current findings](../backend-audit/findings.md), [frontend contracts](../backend-audit/frontend-contract-gaps.md) and [roadmap](../backend-audit/roadmap.md): dated evidence and implementation steps.
3. [Historical implementation ledger](../../odd/tasks/backend-implementation.md): work-unit history and prior proofs; status summaries require reconciliation, not percentage reporting.
4. [Audit documentation tracking](../../odd/tasks/backend-audit-documentation.md): this documentation unit only, not fix implementation.

## Existing design chapters

| Chapter | Use |
|---|---|
| [01 Domain and schema](01-domain-and-schema.md) | Intended domain/data structure |
| [02 Rules and decisions](02-business-rules-and-decisions.md) | Business authority and unresolved policy |
| [03 Architecture and API](03-architecture-and-api.md) | Architecture/contracts; compare against source |
| [04 Implementation phases](04-implementation-phases.md) | Historical phased scope and bounded slices |
| [05 Verification and coverage](05-verification-and-coverage.md) | Verification approach/history; current audit results supersede stale counts |
| [06 Security and operations](06-security-and-operations.md) | Security/operational requirements, not deployment certification |
| [07 Frontend migration and data](07-frontend-migration-and-data.md) | Historical integration plan; “none connected” statements are superseded by the partial live reception slice |
| [08 Local-first and sync](08-local-first-and-sync.md) | Intended offline queue/grant/receipt/delta contract, not completed offline support |

Preserve historical evidence rather than rewriting all phase documents. Current source, observed tests and confirmed decisions must accompany any new completion claim. In particular, STAFF-1 is a dirty/untracked draft and BK-042-S1 delivery does not complete the broader reporting domain.
