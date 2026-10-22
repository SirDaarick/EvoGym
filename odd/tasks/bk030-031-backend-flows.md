# Backend de clase muestra y asistencia por turnos

## Objetivo
Implementar en FastAPI la clase muestra pagada de una sola entrada y la programación/asistencia laboral según las reglas aprobadas, por cortes verificables y sin tocar frontend ni Mercado Pago.

## Problema y motivo
El backend actual procesa ventas como membresías por periodo y check-ins ligados a `MembershipPeriod`; no representa una entrada única sin vencimiento por fecha. La asistencia laboral existente guarda una marca diaria con horario fijo por perfil, no turnos recurrentes múltiples ni sus ocurrencias.

## Alcance autorizado
- `api/app/` — modelos, contratos, autorización, servicios y rutas API necesarios para estos flujos.
- `api/migrations/versions/` — migraciones versionadas y reversibles/seguras.
- `api/tests/` — pruebas determinísticas de API, dominio y migración.
- `docs/backend-plan/02-business-rules-and-decisions.md`
- `docs/backend-plan/04-implementation-phases.md`
- `odd/tasks/backend-implementation.md`
- `odd/tasks/bk-030-031-backend-flows.md`

## Restricciones
- Mantener la clase muestra separada de membresías con vencimiento; no inferir una duración de días.
- Representar la entrada única con `entitlement_mode` explícito (`period` o `single_entry`) en versión de plan y línea de venta; clase muestra sigue siendo tipo de plan `membership` para conservar el flujo financiero. No simularla con duración de un día, fecha infinita ni códigos de plan mágicos.
- La compra conserva el flujo normal de alta de perfil y pago; no integrar ni llamar Mercado Pago.
- Evitar modificar frontend, demo, datos reales o `backend/` raíz no rastreado.
- Preservar autorización por sucursal y permisos existentes; personal sin cuenta debe seguir soportado por roster laboral.
- Eventos de asistencia y entradas de clase muestra deben ser idempotentes, auditables y transaccionales.
- No implementar sincronización offline completa hasta verificar/delegar sus dependencias de BK-064; no presentar una captura local como confirmación del servidor.
- Mantener el interruptor RDD tal como está (clone-local OFF); no ejecutar review nativo.
- Commits Conventional en español, uno por tarea. Preparar PR encadenados con destino a la rama backend, nunca `main`; la operación remota queda pendiente de autorización de destino/ref y sesión de credenciales.

## Reglas confirmadas
- Clase muestra: pagada; mismos campos de perfil y flujo de compra/pago que una suscripción normal; disponible para quien no la haya usado, incluidos miembros actuales y anteriores; una sola por persona/perfil de por vida con historial retenido; una entrada, no un día; sin fecha de vencimiento antes del uso; intento denegado no consume; check-in exitoso consume; salir termina el acceso y no permite reingreso.
- Personal: turnos configurados por Admin, por empleado/sucursal/día, con tolerancia inclusiva; varios turnos diarios se controlan independientemente; ausencia permanece visible hasta check-in y no se inventa salida faltante; recurrencia con excepciones y fin por fecha/número/indefinida; edición de ocurrencia/esta y futuras/toda la serie sin modificar historia; sin traslapes por trabajador aunque sean sucursales distintas; correcciones preservan original, actor y hora.
- Offline personal: conservar hora capturada y recepción del servidor; reloj no verificable o desviación absoluta >5 min requiere revisión; exactamente 5 min está dentro de tolerancia; no autocorregir ni fabricar hora; eventos locales se conservan ante conflictos de agenda y se marcan para revisión al sincronizar.

## Tareas
- [x] `SAMPLE-1` — Crear/registrar la venta pagada de clase muestra con perfil normal y una concesión persistente de una sola entrada, ligada a pago/orden e idempotencia.
- [ ] `SAMPLE-2` — Incorporar el check-in de clase muestra: permitir solo antes del primer uso, consumir atómicamente al aceptar, conservar historial, negar repetición/salida-reingreso y no consumir en intentos denegados o replays.
- [ ] `STAFF-1` — Modelar turnos recurrentes, ocurrencias/excepciones y edición acotada a ocurrencias futuras, incluyendo validación de traslape multi-sucursal.
- [ ] `STAFF-2` — Vincular asistencia con ocurrencia/turno, entrada y salida independientes, estado presente/retardo, corrección auditada y permisos por sucursal.
- [ ] `STAFF-3` — Integrar captura offline de asistencia y revisión de conflicto/reloj usando la cola/idempotencia de BK-064; no duplicar dicha infraestructura.

## Criterios de aceptación
- Una persona elegible puede comprar clase muestra con los campos y medios normales; el precio y estado de pago provienen del servidor.
- El historial impide una segunda clase muestra incluso tras una membresía regular o cambio de estado del perfil.
- Solo check-in aceptado consume la entrada; reintento idempotente responde al evento original sin segunda visita; los intentos denegados o inválidos no consumen la entrada.
- Una muestra ya usada no permite reingreso aunque el intento ocurra dentro de cinco minutos; la deduplicación normal de visitas de membresía no debe abrir una excepción.
- Cada turno/ocurrencia queda vinculado a una persona y sucursal, no se traslapa con otro turno de esa persona y no cambia asistencia histórica al editar una serie.
- Se conservan entradas/salidas reales y toda corrección muestra actor, hora y valor original; accesos Admin/Recepción obedecen alcance definido.
- Capturas offline preservan tiempo de dispositivo y servidor, permanecen provisionales hasta sincronización y pasan a revisión con las reglas temporales aprobadas.
- Migraciones protegen los datos en downgrade; pruebas cubren límites temporales, concurrencia/idempotencia, autorización, recurrencia y cambios de serie.

## Ruta, forecast y verificación
- Ruta: delegated direct. Mapeo read-only encontró diferencias fundamentales de dominio en `OrderItem`/`MembershipPeriod` y ausencia de entidad recurrente de turnos; los escritores necesitan leer mientras implementan.
- TDD: observar RED en regresiones dirigidas antes de cambiar el comportamiento; usar `& .\api\.venv\Scripts\python.exe -m pytest -q <tests>` para verificar y correr la suite API aplicable al cerrar cada tarea.
- Estrategia de entrega: `feature-branch-chain`, solicitada por el usuario; PR encadenados hacia la rama backend, no `main`. El nombre/ref exacto del destino remoto y la autorización de sesión de credenciales siguen pendientes antes de cualquier operación remota. Forecast inicial aproximado: 900–1,400 líneas de código/pruebas/documentación, excluyendo generados.
- RDD: clone-local OFF; pruebas enfocadas con SQLite desechable, sin PostgreSQL remoto ni servicios externos; migración Postgres seguirá como no verificada si no hay target local configurado.

## Progreso
- Mapeo inicial: check-in de socios requiere `MembershipPeriod`; `OrderItem` está limitado a membership con duración; roster guarda un solo horario/tolerancia; asistencia actual es una marca por perfil/fecha.
- Recomendación técnica: separar concesión/uso de clase muestra del periodo de membresía; el flujo offline integral de personal depende de BK-064, pero el modelo y rutas online de turnos pueden avanzar aparte.
SAMPLE-1 implementado: PlanVersion y OrderItem conservan kind=membership y exponen entitlement_mode; single_entry no guarda duracion, y la concesion por perfil se vincula a order item y plan version. La venta usa el flujo autenticado normal, precio del servidor, idempotencia y autorizacion; transferencias mantienen under_review. SAMPLE-2 y STAFF-1..3 siguen pendientes. No se integro Mercado Pago ni se tocaron frontend/demo/backend raiz.

## Evidencia de implementacion SAMPLE-1 (2026-10-21)
- Migracion `0028_class_sample_entitlements` sucede a `0027_member_checkin_visits`; versiones existentes reciben `period` sin modificar duraciones. Single-entry permite valores de duracion nulos; downgrade se rehusa si hay planes, ventas o concesiones single-entry.
- API conserva `membership` para periodos y agrega `item.entitlement_mode` y `sample_entitlement` para muestras. La restriccion unica por miembro conserva historial y bloquea otra compra. No se implemento consumo/check-in.
- RED: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_sales.py -k paid_class_sample` fallo antes del cambio con `TypeError: 'entitlement_mode' is an invalid keyword argument for PlanVersion`.
- Enfoque: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_sales.py api/tests/test_catalog.py api/tests/test_migrations.py api/tests/test_contract_smoke.py` - 54 passed, 18 warnings (80.82s).
- Suite API: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests` - 243 passed, 17 skipped, 18 warnings (320.62s). Los skips son pruebas PostgreSQL opt-in sin destino configurado; no se uso base externa.
- Revisión independiente encontró que los `CHECK` de SQL podían aceptar una duración `NULL` para modo `period` porque el resultado `UNKNOWN` no falla; se añadieron guardas `IS NOT NULL` y pruebas negativas.
- Verificación posterior a la corrección: 50 pruebas enfocadas de catálogo/ventas/migraciones pasaron; revisión independiente anterior a la corrección: 54 pruebas enfocadas pasaron; spot-check del coordinador posterior: 2 pruebas dirigidas pasaron. Suite API completa anterior a la corrección: 243 pasaron, 17 omitidas (PostgreSQL sin destino configurado).
- Ruta: delegated direct, por escritura multiarchivo no trivial. Commit de tarea: `1b3d307` (`feat(api): registrar ventas de clase muestra de entrada única`) en `codex/backend-foundation`; 402 inserciones y 51 eliminaciones en 18 archivos.
- Siguiente: SAMPLE-2 consume con check-in sin borrar la concesion ni alterar historial; STAFF-1..3 quedan abiertos. No cambiar conteos de otras tareas.
- Revision independiente P2 y correccion: SQL CHECK puede producir UNKNOWN para un plan periodico con duracion NULL, lo cual se acepta; ambas ramas period ahora requieren `duration_value IS NOT NULL AND duration_unit IS NOT NULL` antes de validar valores. Las pruebas negativas de modelo para cada columna primero fallaron (no se elevo IntegrityError) y luego pasaron; los casos single_entry NULL siguen validos. Verificacion P2: `& .\api\.venv\Scripts\python.exe -m pytest -q api/tests/test_catalog.py api/tests/test_sales.py api/tests/test_migrations.py` ? 50 passed, 17 warnings (95.93s); PostgreSQL opt-in skips siguen sin destino configurado. `git diff --check` en las superficies P2 autorizadas paso (solo avisos LF/CRLF).

## Siguiente paso
Implementar `SAMPLE-2` como slice separado de consumo por check-in; luego revisar tareas STAFF antes de entrar en BK-031.
