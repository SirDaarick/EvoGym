# First-wave integration: current branch record

The A/B/C packages are integrated locally on `codex/abc-integration-alignment`; this is **not** a completed merge into `codex/backend-foundation` or another primary branch. Keep the original A/B/C worktrees and primary worktree unchanged. The user approved a local size exception for this integration on 2026-10-26; it does not authorize push, PR, production access, or destructive cleanup.

## Provenance and branch boundaries

| Source | Original HEAD | Snapshot ref/commit | Integration result |
|---|---|---|---|
| A — identity/access | `82fc09b7b88be783ec978da2407a32bad48045c3` | `refs/abc-snapshots/a` / `8e9cf7393d149d8a15067e5dbb85b3ea6d107cb7` | selected source snapshot |
| B — member read/reload | `f279ec87c2e4c62cb65e7066aff1c47a11454498` | `refs/abc-snapshots/b` / `de26cd081ca09d8fd54b7d4badac514cd72301b1` | HEAD ancestry plus captured dirty delta |
| C — staff attendance | `67046388d7c46a4c300a305e1a6983585468fed0` | `refs/abc-snapshots/c` / `12702cfcb7229fe72871c9b281a817372ea69c4a` | HEAD ancestry plus captured dirty delta |

The integration commits are `8e9cf73` (A snapshot), `5761d02` (B integration), and `c033032` (C integration); T2 is `a637518`, T3's initial route work is `941f846`, and its correction is `fa32256`. The current task checkout was observed at `ae7bf33decc421c3d3b2799127ea5b084b06202e`. The initial A/B/C migration files had separate revision identities; the integration keeps A's `0031` through `0037` lineage and assigns C's occurrence migration `0038_staff_occurrence_attendance` after `0037_paired_profile_access`. `alembic heads` was observed as one head, `0038_staff_occurrence_attendance`; this was a lineage conflict, not two migrations with an identical revision ID.

The snapshot is 185 selected paths and 24,559 authored changed lines relative to `82fc09b` (23,506 additions and 1,053 deletions). Private spreadsheets/notebooks, generated output, temporary databases, build artifacts, secrets, and environment files were excluded. Snapshot provenance is not product acceptance. No primary-branch merge has been performed.

## Integration decisions and actual behavior

- A's configured signed Admin-session validation remains authoritative. The B/C unsigned-admin fallback was removed; tests use the approved signed-session flow. Staff sessions retain their separately tested behavior when Admin signing is not configured.
- B's API-backed member list/detail/reload use the existing member screens and session providers. Existing read/reload operations are read-only. The existing `Mostrador` action is unavailable in API mode because this backend integration has no operational member-counter action contract; it is not implemented by a fixture fallback.
- C's roster/attendance views use the existing authenticated API client and real endpoints. Empty/error states do not fall back to demo fixtures. Unsupported actions are not represented as implemented.
- The initial T3 implementation was rejected in parent spot-check because it replaced existing member screens; `fa32256` restored the existing list/detail layouts and their search, sorting, tabs, and Admin-only debt display. Do not replace those screens again.
- The integration has semantic conflict resolutions; do not describe it as conflict-free. No unresolved Git conflict paths were reported after T1.

## Verification record

| Check | Observed result | Status |
|---|---|---|
| Integrated migration graph | one head: `0038_staff_occurrence_attendance` | passed |
| T2 focused API suite | 184 passed | passed |
| `api/tests/test_migrations.py` | 37 passed | passed |
| `api/tests/test_staff_schedules.py` | 30 passed | passed |
| PostgreSQL migration checks | 4 skipped; no disposable PostgreSQL target configured | unverified |
| T3 focused Vitest suites | 7 files / 92 tests passed | passed |
| App and node TypeScript projects | both passed using the installed primary frontend toolchain | passed |
| Full integrated API suite before this smoke correction | 526 collected; 507 passed, 18 skipped, 1 failed at `api/tests/test_contract_smoke.py:100` because the schema inventory omitted migration-created `staff_attendance_corrections`; the same smoke test also expected the old `0037` head | underlying omissions corrected; focused smoke now 4 passed |
| Full frontend suite, frontend build, browser workflows | not run | pending |

For the focused smoke test, use the installed API interpreter explicitly and keep the integration tree as the source/import root. From the integration `api` directory in PowerShell:

```powershell
$env:PYTHONPATH = (Resolve-Path .).Path
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym\api\.venv\Scripts\python.exe' -m pytest -c pyproject.toml -p no:cacheprovider tests/test_contract_smoke.py
```

Use the same interpreter and environment for `tests/test_migrations.py`. The integration checkout does not contain its own `.venv`; do not use `..\.venv`, a bare `pytest`, root-level TypeScript commands, or install dependencies as a substitute. Full frontend/type/build/browser verification remains T5 and must use the already-installed frontend toolchain without editing frontend files in this task.

## Rollback and preservation

Do not use `git reset --hard` or a blanket reset: that can destroy unrelated or dirty worktree state. Before any future rollback, inspect `git status` and use a new branch/ref or a narrowly scoped revert of the exact integration commit after confirming its parent and affected paths. Keep the original A/B/C and primary worktrees untouched. No merge to the primary branch is authorized or performed here.

## Next step

T4 documentation and the focused smoke proof are complete. Owner acceptance remains pending. `tests/test_migrations.py` previously passed 37 tests during T2; PostgreSQL-specific checks remain skipped without a disposable target. T5 still requires complete integrated verification; T6 remains blocked on T5 and owner acceptance. Do not mark the integration verified or merge it to the primary branch until those checks and owner acceptance are complete.