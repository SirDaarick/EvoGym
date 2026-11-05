# Fase 5 — Línea base (Oleada 0)

Fecha: 2026-11-05 02:10 UTC (2026-11-04 20:10 America/Mexico_City). Commit base: `1385a5c`.

| Suite | Comando | Resultado |
|---|---|---|
| Backend | `cd api && .venv/bin/python -m pytest -q` | 744 passed, 44 skipped, **1 failed** (10 m 58 s) |
| Frontend unit | `cd frontend && npx vitest run` | 985 passed, **1 failed** (133 archivos) |
| Typecheck | `cd frontend && npx tsc -b --pretty false` | OK |

## Fallas preexistentes (dependientes de reloj/zona horaria, no relacionadas con Fase 5)

- `api/tests/test_member_check_ins.py::test_member_checkin_denies_expired_membership_and_records_no_event`
  — el test usa `date.today()` (UTC del contenedor) mientras el servidor evalúa con la fecha de negocio
  de `America/Mexico_City`; falla entre las 18:00 y 24:00 de CDMX.
- `frontend/src/features/reception/OvertimeSaleToggle.test.tsx` — construye fechas con hora local del
  proceso; pasa con `TZ=America/Mexico_City`, falla con el contenedor en UTC.

Ambas se consideran ruido conocido durante la verificación de Fase 5 (candidatas a T1.4 / Fase 6).
