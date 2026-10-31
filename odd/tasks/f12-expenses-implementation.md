# F12 — Record and review expenses (implementation plan)

Objective: implement the expense backend and wire it into the existing frontend, adding only the UI elements the user approved (category, voucher/photo, void, business expenses), placed inside existing surfaces with existing patterns. Status: **execution authorized; implementation pending.** Baseline: HEAD `330ebf5` (merge F11); the two F12 planning documents were untracked at execution start.
Branch: `feat/f12-expenses`; delivery: `feature-branch-chain` (user selected); test runners: pytest and Vitest.

Discovery source: [f12-expenses.md](f12-expenses.md) (this plan supersedes its §4 placements and its "public URL" evidence model). Card: [remaining-feature-integrations.md § F12](remaining-feature-integrations.md#f12--record-and-review-expenses-p2-c). Mode: Ponytail full.

## Specs

- **S1 — Frontend is the contract, with approved additions.** User (turn 1): "tenemos que tomar el frontend como contrato ya que ya tenemos un diseño hecho que no hay que cambiar [...] en caso de que haya un elemento del backend que no tenga representacion en el frontend dime para planear juntos como implementarlo." User (turn 2): "si me gustaria que apareciera la categoria del gasto, entonces si ya hay algun lugar donde se puede implementar esta bien." New UI is limited to the placements in *Approved UI additions*, reusing existing components, classes and dialogs. No layout/CSS redesign.
- **S2 — Category.** Each expense stores an explicit category chosen at entry. It replaces the concept-based inference in the owner view.
- **S3 — Voucher and photo evidence, R2-ready, emulated locally.** User: "quizas no el cloudflareR2 pero si emularlo localmente, subirlo y todo eso listo tanto en el frontend como en el backend." Optional voucher reference + optional photo compressed in the browser to WebP and uploaded with a backend-issued pre-signed URL. Locally the storage is emulated; switching to Cloudflare R2 must be configuration only. Evidence is private: the DB stores the object key, reads get a short-lived signed URL.
- **S4 — Void.** User: "me gustaria anular gastos". Append-only records; void sets `voided_at/by/reason` (reason required). Shift expenses can be voided only while their shift is open; business expenses by finance admins. Voided rows stay visible (badge) and are excluded from totals, chart and expected cash.
- **S5 — Business expenses.** User: "los gastos del negocio por transferencia y tarjeta tambien de una vez". Finance admins record expenses not tied to a shift, with method transfer, card or cash (cash outside the drawer). They never affect shift cash.
- **S6 — No drawer-balance guard.** User: "en caja no suele haber mucho dinero por lo que D6 tampoco le veo mucho sentido". An expense may exceed current expected cash; the close shows the resulting difference. Former D6 dropped.
- **S7 — Reception petty cash & reconciliation.** `GastoModal` live records cash expenses against the selected register's open shift; history shows that shift's expenses. `expected_cash_for_shift` subtracts active shift expenses; live Turno KPI "Gastos" and close-dialog "Gastos" row show real values.
- **S8 — Owner review.** `/owner/expenses?tab=gastos` shows persisted expenses (shift + business) for the date range in `ExpensesView`, scoped by finance permissions, reload-safe.
- **S9 — Safety.** 422 invalid input; 409 no/closed shift and void on closed shift or already voided; 403 wrong branch/role; idempotent creates (same key replays, altered body → 409); rejected commands leave data unchanged.

## Resolved decisions

- **Q1 — Local storage emulation: MinIO.** User: "la A esta bien". Add a MinIO service (loopback-only port, named dev volume, bucket bootstrap) to `docker-compose.yml` and `boto3` to the API. MinIO speaks the S3 API R2 uses, so pre-signed PUT/GET URLs are real locally and R2 later is only env vars (`endpoint`, keys, bucket). Bucket CORS must allow the Vite origin for browser PUT. `docker-compose.prod.yml` is not touched.

## Added scope (Q2 resolved)

- **S10 — Cash contributions (Extra).** User described: "hay algunos que si que se registran ahi y pues hay otros que los pagan directamente los admins (los mas grandes) [...] normalmente si es para compra de algun producto, dejan el dinero en recepcion para que ellos paguen cuando llegue el producto". Proposal accepted: "si". Admin cash left at reception is a cash **in** (not an expense); the later purchase is a normal reception expense (S7). Wire the existing `ExtraModal` ("Registrar Extra": concept, "Aportado por", amount) live: table `shift_cash_contributions` (`id, branch_id, shift_id NOT NULL, concept VARCHAR(255), contributor_name VARCHAR(160), amount_minor BIGINT > 0, recorded_by_id, idempotency_key + hash, created_at`), `POST/GET /api/v1/registers/{register_id}/cash-contributions` (same auth/lock as shift expenses), `expected_cash_for_shift` adds them, `ShiftSummaryDTO.extra_minor`, close dialog `extrasMinor`, enable the "Extra" shortcut. No void and no link to the later expense; mistakes show as close difference. Operating rule (documented, no UI copy change): the admin must not also record that cash as a business expense (double count).

## Assumptions (stated; override if wrong)

- **A1 — Category keys = the 8 the design already has** in `EXPENSE_CATEGORIES` (`consumibles`, `limpieza`, `mantenimiento_piso|peso|cardio|box`, `servicios`, `general`). The owner filter (5 options, `mantenimiento` matches the prefix), chart labels and colors already use them, so the owner view needs no mapping. Discovery's 5-value list would require new keys/colors in the selector.
- **A2 — Methods:** shift expenses are always `cash`; business expenses `transfer | card | cash`.
- **A3 — Demo mode:** category and voucher are stored in the demo `ExpenseRecord` (optional fields) so the same form works; photo upload, void and business entry are live-only (hidden in demo).
- **A4 — Evidence limits:** `image/webp` only after client compression, max 1 MB at the backend, max 1600 px longest side / quality 0.8 in the browser via `canvas.toBlob` (no new frontend dependency).

## Approved UI additions (placement uses existing patterns)

| Where | Addition | Reused pattern |
|---|---|---|
| `GastoModal` form | `Categoría *` `<select>` in `.op-flow-inputs-row`; second row with `Folio o ticket` input and `Foto del ticket` file input (`accept="image/*" capture="environment"`) | Existing `.field` inputs |
| `GastoModal` history | Columns `Categoría`, `Comprobante` (folio / "Ver foto"), row action `Anular`; voided rows show `Badge` "Anulado" and are excluded from "Total salidas" | `op-flow-table`, `Badge` |
| Void confirmation | Dialog with summary + required `Motivo` textarea + confirm button | `CasillerosModal` cancellation dialog (`staff-modal-overlay` + `staff-modal-card`) |
| `ExpensesView` heading | Button `Registrar gasto` opening the **same `GastoModal`** in `mode="business"`: adds `Sucursal` and `Método de pago` selects, hides shift history | `GastoModal` itself |
| `ExpensesView` table | `Categoría inferida` → `Categoría`; add `Método`, `Origen` (Turno/Negocio), `Comprobante`, `Estado` (Badge) and `Anular` action; heading copy "Gastos en efectivo registrados" → "Gastos registrados"; remove the "inferida" disclaimer; print table mirrors columns | `FinanceTable`, `Badge` (as in `CollectionsView`) |

## Backend contract

**Table `expenses`** (migration `00NN_expenses`; head frozen in T01): `id` UUID PK · `branch_id` FK RESTRICT, idx · `shift_id` FK RESTRICT NULL, idx · `category` VARCHAR(32) CHECK in A1 · `concept` VARCHAR(255) · `payee_name` VARCHAR(160) · `amount_minor` BIGINT CHECK > 0 · `payment_method` VARCHAR(16) CHECK (`cash`,`transfer`,`card`) + CHECK (`shift_id IS NULL OR payment_method='cash'`) · `voucher_reference` VARCHAR(120) NULL · `evidence_key` VARCHAR(255) NULL · `recorded_by_id` FK staff · `idempotency_key` + request hash (unique, rentals pattern) · `created_at` · `voided_at`, `voided_by_id`, `void_reason` NULL + CHECK all-or-none. No `status` column (derived from `voided_at`), no update/delete routes.

**Storage port** `app/expenses/storage.py`: `presign_put(key, content_type, size) -> url`, `presign_get(key) -> url`, `exists(key) -> bool`. Single `boto3` S3 implementation (MinIO locally, R2 later by config); unit tests use an in-memory fake of the same three functions. Settings (`EVOGYM_` prefix): `evidence_s3_endpoint`, `evidence_s3_bucket`, `evidence_s3_access_key`, `evidence_s3_secret_key`, `evidence_public_endpoint` (browser-reachable). Unset → upload route returns 501 and the form keeps working without photo.

**Routes** (`app/api/expenses.py`, `app/expenses/{schemas,queries,storage}.py`, registered in `main.py`):

| Method & path | Auth (reuse) | Behavior |
|---|---|---|
| `POST /api/v1/registers/{register_id}/expenses` + `Idempotency-Key` | `get_shift_actor_principal` + rentals/sales register receptionist check | Lock open shift row (same lock as close), insert cash expense. 409 no open shift. |
| `GET /api/v1/registers/{register_id}/expenses` | same | Current open shift's expenses (incl. voided) + `total_minor` of active; `[]` if none. |
| `POST /api/v1/admin/expenses` + `Idempotency-Key` | finance admin (`FinancePrincipal`, branch authorized) | Business expense, `shift_id` NULL, method transfer/card/cash. |
| `GET /api/v1/admin/expenses?from&to[&branch_id]` | `FinancePrincipal` + `_authorized_branches` (import, don't copy) | Shift + business expenses by `branch.timezone` local day; each row carries `evidence_url` (signed GET) when a key exists. |
| `POST /api/v1/expenses/{id}/void` `{reason}` | shift actor on that register's branch for shift expenses; finance admin for any | Lock row (and shift); 409 if shift closed or already voided. Same reason replays idempotently. |
| `POST /api/v1/expenses/evidence-uploads` `{content_type, file_size_bytes}` | shift actor or finance admin | Validates A4, returns `{upload_url, evidence_key}`; 501 if storage unconfigured. Create endpoints accept `evidence_key` only if prefix matches `expenses/{branch_id}/` and `exists()` is true. |

`ExpenseDTO`: `id, branch_id, shift_id, category, concept, payee_name, amount_minor, payment_method, voucher_reference, evidence_url|null, recorded_by_name, recorded_at, voided_at|null, voided_by_name|null, void_reason|null`.

**Shift math:** `expected_cash_for_shift` adds cash contributions (S10) and subtracts active (`voided_at IS NULL`) expenses of the shift with existing 64-bit guards. `ShiftSummaryDTO` gains `expense_minor`, `expense_count` (active only) and `extra_minor`. Negative expected cash is already possible today (refunds); T01 confirms no DB CHECK forbids it.

`CashContributionDTO`: `id, shift_id, concept, contributor_name, amount_minor, recorded_by_name, recorded_at`; `GET` returns current open shift's items + `total_minor` (`[]` if none).

## Frontend wiring

- `api/expensesApi.ts`: create/list (register + admin), void, `requestEvidenceUpload`, `uploadEvidence(blob, url)`; mirrors `shiftsApi` error mapping; idempotency key per pending submit.
- `shared` helper `compressToWebp(file)` (≈20 lines, `canvas.toBlob`), with one unit test.
- `GastoModal`: `apiRequest`, `registerId`, `mode: 'shift' | 'business'`, `branches` props; dispatch as `GuantesModal` (`isLive`). Upload flow: compress → presign → PUT → create with `evidence_key`. 501 → toast "Foto no disponible; se guarda sin foto", submit continues.
- `ApiReceptionHome`: enable "Gasto" and "Extra" when `registerId` exists; mount both modals live.
- `ExtraModal`: `apiRequest`/`registerId` props, `isLive` dispatch; live path uses `createCashContribution`/`listCashContributions` (in `expensesApi.ts`). Same markup and copy; demo path untouched.
- `ExpenseReport` live: `listAdminExpenses(range, branch)`, map DTO → `ExpenseReportItem` (extend type with `category` from DTO key, `method`, `origin`, `voucherReference`, `evidenceUrl`, `voided`); totals/chart skip voided. Business modal + void dialog refresh the list after success.
- `Shifts.tsx` live: KPI from `expense_minor/expense_count`; pass `expensesMinor` and `extrasMinor` to `ShiftCloseDialog`.

## Tasks

- [x] **F12-T00** — Product decisions resolved (S2–S6, S10, Q1 = MinIO). A1–A4 stand unless the user corrects them.
- [x] **F12-T00b** — Delivery strategy: `feature-branch-chain` selected by the user.
- [x] **F12-T01** — inline. Freeze migration head (0048 → new 0049), reused `fingerprint`/`clean_idempotency_key`/`staff_display_name` helpers, register receptionist check, shift lock order, branch-timezone day range; baseline focused results; branch `feat/f12-expenses` created.
- [x] **F12-T02** (S2, S6, S7, S9, S10) — backend shift cash movements: `expenses` + `shift_cash_contributions` models in migration 0049, register POST/GET for both, `expected_cash_for_shift`, summary fields, tests. Commit `7660cbe`.
- [x] **F12-T03** (S4, S5, S8, S9) — backend business create, admin read, void + tests. Commit `8477eb2`.
- [x] **F12-T04** (S3) — storage port + Q1 implementation, evidence upload route, key validation on create, signed GET on read, compose/settings/README env docs + tests. Storage is faked in unit tests; the real MinIO emulator proof is still unavailable because the image pull is denied. Commit `8477eb2`.
- [x] **F12-T05** (S1–S8, S10) — frontend: `expensesApi`, `compressToWebp`, `GastoModal` (shift + business, upload, void dialog), `ExtraModal` live, `ApiReceptionHome`, `ExpenseReport`/`ExpensesView` columns, `Shifts` + focused Vitest. Commit `881ae2d`.
- [ ] **F12-T06** — verification below + independent verifier. Verification is done (see Log); the independent verifier could not run because the subagent provider reported a usage limit, so one decision remains for the user.

T02–T04 share one model/migration → sequential inline writers; T05 may run in parallel with T04 only after T03 freezes the DTO.

## Verification

- **API** (from `api`): `.\.venv\Scripts\python.exe -m pytest -q tests/test_expenses.py tests/test_shifts.py tests/test_migrations.py`; full suite once at closure.
  - Shift expense → 201; current expected cash, summary and close reflect it; void on open shift restores it; void after close → 409, data unchanged.
  - Expense larger than expected cash → 201 and negative difference at close (S6).
  - Business expense transfer/card → 201, `shift_id` null, no shift total change; cash method with shift id rejected by CHECK/422.
  - 422: amount ≤ 0/non-int, blank concept/payee, unknown category/method, void without reason.
  - 403: wrong-branch receptionist, non-finance on admin routes, receptionist voiding a business expense.
  - Idempotency replay/altered body for both creates; double void.
  - Evidence: wrong content type/size → 422; foreign or missing key → 422; unconfigured storage → 501; read returns signed URL, never the raw key path.
  - Admin range respects `branch.timezone` (23:30 local edge); branch-scoped finance sees only its branch; voided rows returned with metadata.
  - PostgreSQL races: close vs. expense insert, close vs. void, concurrent void, close vs. contribution insert.
  - Contributions (S10): create → 201 and expected cash/summary `extra_minor` rise; no/closed shift → 409; 422 invalid; wrong branch → 403; idempotent replay. Admin-fund flow: +$800 contribution, −$800 expense → expected cash unchanged vs. opening + sales.
- **Frontend** (from `frontend`): `npm test -- GastoModal ExtraModal ExpenseReport ExpensesView Shifts ApiReceptionHome compressToWebp`, `npm run typecheck`, `npm run build`; full `npm test` at closure.
- **Browser** (disposable DB + emulator): cashier records $150 *Limpieza* with folio + photo → history shows category/"Ver foto" → reload → voids a second test expense with reason → Turno KPI and close dialog reconcile. Owner registers $2,500 *Mantenimiento: Cardio* by transfer → table/chart/filter show it → opens photo link → voids it → reload persists. Failure paths: void on closed shift, denied branch, storage stopped (501 path). Admin fund: reception records Extra $800 "Fondo compra garrafones" → Gasto $800 → close dialog shows Extras +$800 / Gastos −$800 and reconciles. Verify network + DB + object in bucket.

## Not included

Real Cloudflare R2 credentials/bucket/CORS (config only later), expense edits, approvals workflow, budget/fixed costs, void/linking of Extras, owner Balance tab live extras, production migration, push/PR/deploy.

## Log

- **L1 — Planning request:** Ponytail ODD plan for F12, frontend as contract, surface backend items without UI. Plan only.
- **L2 — Evidence:** `GastoModal.tsx`, `ExpensesView.tsx`, `ExpenseReport.tsx`, `ApiReceptionHome.tsx:314-334`, `Shifts.tsx:494-543`, `ShiftCloseDialog.tsx:652-655`, `CasillerosModal.tsx:1290+` (confirmation pattern); backend `shifts/queries.py:376-453`, `:569-573`, `api/pending_money.py:79-110`, `api/rentals.py`, `db/models/authorization.py:24` (branch timezone), `settings.py` (`EVOGYM_` settings). No expense model/route, no file input, no S3 client; compose has only Postgres.
- **L3 — User decisions (turn 2):** category visible (S2), evidence upload with local emulation (S3), void (S4), business expenses by transfer/card (S5), drop drawer-balance guard (S6).
- **L4 — Q1 resolved:** "la A esta bien" → MinIO + `boto3`. Plan is ready for ODD execution once the user authorizes it; no source writes, branch, commit or container start have occurred.
- **L5 — Q2 raised:** user described admin cash handed to reception for later purchases. Evidence: `ExtraModal.tsx` copy/fields, `demo/shiftDashboard.ts:119-121` (extras add to expected cash), `ShiftCloseDialog.tsx:654` ("Extras" row).
- **L6 — Q2 resolved:** user answered "si" → S10 added (live `ExtraModal`, no void, no link). Plan ready; execution not authorized; no source writes have occurred.
- **L7 — Execution authorization:** user requested "por favor implementa @odd/tasks/f12-expenses-implementation.md" and selected `feature-branch-chain`. Branch `feat/f12-expenses` created from `330ebf5`; both F12 planning documents remain untracked. Latest migration file observed: `0048_rental_lifecycle`; baseline tests and implementation pending. Forecast: greater than 400 authored lines; work units remain inline because no independent-writer trigger applies.
- **L8 — Baseline:** `cd api && .\.venv\Scripts\python.exe -m pytest -q tests/test_shifts.py tests/test_migrations.py`: 89 passed, 21 warnings (130.18s). `tests/test_expenses.py` does not yet exist. Closing locks the register before the shift; cash movements must use the same order.
- **L9 — RED:** Added `api/tests/test_expenses.py::test_shift_expense_and_contribution_reconcile_cash`; `cd api && .\.venv\Scripts\python.exe -m pytest -q tests/test_expenses.py` fails as expected because the expense endpoint returns 404. No feature implementation or GREEN evidence yet. Full document mirror remains pending.
- **L10 — Partial T02:** Added initial models, migration, register endpoints, and shift math. Focused test now passes (1 passed); this is not complete verification. Existing shift/migration suite: 78 passed, 11 failed due to expected migration head, table set, and added summary fields; update the applicable assertions and re-run. Admin, void, storage, frontend, race/security tests and independent verification remain pending. No commit has been made. Risk items 1, 2, 3 and 4 apply.
- **L11 — Regression expectations:** Updated existing tests for the new migration head, two new tables, and added summary fields. Re-ran `tests/test_shifts.py tests/test_migrations.py`: 89 passed, 21 warnings. Focused `tests/test_expenses.py`: 1 passed, including same-key replay and altered-body conflict for both movements. T02 is still incomplete: authorization, validation, close behavior, races, and migration data preservation need dedicated coverage.
- **L12 — Additional T02 checks:** `tests/test_expenses.py`: 2 passed. Added validation, wrong-branch denial, unchanged empty history after rejection, and closed-shift denial checks. The feature remains incomplete; PostgreSQL race, void, business, storage, frontend and independent verification remain pending.
- **L13 — Partial T03/T04:** Added business expense create/read, void, evidence API/storage adapter, and local MinIO compose configuration. Focused `tests/test_expenses.py`: 5 passed before the real emulator attempt; no claim of complete coverage. boto3 installed locally. `docker compose up -d minio_dev minio_bootstrap` failed twice because the image pulls were denied; no emulator containers started and real integration proof is unavailable. Frontend, race/security verification, full suite, independent verifier, and full document mirror remain pending. No commit has been made.
- **L14 — UI progress and checks:** Connected live reception Gasto/Extra, photo fallback and void dialog, shift summary/close breakdown, owner expense read/filter/void and business form. Added focused API/client/compression/UI tests; latest API `tests/test_expenses.py`: 6 passed. Focused frontend suites: 15 passed and typecheck passed; owner suite 17 passed. Full frontend `npm test`: 847 passed, 10 failed. An isolated seven-file base comparison showed 3 failures already at `330ebf5`; current seven-file run showed those 3 plus 3 configuration-sensitive failures, while 4 other full-suite failures were not reproduced in that targeted run. Do not treat remaining failures as resolved without a controlled full-suite check. Re-tried MinIO after user login: image pulls still denied, emulator proof unavailable. Tasks remain unchecked; no commit or full task-document mirror yet.
- **L15 — PostgreSQL race proofs:** Added `api/tests/test_expenses_postgres.py` (opt-in, `EVOGYM_TEST_POSTGRES_URL`) covering close-vs-expense, close-vs-contribution, close-vs-void and concurrent voids; 4 passed against a disposable local database that was dropped afterwards. App-level PostgreSQL tests must use a disposable database rather than a schema, because `api/app/main.py` overrides psycopg `options` and discards `search_path`. Full API suite, independent verifier, MinIO emulator proof, browser scenario, commit and full task-document mirror remain pending.
- **L16 — Verification and commits:** API `.\.venv\Scripts\python.exe -m pytest -q`: 598 passed, 4 failed (all pre-existing: admin auth policy, two `inventory._admin` signature cases, staff schedule occurrence skip), 40 skipped, 899.96s. Frontend `npm test`: 849 passed, 8 failed; failures are the known pre-existing RootApp/ShiftCloseDialog pair, three `frontend/.env` sensitive cases and two 5s timeouts that pass in isolation (`ReceptionModals.test.tsx` 16 passed with `InventoryAnalytics.test.tsx`). `npm run typecheck`: exit 0. Differential check against base `330ebf5` in an isolated scratch export: shift summary, close and history responses identical on every shared field; only the three additive summary fields (`expense_minor`, `expense_count`, `extra_minor`) differ, all zero without movements. Commits: `7660cbe` shift expenses and contributions, `8477eb2` business expenses, void and evidence storage, `881ae2d` frontend wiring, `08c93aa` this plan document. Branch `feat/f12-expenses`; no push or pull request.
- **L17 — Open items:** the independent verifier could not run because the subagent provider reported `subscription_sharing_usage_limit_exceeded`; the MinIO emulator proof is still blocked by the registry denying the image pull; no browser session was run, so the browser scenario is covered only by API-level acceptance tests. The task document mirror to Engram topic `odd/f12-expenses/tasks` remains to be written.
