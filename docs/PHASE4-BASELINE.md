# Baseline Fase 4 (Oleada 0)

Fecha: 2026-11-04. Rama `integration/frontend-design`, HEAD base `712a7a3`. Entorno: Linux, TZ del sistema UTC, Python 3.13.

## Resultados

| Suite | Comando | Resultado |
|---|---|---|
| API pytest | `cd api && python -m pytest -q` | 689 passed, 43 skipped, 0 failed (604 s) |
| Frontend typecheck | `cd frontend && npm run typecheck` | OK, sin errores |
| Frontend vitest | `cd frontend && npm test` | 952 passed, 1 failed (953 tests; 127/128 archivos OK) |
| Frontend build | `cd frontend && npm run build` | OK (PWA, 52 entradas precache) |
| T4.2 API | `pytest -q tests/test_expenses.py tests/test_shifts.py tests/test_migrations.py` | 98 passed |
| T4.2 frontend | `npm test -- GastoModal ExtraModal ExpenseReport ExpensesView` | 5 archivos, 32 passed |

## Fallos

Unico fallo observado (preexistente, no tocado):
- `src/features/reception/OvertimeSaleToggle.test.tsx` > "correctly detects shift transition and overtime times" (linea 29): espera `false` para `isShiftTransitionOrOvertime('06:00-14:00', '2026-10-19T11:00:00-06:00')` y recibe `true`. Causa probable: depende de la zona horaria del proceso (la fecha con offset -06:00 se interpreta en UTC en este entorno; 11:00-06:00 = 17:00 UTC, fuera del turno). Podria pasar con `TZ=America/Mexico_City`; no se verifico.

Fallos "conocidos" del plan que NO se reprodujeron en este entorno:
- `ApiProductApp.test.tsx:266` paso.
- Los 4 fallos de API: ninguno; todo en verde.
- ~8 fallos de frontend sensibles a `.env`: ninguno (no hay `.env` en el entorno).

## Notas
- `api/tests/test_migrations.py` ya esperaba el head `0053_scoop_products` (lineas 25, 453, ...); `test_contract_smoke.py` no referencia el head. No se requirio cambio de tests.
- 43 tests de API omitidos (skip) por diseno (grupos opt-in/Postgres); no se inspeccionaron individualmente.
- Instalacion: `pip install -e ".[test]"` en api; `node_modules` ya estaba presente en frontend (no se corrio `npm ci` completo).
