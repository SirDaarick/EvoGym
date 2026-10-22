# Reglas de acceso, sincronización offline, clases muestra y asistencia laboral

## Objetivo
Documentar las decisiones confirmadas para acceso con saldo pendiente, check-in offline, clases muestra y asistencia laboral, y actualizar el plan de implementación con sus dependencias y preguntas aún abiertas.

## Problema y motivo
BK-027, BK-031 y BK-041 requerían reglas de negocio consistentes antes de implementar sus contratos.

## Alcance autorizado
- `docs/backend-plan/02-business-rules-and-decisions.md`
- `docs/backend-plan/04-implementation-phases.md`
- `odd/tasks/backend-implementation.md`
- `odd/tasks/bk-027-031-041-business-rules.md`

## Restricciones
- Documentación únicamente; no modificar código, migraciones ni pruebas.
- Distinguir voucher pendiente de revisión de confirmación Admin de fondos no recibidos.
- Registrar BK-030 como tipo de suscripción pagada de una sola entrada, utilizable una vez por persona.
- Incorporar programación recurrente de turnos y reglas offline confirmadas para BK-031.
- Preservar cambios preexistentes ajenos.
- Commit convencional en español, sin atribución de IA.

## Tareas
- [x] `RULES-1` — Incorporar decisiones confirmadas, actualizar BK-027/BK-031/BK-041 y anotar detalles operativos no definidos.
- [x] `RULES-2` — Documentar la política de clase muestra BK-030 y completar reglas de agenda, auditoría, traslapes y marcas offline de BK-031; actualizar el ledger y fases.

## Criterios de aceptación
- Voucher sin revisar no bloquea; fondos confirmados como no recibidos bloquean mientras haya saldo pendiente.
- Abonos permiten acceso con aviso y cada membresía es válida solo para su sucursal.
- Check-in offline sincroniza después y los reintentos no duplican visitas.
- Asistencia distingue presente, ausente y retardo, con hora/tolerancia por trabajador configuradas por Admin y registro de entrada/salida.
- Clase muestra pagada comparte el alta/checkout de una suscripción, incluye actuales y exmiembros que nunca usaron una, se usa una vez por persona/perfil de por vida, conserva historial y consume una entrada solo al check-in exitoso; queda disponible indefinidamente hasta entonces y no admite reingreso tras salir.
- Turnos laborales admiten días y horarios variables, varios turnos diarios, repetición configurable, excepciones y edición de serie futura; son por sucursal y no se traslapan entre sucursales para un trabajador. Conservan entrada/salida real y correcciones auditadas; las marcas offline usan horario cacheado y pasan a revisión ante cambios de agenda o reloj no confiable.
- Se registran dependencias y preguntas abiertas sin inventar respuestas.

## Verificación
- Lectura estructural de reglas, fases, ledger y este task completada.
- `git diff --check -- docs/backend-plan/02-business-rules-and-decisions.md docs/backend-plan/04-implementation-phases.md odd/tasks/backend-implementation.md odd/tasks/bk-027-031-041-business-rules.md`: pasó para RULES-2.
- No se ejecutaron pruebas ni builds: cambio pasivo de documentación.

## Ruta
- Delegada; actualización coordinada de documentos existentes.
- Pronóstico aproximado: 180 líneas añadidas/eliminadas; estrategia `ask-on-risk`.

## Progreso y evidencia
- Completo: `RULES-1` documentó BK-027/BK-031/BK-041; commit `33a8766e2680af4c664622865e9a1e883246df51`.
- Completo: `RULES-2` documentó D-019 y D-032/D-033 en el ledger, fases y resumen maestro; implementación de colas offline, idempotencia, revalidación, agenda laboral y flujo de revisión sigue pendiente.

## Siguiente paso
- Ninguno para esta tarea documental. La implementación permanece pendiente de cola/idempotencia, revalidación al reconectar, agenda laboral y resolución de conflictos de horario.

## Evidencia de cierre
- `git diff --check -- docs/backend-plan/02-business-rules-and-decisions.md docs/backend-plan/04-implementation-phases.md odd/tasks/backend-implementation.md odd/tasks/bk-027-031-041-business-rules.md`: pasó.
- Relectura estructural de las cuatro superficies: pasó.
- Pruebas/builds: N/A por documentación pasiva.
- Commit convencional: `docs(backend): definir acceso pendiente y asistencia offline`.
- Identidad del commit de reglas: `33a8766e2680af4c664622865e9a1e883246df51`.
