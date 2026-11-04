# Plan de implementación — Fase 4 (Módulos Funcionales y Conexión de Pantallas)

Base: exploración con 5 agentes Sonnet sobre HEAD `4e9ce9c`, rama `integration/frontend-design`.
Estado: **decisiones tomadas; pendiente de luz verde para implementar**. Ningún código ha sido modificado.

## 1. Hallazgo principal

El ROADMAP está desfasado: gran parte de la Fase 4 **ya existe en el repo**. El trabajo real es cerrar huecos, retirar demo y reconciliar el texto del roadmap.

| Tarea | Estado real | Trabajo restante | Tamaño |
|---|---|---|---|
| T4.1 Rentas | Backend completo (migr. 0047/0048, `rentals.py`, 21 tests). Modales con rama live | Quitar fallback demo de `GuantesModal`/`CasillerosModal`; decidir depósitos; arreglar test de head en `test_migrations.py` | S |
| T4.2 Gastos | **Completo** (migr. 0049, `expenses.py`, 8 tests, `GastoModal` conectado, descuento en arqueo) | Verificar (tests + typecheck) y marcar `[x]` | XS |
| T4.3 Nómina | Existe nómina semanal sueldo fijo (F13, migr. 0050, `payroll.py`). **Contradice** el roadmap (horas/extras/quincenal) | Requiere decisión de producto | M–L |
| T4.4 Resumen diario | Existe como `owner_overview.py` (`/owner/overview`), `Overview.tsx` conectado. `daily_summary.py` no existe | Extender con desglose por método/terminal, cancelaciones, transferencias confirmadas | M |
| T4.5a `/owner/attendance` | Sin endpoint de afluencia; UI demo + selector puro reutilizable | Endpoint + cliente + `LiveAttendance` + montaje | M |
| T4.5b `/owner/history` | Sin ledger global; alcance ambiguo | Endpoint de unión paginado + UI live | M–L |
| T4.5c `/owner/gimi` | Sin backend; depende de T4.6 | Mantener `UnavailablePage` hasta T4.6 | — |
| T4.6 Gimi/WhatsApp/Outbox | Nada en backend (solo UI demo). Sin pgvector en compose | Outbox + webhook + RAG tras adaptadores falsos; real requiere credenciales | L |

Discrepancias de IDs: BK-043/044 y BK-053..056 del roadmap no corresponden a lo descrito (nómina = F13; BK-053..56 = Mercado Pago). Corregir al actualizar el roadmap.

## 2. Decisiones requeridas antes de implementar

1. **T4.3**: ¿mantener Modelo A (sueldo fijo semanal) y solo añadir horas/extras como cálculo *informativo*, reemplazarlo, o declarar T4.3 cumplida por F13?
2. **T4.1**: depósitos no están en el spec F11 (excluidos explícitamente). ¿Se agrega modelo de depósito (migr. 0054) o se reconcilia el roadmap como "no aplica"? ¿`ReceptionHome.tsx` (prototipo demo) conserva demo o se retira?
3. **T4.5b**: ¿"historial" = ledger de movimientos (pagos, check-ins, stock, turnos) o bitácora de `AuditEvent`?
4. **T4.6**: ¿alcance = outbox + webhook + RAG detrás de adaptadores falsos (sin credenciales)? Proveedor de embeddings/LLM, WhatsApp (Meta/BSP) y permisos D-016 de Gimi quedan abiertos.
5. **T4.4**: ¿extender `owner_overview.py` (recomendado) o crear `daily_summary.py`?

## 2b. Decisiones tomadas
1. **T4.3**: Alinear ROADMAP con el dominio real. Nómina base (semanal, sueldo fijo, anticipos) = cumplida (F13). T4.3 se reduce a: (a) conectar historial/totales de nómina al reporte financiero consolidado del Owner (BK-043); (b) integrar el egreso de nómina con Gastos/Caja Chica de T4.2 (BK-045). **Sin** motor de horas/extras ni quincenal. La Oleada 3 se reemplaza por esto; T1.2/T1.4 dejan de ser prerrequisito.
2. **T4.1**: **Añadir depósitos** (migración nueva encadenada a 0053/0054; monto retenido y devolución al regresar guantes / liberar casillero; integración con arqueo de turno). Requiere ampliar spec `odd/tasks/f11-rentals.md`.
3. **T4.5b**: ledger de movimientos (sin migración).
4. **T4.6**: adaptadores falsos (outbox, webhook firmado, RAG simulado).
5. **T4.4**: extender `owner_overview.py` (default recomendado, no contestado explícitamente).
6. `/owner/gimi` permanece `UnavailablePage` hasta que T4.6 tenga datos reales.
7. **T4.1 frontend (H)**: `GuantesModal`/`CasillerosModal` son live-only (`apiRequest` y `branchId` obligatorios, sin `useDemo`). `ReceptionHome.tsx` (prototipo demo) ya no monta los modales: los atajos Guantes/Casilleros muestran un aviso "no disponible en modo demo". `demo/gloveOperations.ts` y `demo/lockerOperations.ts` se conservan (solo los usan sus propios tests). Tarjeta en rentas: el backend rechaza `card` en `components`; el modal crea la renta con el monto de tarjeta como saldo pendiente y luego abre `card-attempts` (`rentalsApi.beginRentalCardAttempt`/`getRentalCardAttempt`), avisando si no se confirma.

## 3. Oleadas de ejecución

Cada oleada: agentes Sonnet de implementación en paralelo (archivos disjuntos) → un agente Sonnet verificador independiente por oleada. Las migraciones se serializan (una sola 0054 a la vez; la cadena parte de `0053_scoop_products`).

### Oleada 0 — Higiene y baseline (1 agente)
- Correr baseline: `cd api && python -m pytest -q`; `cd frontend && npm run typecheck && npm test && npm run build`. Registrar fallos preexistentes (conocidos: `ApiProductApp.test.tsx:266`, 4 en API, ~8 en frontend sensibles a `.env`).
- Corregir `api/tests/test_migrations.py:25` (espera head `0051`, real `0053`).
- Marcar T4.2 `[x]` tras verificar.

### Oleada 1 — Backend independiente (paralelo, sin migración salvo indicada)
- **A. T4.4**: extender `owner_overview.py` con `finances.by_method[]` (cash/transfer confirmada/card, por `terminal_id` con nombre de `PaymentTerminal`), `cancellations` (ProductSaleCancellation, ProductRefund, RentalCancellation) y enriquecer `shift_discrepancies`. Reutilizar `shift_financial_summary`. Tests en `test_owner_overview.py`.
- **B. T4.5a**: `GET /api/v1/owner/attendance?from&to&branch_id` (bins hora/día, ocupación viva; unir `MemberCheckIn` y `ClassSampleCheckIn` como el overview; zona horaria `branch.timezone`). Evaluar índice `(branch_id, occurred_at)` → única migración posible (0054).
- **C. T4.5b** (según decisión 3): `GET /api/v1/owner/history` paginado en servidor, solo admin. Sin migración si es ledger.
- **D. T4.1**: limpieza de tests/migraciones; si se aprueba depósito, migración 0055 *después* de B.

### Oleada 2 — Frontend (paralelo, depende de la 1)
- **E. T4.4**: `ownerOverviewApi.ts`, `LiveOverview.tsx`, `OverviewView` con desglose y cancelaciones.
- **F. T4.5a**: `ownerAttendanceApi.ts`, `LiveAttendance` reutilizando `attendanceAnalyticsSelector`, dispatch `apiRequest ? Live : Demo`, montar en `ApiProductApp.tsx`.
- **G. T4.5b**: `ownerHistoryApi.ts`, `LiveHistory`, montaje.
- **H. T4.1**: retirar `useOptionalDemo`/imports `demo/*` de los dos modales (props obligatorias o wrapper live-only); reescribir `GuantesModal.test.tsx`; resolver `ReceptionHome.tsx`; revisar cobro con tarjeta (falta cliente de `card-attempts` en `rentalsApi.ts`).
- Regla: componentes live nunca leen `useDemo` ni localStorage. `/owner/gimi` permanece `UnavailablePage`.

### Oleada 3 — T4.3 (según decisión 1)
- Si es cálculo informativo: servicio puro de horas (ordinarias/extras) leyendo `staff_attendance_records`/`checkouts` aplicando correcciones append-only; registros sin checkout = "pendiente de revisión"; endpoint de solo lectura bajo `/admin/payroll`; **sin** crear gastos nuevos (evita doble gasto). Prerrequisito: T1.2 (bug 500→409 en `staff_attendance.py`) y T1.4 (`businessDate`).
- Si es reemplazo: requiere diseño nuevo (`payroll_runs`, quincenal, tarifas) y spec ODD antes de codificar.

### Oleada 4 — T4.6 (según decisión 4), por sub-paquetes con adaptadores falsos
1. Outbox: tabla `notification_outbox` (idempotency_key único), enqueue transaccional, worker con `FOR UPDATE SKIP LOCKED` y backoff, sin transacción abierta durante la llamada de red, `DeliveryAdapter` + fake.
2. Webhook WhatsApp: GET verify, POST con HMAC `X-Hub-Signature-256` sobre cuerpo crudo (comparación constante), inbox deduplicado, normalización E.164 y match exacto con `members.phone`, respuestas de solo lectura sin fuga ante número desconocido.
3. RAG: imagen `pgvector/pgvector:pg16` en compose dev/prod, migración condicional por dialecto (SQLite no soporta `vector`), HNSW, `EmbeddingProvider` con implementación determinista falsa. Tests PG en grupo opt-in.
- Fuera de alcance sin credenciales: envío real, embeddings/LLM reales, herramientas de escritura de Gimi.

### Oleada 5 — Verificación final y cierre
- Agente Sonnet verificador independiente por oleada (no el mismo que implementó): lee el diff, corre tests/typecheck/build, revisa criterios de aceptación, reporta PASS/FAIL con evidencia.
- Revisión en navegador (Playwright) de las pantallas nuevas en modo live.
- Actualizar `docs/ROADMAP.md` (checkboxes, IDs BK correctos, nombres reales de archivos).

## 4. Criterios de aceptación globales
- `pytest` y `vitest` sin regresiones frente al baseline de la Oleada 0; `typecheck` y `build` verdes.
- Montos en centavos; escrituras idempotentes (`Idempotency-Key`); registros financieros append-only.
- Autorización con `FinancePrincipal` + `_authorized_branches`; datos de salario solo para admin.
- Una sola cadena Alembic lineal desde `0053`; actualizar `test_migrations.py` y `test_contract_smoke.py` con cada head.
- Commits por oleada en `integration/frontend-design`; sin PR salvo solicitud.

## 5. Riesgos
- Dependencia T1.2/T1.4 (Fase 1, sin hacer) para T4.3.
- Conflictos de migración si dos agentes crean 0054: serializar.
- Quitar demo puede romper `ReceptionHome.tsx`, `richDemoState.ts` y tests de `src/demo/`.
- Verificaciones previas de F11/F12/F13 reportan verificador independiente incompleto: re-verificar en Oleada 0.
