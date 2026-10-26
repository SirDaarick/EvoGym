# First-wave integration: current branch record

The A/B/C packages are integrated locally on `codex/abc-integration-alignment`; this is **not** a completed merge into `codex/backend-foundation` or another primary branch. Keep the original A/B/C worktrees and primary worktree unchanged. The user approved a local size exception for this integration on 2026-10-26; it does not authorize push, PR, production access, or destructive cleanup.

## Provenance and branch boundaries

| Source | Original HEAD | Snapshot ref/commit | Integration result |
|---|---|---|---|
| A — identity/access | `82fc09b7b88be783ec978da2407a32bad48045c3` | `refs/abc-snapshots/a` / `8e9cf7393d149d8a15067e5dbb85b3ea6d107cb7` | selected source snapshot |
| B — member read/reload | `f279ec87c2e4c62cb65e7066aff1c47a11454498` | `refs/abc-snapshots/b` / `de26cd081ca09d8fd54b7d4badac514cd72301b1` | HEAD ancestry plus captured dirty delta |
| C — staff attendance | `67046388d7c46a4c300a305e1a6983585468fed0` | `refs/abc-snapshots/c` / `12702cfcb7229fe72871c9b281a817372ea69c4a` | HEAD ancestry plus captured dirty delta |

The integration commits are `8e9cf73` (A snapshot), `5761d02` (B integration), and `c033032` (C integration); T2 is `a637518`, T3's initial route work is `941f846`, and its correction is `fa32256`. The current task checkout was observed at `ae7bf33decc421c3d3b2799127ea5b084b06202e`. The initial A/B/C migration files had separate revision identities; the integration keeps A's `0031` through `0037` lineage and assigns C's occurrence migration `0038_staff_occurrence_attendance` after `0037_paired_profile_access`. `alembic heads` was observed as one head, `0038_staff_occurrence_attendance`; this was a lineage conflict, not two migrations with an identical revision ID.

The snapshot is 185 selected paths and 24,559 authored changed lines relative to `82fc09b` (23,506 additions and 1,053 deletions). Private spreadsheets/notebooks, generated output, temporary databases, build artifacts, secrets, and environment files were excluded. Snapshot provenance is not product acceptance. T3/T5 have engineering acceptance, not owner business signoff. The user authorized the local merge and size exception; no merge into the primary checkout was performed in this work unit.

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
| Final full API suite at `96c558f526` | 508 passed, 18 skipped, 27 warnings; 866.04 s; exit 0. 17 PostgreSQL checks need `EVOGYM_TEST_POSTGRES_URL` for a disposable target; one Windows directory-symlink check unavailable. | passed with stated skips |
| Full frontend suite at `96c558f` | 97 files / 739 tests passed; `vitest run --config TEMPvite.verify.config.ts --configLoader runner --testTimeout30000 --maxWorkers1`; 605.67 s. Explicit 15-second app-test timeout unchanged; earlier 5-second inventory and 15-second app CPU-load timeouts passed in final serialized run. | passed |
| App/node TypeScript and temporary production Vite build | passed; build reported 775.61 kB chunk and ineffective dynamic-import warnings, performance cleanup out of scope | passed with non-blocking warnings |
| Independent review and parent TypeScript spot-check | no further must-fix T3 issue; TypeScript spot-check passed | passed |
| Parent CUA smoke, fresh SQLite fixture, demo off, 105 synthetic members | four workflows passed: approved Admin login/poll-to-profile; Admin entry and employee PIN; member 105 lookup plus legal/preferred-name/number search and Admin detail/debt order ID; staff check-out persistence, re-entry/check-in, logout routing and Admin re-login. Unsupported histories/action remained honestly unavailable. No production data or credentials changed. | passed; pairing and temporary-PIN rotation not repeated in this browser pass |

For the focused smoke test, use the installed API interpreter explicitly and keep the integration tree as the source/import root. From the integration `api` directory in PowerShell:

```powershell
$env:PYTHONPATH = (Resolve-Path .).Path
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:\Users\edani\OneDrive\Documents\Proyectos\Daidev\EvoGym\api\.venv\Scripts\python.exe' -m pytest -c pyproject.toml -p no:cacheprovider tests/test_contract_smoke.py
```

Use the same interpreter and environment for `tests/test_migrations.py`. The integration checkout does not contain its own `.venv`; do not use `..\.venv`, a bare `pytest`, root-level TypeScript commands, or install dependencies as a substitute. T3/T5 engineering acceptance is recorded, not owner business signoff. PostgreSQL-specific cases remain skipped without a disposable target; device pairing and temporary-PIN rotation were not repeated in the browser pass, though existing unit/API coverage remains. The build's chunk-size and ineffective dynamic-import warnings remain out-of-scope performance follow-ups.

## Rollback and preservation

Do not use `git reset --hard` or a blanket reset: that can destroy unrelated or dirty worktree state. Before any future rollback, inspect `git status` and use a new branch/ref or a narrowly scoped revert of the exact integration commit after confirming its parent and affected paths. Keep the original A/B/C and primary worktrees untouched. The local merge into primary `codex/backend-foundation` is authorized but not performed here. Before that separate T6 work, preserve the primary checkout's 11 dirty, non-overlapping paths; do not hard-reset or blanket-autostash. No push, PR, production access, or destructive cleanup is authorized.

## Next step

T3/T5 engineering acceptance is complete, but it is not owner business signoff. The next step is T6: perform the authorized local merge into primary `codex/backend-foundation` while preserving its 11 dirty, non-overlapping paths. This work unit did not perform that merge. Keep the PostgreSQL target limitation and browser pairing/temporary-PIN coverage limitation visible; no push or PR was made.
