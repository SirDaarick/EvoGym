# Backend audit: verified remediation and remaining work

**2026-10-22, committed source delivery:** R1/R1a–R5 fixes have observed local commits and focused clean-prefix proofs. Clean R5 full verification passed API/typecheck/build, but the frontend full suite is **partial: 2 failed, 471 passed**. Owner's keyboard failure reproduces at baseline; Members' full-run timeout did not reproduce in the focused comparison and its cause remains unresolved. No PostgreSQL/hosted proof, complete backend or production certification is claimed.

## Reading order

1. [Findings and repair history](findings.md): implemented fixes, partial coverage, historical reproductions, hypotheses and owner decisions.
2. [Frontend contract gaps](frontend-contract-gaps.md): FE01/FE02 repaired; remaining live/demo/read-contract work.
3. [Completion roadmap](roadmap.md): next bounded unit, dependencies and production exit criteria.
4. [Decision register](../backend-plan/02-business-rules-and-decisions.md): authority for unresolved business policy.
5. [Remediation evidence](../../odd/tasks/backend-audit-remediation.md): R1–R6 scope, RED/GREEN receipts and pending delivery closure.

## Current committed verification — partial full frontend

Branch: `codex/backend-foundation`; source prefix `f1153da6ef5718a64cd8480a69f107699ac4ebea`, tree `766529c26777de83338d394ac70c39c152a41107`, compared with baseline `709466caa545d862c6effc53a9bbaf1a8a28d65f`. See the self-contained [committed receipt](delivery-notes.md) for commands, focused commit identities and baseline comparison. D1–D3 documentation identities/closure remain pending. No unowned code was committed; dirty graph 0030 is not in this clean prefix.

| Check | Current observed result | Boundary |
|---|---|---|
| Full API suite | **335 passed, 17 skipped, 18 warnings**, 371.75s | PostgreSQL opt-ins skipped; no live PG proof |
| Full frontend suite | **2 failed, 471 passed**, 63 files, 381.87s | Original failed result retained; no full retry |
| Frontend typecheck | Passed, 7.37s | R1a corrected two pre-existing fixture/compiler errors without adopting dirty model changes |
| Production/PWA build | Passed, approximately 38.79s; Vite 2.75s | Build success does not erase frontend test failures; not deployed |
| API `pip check` | No broken requirements, exit 0 | Not a vulnerability scan or lockfile guarantee |
| Alembic `heads` | `0029_class_sample_check_ins (head)` | No migration applied to PostgreSQL |
| Workflow YAML/AST and scoped whitespace checks | Passed | Module paths, guards and head comparisons verified structurally, not hosted execution |
| Browser E2E, vulnerability scan, deployment, live PG, hosted CI | Not run | No passes or production guarantees claimed |

Clean API verification recorded 18 warnings; the earlier dirty receipt recorded 19 (one Starlette/httpx deprecation plus 18 SQLite expression-index reflection warnings). The clean build's 524.79kB entry exceeds Vite's 500kB advisory threshold; build/PWA still passed. No advisory is attributed to these fixes, and no Ruff/mypy/Black result is claimed. The two clean frontend failures and baseline comparison are detailed in the [frontend follow-ups](frontend-contract-gaps.md).

### Historical dirty verification and preserved parallel work

Before clean delivery verification, the primary dirty snapshot passed **367 API tests/17 PG skips** and **578 frontend tests**; typecheck/build passed with graph 0030. The parent's 202-path hashes were identical across that earlier dirty verification. Those results include drafts and do not override the newer clean frontend failure or prove a committed prefix. This continuation writes documentation only.

Relative to the earlier 181-path remediation-start manifest, four non-owned paths evolved through other work: `api/app/api/staff_schedules.py`, `api/tests/test_staff_schedules.py`, `docs/backend-plan/04-implementation-phases.md`, and `odd/tasks/backend-implementation.md`. They were not adopted into the source chain or overwritten by the remediation writer. Evolved schedule tests passed in the dirty suite, not the clean 0029 graph; STAFF-1 is neither wholly delivered nor PostgreSQL-proven here.

## Reproduce the current safe local checks

Run in a **fresh PowerShell process** at the repository root. Environment changes are process-local; leave database URLs absent. Do not use production/staging or infer authorization for a PostgreSQL target.

```powershell
Get-ChildItem Env:EVOGYM_* | ForEach-Object { Remove-Item -LiteralPath ("Env:" + $_.Name) }
$env:EVOGYM_ENV = 'test'
$env:EVOGYM_DEBUG = 'false'
$env:PYTHONDONTWRITEBYTECODE = '1'
.\api\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider api/tests
.\api\.venv\Scripts\python.exe -m pip check
Push-Location api
try { .\.venv\Scripts\python.exe -m alembic heads } finally { Pop-Location }
Push-Location frontend
try {
  npm.cmd run typecheck
  npm.cmd test -- --maxWorkers=2 --reporter=dot
  npm.cmd run build
} finally { Pop-Location }
```

The snippet reproduces local primary-worktree checks, not automatically a clean-prefix receipt. Current committed checks used the same existing shared interpreter with clean API imports explicitly verified; exact module commands and directories are in [delivery notes](delivery-notes.md). No applications were rerun for these passive documentation edits. Recorded Python: 3.14.5.

## Historical audit evidence: do not confuse with current results

Before remediation, the audit recorded **252 passed/17 skipped/19 warnings** (318.50s), 24 focused frontend passes, and two compiler errors: missing `sameMonotonicOrigin` in the clock fixture and an `unknown` plan-version ID in checkout. Full frontend attempts were interrupted with **no verdict**, and build was then deliberately not run. Current full/typecheck/build results above supersede those limitations; the historical failures remain useful regression provenance.

During that earlier audit-document finalization, fingerprints changed in six pre-existing files: `api/app/main.py`, `api/tests/test_contract_smoke.py`, `api/tests/test_migrations.py`, `api/tests/test_staff_schedules.py`, `docs/backend-plan/04-implementation-phases.md`, and `odd/tasks/backend-implementation.md`. Cause/semantic differences were unestablished and files were left untouched. That **historical** caveat limited the old 252-test snapshot; it is not drift during the later stable 202-path independent verification.

## Repository, ownership and delivery boundaries

- Runtime API: [api/](../../api/README.md). `backend/` remains the notebook/private-data workspace; no tracked files existed there at the original audit baseline. Never move private data into API artifacts.
- [Backend plan navigation](../backend-plan/README.md) preserves design/history. The original [audit-document task](../../odd/tasks/backend-audit-documentation.md) remains a separate pending delivery unit; implementation evidence belongs in [remediation tracking](../../odd/tasks/backend-audit-remediation.md).
- RDD remains off. User-approved `auto-chain` / `feature-branch-chain` is local only; six source commits are observed, D1–D3 documentation and optional final receipt bookkeeping remain pending. No PR, push, publication or approved PR-size exception is claimed.
- Private/generated/source file classification, ignore rules and destructive cleanup were **not** performed. Preserve `tmp/`, `output/`, editor configuration and private workspaces until separately classified/authorized; do not publish private filenames.

Next: authorized member reload/history/itemized-debt read contracts and typed frontend error integration, or isolated PostgreSQL proof once a disposable target is authorized. See the [roadmap](roadmap.md); the broader backend remains incomplete.
