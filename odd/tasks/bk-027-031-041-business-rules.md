# Reglas de acceso, sincronización offline y asistencia laboral

## Objetivo
Documentar las decisiones confirmadas para acceso con saldo pendiente, check-in offline y asistencia laboral, y actualizar el plan de implementación con sus dependencias y preguntas aún abiertas.

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
- Preservar cambios preexistentes ajenos.
- Commit convencional en español, sin atribución de IA.

## Tareas
- [x] `RULES-1` — Incorporar decisiones confirmadas, actualizar BK-027/BK-031/BK-041 y anotar detalles operativos no definidos.

## Criterios de aceptación
- Voucher sin revisar no bloquea; fondos confirmados como no recibidos bloquean mientras haya saldo pendiente.
- Abonos permiten acceso con aviso y cada membresía es válida solo para su sucursal.
- Check-in offline sincroniza después y los reintentos no duplican visitas.
- Asistencia distingue presente, ausente y retardo, con hora/tolerancia por trabajador configuradas por Admin y registro de entrada/salida.
- Se registran dependencias y preguntas abiertas sin inventar respuestas.

## Verificación
- Lectura estructural de reglas, fases, ledger y este task completada.
- `git diff --check` sobre las cuatro superficies autorizadas: pasó.
- No se ejecutaron pruebas ni builds: cambio pasivo de documentación.

## Ruta
- Delegada; actualización coordinada de documentos existentes.
- Pronóstico aproximado: 180 líneas añadidas/eliminadas; estrategia `ask-on-risk`.

## Progreso y evidencia
- Completo: reglas y ledger actualizados; pendientes reflejados sin inventar decisiones.

## Siguiente paso
- Ninguno para este trabajo documental. La implementación futura debe resolver idempotencia/cliente offline, revalidación al sincronizar y agenda/ausencias sin inferir un calendario.

## Evidencia de cierre
- `git diff --check -- docs/backend-plan/02-business-rules-and-decisions.md docs/backend-plan/04-implementation-phases.md odd/tasks/backend-implementation.md odd/tasks/bk-027-031-041-business-rules.md`: pasó.
- Relectura estructural de las cuatro superficies: pasó.
- Pruebas/builds: N/A por documentación pasiva.
- Commit convencional: `docs(backend): definir acceso pendiente y asistencia offline`.
