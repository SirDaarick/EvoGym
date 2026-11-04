# EvoGym — Roadmap Maestro y Plan de Trabajo Accionable

Este documento centraliza **todas las tareas pendientes, correcciones de seguridad, módulos funcionales y mejoras arquitectónicas** del proyecto **EvoGym**. Funciona como el libro mayor de trabajo para su ejecución secuencial y controlada.

---

## 📋 Resumen de Fases

| Fase | Enfoque | Impacto / Riesgo | Prioridad |
|---|---|---|---|
| **Fase 0** | Trabajo en Curso (Suplementos y Porciones) | Alto (migración DB y stock) | ✅ **Completado** |
| **Fase 1** | Defectos Críticos de Seguridad y Estabilidad | Alto (seguridad financiera y bugs de turnos) | ✅ **Completado** |
| **Fase 2** | Arquitectura y Resiliencia del Backend | Medio-Alto (mantenibilidad y transaccionalidad) | ✅ **Completado** |
| **Fase 3** | Arquitectura y Calidad del Frontend | Medio (experiencia de desarrollo y UI robusta) | ✅ **Completado** |
| **Fase 4** | Módulos Funcionales y Conexión de Pantallas | Medio-Alto (completitud operativa del gimnasio) | 🟡 **En curso (T4.6 y `/owner/gimi` pendientes)** |
| **Fase 5** | Local-First y Modo Contingencia (Offline) | Alto (operación continua sin internet) | 🟢 **Media** |
| **Fase 6** | Pruebas Integrales y Certificación de Producción | Alto (certificación final de release y resiliencia) | 🔵 **Final** |

---

## ✅ Fase 0: Trabajo en Curso (Suplementos y Porciones)
> **Objetivo:** Concluir y verificar la especificación de porciones/botes en inventario y ventas POS (`odd/tasks/supplements-inventory-sales.md`).

- [x] **T0.1 — Validar migración Alembic 0053 y modelo de datos**
  - **Archivos:** `api/app/db/models/inventory.py`, `api/migrations/versions/0053_scoop_products.py`.
  - **Detalle:** Permitir `unit IN ('piece', 'scoop')` y almacenar `servings_per_container` (requerido positivo si es scoop).
  - **Resultado:** Aprobado en commit `e3b2121`. 15/15 pruebas de `pytest api/tests/test_inventory.py` pasadas.

- [x] **T0.2 — Apertura atómica de bote a porciones y ajuste de merma**
  - **Archivos:** `api/app/inventory/`, `frontend/src/features/inventory/Inventory.tsx`, `frontend/src/features/owner/InventoryAnalytics.tsx`.
  - **Detalle:** Descontar 1 bote cerrado e incrementar $N$ porciones en una sola transacción atómica sin clasificarlo como merma ni venta. Acción rápida de vaciado de botes para mermas de sobrantes.
  - **Resultado:** Aprobado en commit `e3b2121`.

- [x] **T0.3 — POS de porciones en recepción y separación de catálogo**
  - **Archivos:** `frontend/src/features/reception/SuplementosModal.tsx`, `frontend/src/app/ApiReceptionHome.tsx`.
  - **Detalle:** Conectar `SuplementosModal` a la API viva de ventas para cobros en efectivo y terminal Point. Excluir productos de tipo scoop del grid principal de piezas.
  - **Resultado:** Aprobado en commit `e3b2121`. 34/34 pruebas en Vitest pasadas.

---

## 🔒 Fase 1: Defectos Críticos de Seguridad y Estabilidad
> **Objetivo:** Eliminar vulnerabilidades en cobros, prevenir errores 500 en turnos y corregir desfases de fecha operativa (Must-Fix de Auditoría).

- [x] **T1.1 — Restringir terminal de tarjetas mock a entornos de prueba (P1)**
  - **Archivos:** `api/app/sales/point.py:259`.
  - **Problema:** Si Mercado Pago no está configurado, la terminal mock auto-aprueba cualquier cobro simulando una tarjeta "VISA 4242", incluso en producción.
  - **Acción:** Permitir el fallback mock **únicamente** cuando `settings.environment in ('development', 'test', 'demo')`. En staging/producción debe responder error `503 Service Unavailable ("Terminal no configurada")`.

- [x] **T1.2 — Corregir captura de excepción en asistencia de personal (P2)**
  - **Archivos:** `api/app/api/staff_attendance.py:641`.
  - **Problema:** Un bloque `except Exception: traceback.print_exc(); raise` previo a `except IntegrityError` causa que un doble check-in de empleado resulte en error 500 en vez de 409, saltándose la política de sanitización de logs.
  - **Acción:** Eliminar el bloque inalcanzable de captura genérica y retornar un `409 Conflict` estructurado ante colisiones de registro único.

- [x] **T1.3 — Desacoplar bloqueos de base de datos de llamadas HTTP externas (P4)**
  - **Archivos:** `api/app/sales.py:225-243`, `api/app/sales/point.py:176`.
  - **Problema:** Al cobrar con tarjeta Point, se retiene abierta la sesión de SQLAlchemy con `with_for_update` mientras `urllib` espera la respuesta de Mercado Pago (~15s). Con un pool de tamaño 5 (`pool_timeout=3`), 5 cobros simultáneos saturan el pool y botan toda la API.
  - **Acción:** Validar acceso, cerrar o liberar la transacción de BD antes de la llamada HTTP externa, y abrir una nueva sesión atómica solo al recibir la respuesta de la terminal para asentar la orden.

- [x] **T1.4 — Normalizar fecha de negocio del gimnasio en Frontend (R1)**
  - **Archivos:** 12 ocurrencias en `frontend/src/` (incluyendo `StaffAttendanceView.tsx`, `StaffManagement.tsx`, `AttendanceCalendar.tsx`).
  - **Problema:** Se utiliza `new Date().toISOString().slice(0, 10)` (UTC). A partir de las 18:00 hrs en Ciudad de México (`America/Mexico_City`), el cliente pide asistencias y cortes con fecha del día siguiente, retornando listas vacías.
  - **Acción:** Mover la función de fecha con zona horaria a `frontend/src/shared/formatters/date.ts` (`businessDate(now, timeZone)`) y reemplazar los 12 cálculos manuales.

- [x] **T1.5 — Respetar TTL de sesión de staff configurado**
  - **Archivos:** `api/app/api/admin_auth.py:141`.
  - **Problema:** La expiración de la sesión de recepción está fijada en 90 días en código duro, ignorando la configuración.
  - **Acción:** Enlazar la expiración a la variable de entorno existente `EVOGYM_STAFF_SESSION_TTL_SECONDS` (60–86400 s); sin configurar, el login falla cerrado con 503.

- [x] **T1.6 — Manejo robusto de errores y cancelación en cargas secundarias (R2)**
  - **Archivos:** `frontend/src/features/reception/StaffAttendanceView.tsx:139-211`.
  - **Problema:** Promesas con bloques `catch {}` vacíos ocultan caídas de red, y la falta de `AbortController` permite que peticiones desfasadas sigan escribiendo estado al cambiar de sucursal.
  - **Acción:** Mostrar errores en interfaz mediante `liveError`, implementar señales de aborto y consolidar llamadas en paralelo con `Promise.all`.

---

## 🏗️ Fase 2: Arquitectura y Resiliencia del Backend
> **Objetivo:** Introducir la Capa de Servicio, unificar dependencias de autenticación en FastAPI y estandarizar excepciones y modelos.

- [x] **T2.1 — Implementar Capa de Servicio de Dominio (`app/<dominio>/service.py`) (A1)**
  - **Problema:** Los routers de FastAPI contienen cientos de líneas de transacciones, bloqueos de filas y cálculos contables (ej. `api/sales.py` tiene 19 `select`, 10 `commit` y 88 `HTTPException`).
  - **Acción:** `app/<dominio>/queries.py` contiene solo SQL y proyecciones atómicas; `app/<dominio>/service.py` (o `app/staff/*.py`, `app/auth/*.py`) orquesta permisos/`authorize`, queries, commit, idempotencia y bloqueos, y lanza solo `AppError`/`HttpStatusError`. Los routers de `app/api/` son solo transporte HTTP. Dominios: sales, rentals, staff (asistencia, horarios, roster, credenciales), inventory/catalog, shifts, members/memberships, finance/expenses, admin (cuentas, roles, login, sesiones, alertas, enrolamiento) y perfil (acceso, emparejamiento, recepción).
  - **Beneficio:** Controladores HTTP delgados, reglas de negocio desacopladas del framework y pruebas unitarias puras sin levantar la API.
  - **Resultado:** Un commit por dominio en `feat/backend-phase2`: `b4e1a73` sales, `718ff8a` rentals (+ `app/errors.http_errors`), `99c5629` asistencia de staff (nuevo `app/staff/`), `1e8f993` inventory+catalog, `bedbe6c` horarios/roster/credenciales, `8a11c8d` shifts, `b2aabd4` members+memberships, `578cb2a` finance (`app/expenses` + nuevo `app/finance`), `43da3df` cuentas/roles admin, `385eb42` acceso de perfil/emparejamiento/recepción, `03cf6ed` login/sesiones/alertas/enrolamiento admin; commit de limpieza final pendiente. Routers: 8452 → 2647 líneas. El test AST `tests/test_router_layering.py` cubre los 26 routers con endpoints y prohíbe `select`/`execute`/`scalar(s)`/`add`/`delete`/`flush`/`commit`/`rollback`/`begin`/`with_for_update`/`authorize` y los imports de `sqlalchemy` (salvo `sqlalchemy.exc`), `app.db`, `app.auth.authorization` (salvo `AuthorizationDenied`/`Permission`) y cualquier `*.queries`. Salida de red (status/code/message) sin cambios. Suite API por slice: ~650–674 passed, 43 skipped (PostgreSQL), con los mismos 3 fallos preexistentes (`test_contract_smoke` ×2: propiedades OpenAPI de `MemberListItemDTO` y head de migración; `test_rentals` migración 0048 ×1). Test intermitente conocido: restore en `test_membership_access` (timestamps de 1 s en SQLite). No probado: concurrencia/locks en PostgreSQL (sin destino PG desechable); el orden de locks se comparó solo leyendo el código.

- [x] **T2.2 — Centralizar dependencias de sesión y autenticación (`deps.py`) (P5, P6)**
  - **Archivos:** `api/app/api/deps.py`.
  - **Problema:** Existen ~9 resolutores de credenciales dispersos y ~60 endpoints abriendo sesiones de base de datos manualmente.
  - **Acción:** Implementar `SessionFactoryDep`, `SessionDep`, `AdminDep` y `get_roster_principal`, eliminando el código duplicado.
  - **Resultado:** Commit `7a48277`.

- [x] **T2.3 — Estandarizar catálogo de errores y sobre de respuesta**
  - **Archivos:** `api/app/errors.py` (no existe `app/core/errors.py`).
  - **Acción:** `AppError(code, status, message, metadata)`, `HttpStatusError(status)` (se renderiza igual que `HTTPException`), `http_errors(*mapping)` como mapeador compartido excepción de dominio→status, `PublicDomainError` (subclase 409) y un único handler global. Nunca se devuelve texto interno.
  - **Resultado:** Commit `b850f94`; `http_errors` se añadió en `718ff8a`.

- [x] **T2.4 — Desacoplar modelos por Bounded Contexts (A5)**
  - **Archivos:** `api/app/db/models/`.
  - **Resultado:** Cerrado **sin cambios** por decisión del usuario. `app/db/models/` ya es un archivo por dominio (32 módulos), no hay imports circulares (solo `orders.py` usa `TYPE_CHECKING`; las relaciones usan referencias string) y hay ~190 sitios de import, incluidos tests con rutas de submódulo, por lo que el cambio no se justifica.

---

## 🎨 Fase 3: Arquitectura y Calidad del Frontend
> **Objetivo:** Desacoplar la UI de demostración, estructurar componentes con Atomic Design y optimizar la reactividad.

- [x] **T3.1 — Romper acoplamiento con `frontend/src/demo/` (F1)**
  - **Problema:** Utilidades críticas de negocio (`formatMoney`, tipos `Plan`, estado de membresía) se importan directamente desde `demo/` en más de 55 archivos.
  - **Acción:** Trasladar tipos y funciones puras a `frontend/src/domain/` y `frontend/src/shared/formatters/`. Restringir `demo/` exclusivamente para datos simulados aislados.
  - **Resultado:** Commit `a5ef61b` (+ `09326d1`). Utilidades puras en `shared/formatters/` (money, date) y `domain/` (membership, plans, finance, cash, reporting, expenses, alerts, lockers, attendance, staff); `demo/` las re-exporta. 47 importadores migrados a `@/`. `src/test/architecture.test.ts` prohíbe importar `demo/` desde `api/`, `shared/`, `domain/` y congela los 36 consumidores de estado mock restantes como allowlist que solo puede reducirse.

- [x] **T3.2 — Cliente HTTP centralizado e interceptores (F3, R3)**
  - **Archivos:** `frontend/src/api/http.ts`.
  - **Acción:** Crear un cliente HTTP único con tipado consistente, inyección automática de tokens de sesión, cabeceras de sucursal, reintentos seguros y mapeo de errores estructurados.
  - **Resultado:** Commit `2c41e2a` (+ endurecimiento en `81dbc80`). `api/http.ts`: `ApiRequest`, `HttpError`/`NetworkError`, `parseErrorEnvelope`, `requestJson` (reintentos seguros solo GET/HEAD, abort, `Idempotency-Key`), `createHttpClient` (Authorization + `X-Branch-ID`). Adoptado en `receptionApi` y `membershipCheckoutApi`; sin `fetch(` crudo en componentes. Los demás clientes migran al tocarse en Fase 4.

- [x] **T3.3 — Descomposición de componentes gigantes (Container / Presentational) (F4)**
  - **Archivos:** `Inventory.tsx`, `ApiReceptionHome.tsx`, `StaffManagement.tsx` (componentes de 800 a 1,500 líneas).
  - **Acción:** Separar la lógica de datos y mutaciones (Contenedor / Custom Hooks) de la presentación visual pura (Presentational). Reducir archivos a unidades testeables de <250 líneas.
  - **Resultado:** Commits `b61a8ba` (Inventory), `45fad01` (ApiReceptionHome: 421 → 121 líneas), `f26400e` (StaffManagement: 1,719 → barrel de 10 líneas sobre `owner/staff/`). Todos los archivos piloto < 250 líneas (máx. 187). Resto de pantallas: *per feature, as touched* en Fase 4.

- [x] **T3.4 — Adoptar TanStack Query (React Query)**
  - **Acción:** Reemplazar peticiones manuales en `useEffect` y estados locales dispersos por consultas cacheadas (`useQuery`, `useMutation`), logrando invalidación automática y estados de carga transparentes.
  - **Resultado:** Commit `c27bef0` (QueryClient, provider, `api/queryKeys.ts`, `renderWithQuery`) y pilotos anteriores con `useQuery`/`useMutation` + invalidación en lugar de recargas manuales; se preservan intents idempotentes en `sessionStorage`. Caché reiniciada al cambiar de principal (`81dbc80`).

- [x] **T3.5 — Primitivo accesible para Diálogos y Modales (U1)**
  - **Archivos:** `frontend/src/shared/components/ui/Dialog.tsx`.
  - **Problema:** Cerca de 30 implementaciones manuales de modales carecen de trampa de foco (Tab trap), tecla Escape y atributos WAI-ARIA.
  - **Acción:** Construir un componente primitivo sobre `<dialog>` nativo con `showModal()`, foco atrapado y retorno de foco al cerrar; migrar los modales gradualmente.
  - **Resultado:** Commit `e8661e5` (+ `81dbc80`). `shared/components/ui/Dialog.tsx` y `ConfirmDialog.tsx` sobre `<dialog>` nativo: trampa de Tab, Escape, retorno de foco, `aria-labelledby/describedby`. `Modal` de `shared/ui.tsx` y los 5 diálogos de staff ya lo usan; verificado en Chromium. Los ~20 modales restantes migran al tocarse.

- [x] **T3.6 — Corrección de tokens y accesibilidad visual (U2, U3)**
  - **Archivos:** `styles.css`, `Design.md`.
  - **Problema:** El texto naranja `#FC6C06` sobre fondo claro tiene un contraste de 2.8:1 (falla WCAG AA).
  - **Acción:** Crear token `--color-primary-ink` (`#A83D08` con contraste 5.98:1) para tipografía e iconos, reservando `#FC6C06` solo para rellenos interactivos.
  - **Resultado:** Commits `333659e` (U2: token `--color-primary-ink`, 119 reglas en 21 hojas; contraste ≥ 4.98:1 medido en claro/oscuro) y `84acf84` (U3: `FormField`/`useFieldErrors`, errores inline con `aria-invalid` en Gasto, Extra, Merma, Devoluciones, Guantes, Casilleros, PlanEditor, ExpensesView y staff; toasts de error persistentes con `role="alert"`). Suite Vitest: 952/953 (único fallo preexistente `OvertimeSaleToggle`, dependiente de zona horaria).

---

> **Nota Fase 3:** Se aplicó la estrategia *cimientos + primitivos + pilotos*. La migración del resto de modales a `<Dialog>`, de los `useEffect`-fetch a TanStack Query y de los clientes `src/api/*` a `http.ts` se hace por feature conforme se toque en la Fase 4.

---

## 💼 Fase 4: Módulos Funcionales y Conexión de Pantallas
> **Objetivo:** Completar los flujos de negocio del gimnasio que actualmente muestran `UnavailablePage` o dependen de simulación.
> Plan y verificación: `docs/PHASE4-PLAN.md`, `docs/PHASE4-BASELINE.md`.

- [x] **T4.1 — Ciclo de vida completo de Rentas (Lockers y Guantes)**
  - **Resultado:** Backend F11 (migr. 0047/0048) + **depósitos** (migr. 0054, `rental_deposit_movements` append-only, integrado al arqueo). `GuantesModal`/`CasillerosModal` solo live (sin `useDemo`), UI de cobro/devolución de depósito y cobro con tarjeta Point. En `ReceptionHome` (prototipo demo) los atajos muestran aviso "no disponible en modo demo".

- [x] **T4.2 — Módulo de Gastos de Operación y Caja Chica (BK-045)**
  - **Resultado:** Ya implementado (migr. 0049, `expenses.py`, `GastoModal`, descuento en arqueo). Verificado en Oleada 0.

- [x] **T4.3 — Finanzas, Compensaciones y Nómina de Personal**
  - **Alcance acordado:** la nómina base (semanal, sueldo fijo, anticipos; F13, migr. 0050) se da por cumplida. No se construye motor de horas/extras ni liquidación quincenal.
  - **Resultado:** `GET /api/v1/admin/payroll/history` y vista de nómina real en el reporte del Owner; el egreso de nómina coincide con Gastos sin doble conteo (test). En modo live el tab Presupuesto ya no muestra costos fijos demo (sin backend).

- [x] **T4.4 — Resumen Diario de Operaciones**
  - **Resultado:** Implementado extendiendo `owner_overview.py` (no existe `daily_summary.py`): ventas por método y terminal Point, cancelaciones/reembolsos, discrepancias de caja con turno. Los depósitos de renta se reportan aparte (`finances.deposits`) y no cuentan como ingreso.

- [~] **T4.5 — Conexión de Pantallas Desconectadas (`ApiProductApp.tsx`)**
  - [x] `/owner/attendance`: `GET /api/v1/owner/attendance` + vista live.
  - [x] `/owner/history`: `GET /api/v1/owner/history` (ledger de movimientos, paginación por cursor) + vista live.
  - [ ] `/owner/gimi`: permanece `UnavailablePage` hasta conectar T4.6 a datos reales.

- [~] **T4.6 — Asistente Gimi, WhatsApp y Notificaciones**
  - **Hecho con adaptadores falsos (sin credenciales):** outbox durable idempotente (migr. 0055), webhook de WhatsApp con firma HMAC, dedupe y match exacto de teléfono, lista de herramientas de solo lectura deny-by-default, RAG con pgvector/HNSW (migr. 0056, condicional por dialecto).
  - **Pendiente:** proveedor real de WhatsApp (Meta/BSP), embeddings y LLM reales, worker que ejecute el outbox, normalizar `members.phone` a E.164, política de retención, probar contra PostgreSQL con pgvector, y decidir la imagen de Postgres de producción (la migración 0056 falla sin la extensión `vector`).

---

## ⚡ Fase 5: Local-First y Modo Contingencia (Offline)
> **Objetivo:** Garantizar que la recepción pueda registrar entradas y ventas en efectivo aun si se corta la conexión a internet (BK-062 a BK-074).

- [ ] **T5.1 — Shell de PWA y almacenamiento offline estático (BK-062)**
  - **Detalle:** Service Worker que cachea los assets de la PWA para permitir arranque autónomo sin conexión tras la instalación.

- [ ] **T5.2 — Base de datos local en navegador con IndexedDB / Dexie (BK-063)**
  - **Detalle:** Tablas locales para socios activos, catálogo de precios, estado de cajas y tabla de cola inmutable `local_event_queue`.

- [ ] **T5.3 — Cola de eventos inmutable con folios provisionales (BK-064)**
  - **Detalle:** Dispatcher unificado que genera eventos inmutables con prefijo de dispositivo (ej. `REC-xxx`) para check-ins y ventas en efectivo cuando no hay red.

- [ ] **T5.4 — Endpoint de Bootstrap para descarga de modelo de lectura (BK-065)**
  - **Detalle:** `POST /api/v1/sync/bootstrap` para provisionar el token del dispositivo y descargar el padrón de socios activos, catálogo y cajas.

- [ ] **T5.5 — Ingesta masiva de contingencia con recibos idempotentes (BK-066)**
  - **Detalle:** `POST /api/v1/sync/contingency-events` que recibe lotes de eventos, deduplica por `(event_id, payload_hash)` y retorna recibos duraderos.

- [ ] **T5.6 — Refresco incremental de lecturas delta (BK-067)**
  - **Detalle:** `GET /api/v1/sync/roster-delta` para sincronizar cambios del padrón y catálogo mediante cursor de fecha sin multi-master.

- [ ] **T5.7 — Autenticación offline de personal con PIN bcrypt (BK-068)**
  - **Detalle:** Validación local de PIN con TTL acotado (24-48 hrs); el servidor revalida permisos al momento de la sincronización.

- [ ] **T5.8 — Reconciliación de eventos y deduplicación de check-ins (BK-069)**
  - **Detalle:** Fusión de flujos de eventos en backend, deduplicación de check-ins cercanos (<5 min) y aplicación de ventas al inventario con banderas de auditoría.

- [ ] **T5.9 — Arqueo físico offline y conciliación de caja (BK-070)**
  - **Detalle:** Declaración de arqueo de cierre offline cotejada contra las ventas en efectivo para alertar discrepancias de caja al administrador.

- [ ] **T5.10 — Gestor de reconexión y detección de conectividad (BK-071)**
  - **Detalle:** Detección automática de reconexión/hotspot móvil, vaciado de `local_event_queue` con backoff exponencial e indicador visual (Offline / Sincronizando / Sincronizado).

- [ ] **T5.11 — Guardián de capacidades online-only (BK-072)**
  - **Detalle:** Bloqueo explícito en UI de operaciones que requieren WAN obligatoria (cobros con Mercado Pago Point, links web de Checkout Pro y edición de catálogo).

---

## 🧪 Fase 6: Pruebas Integrales y Certificación de Producción
> **Objetivo:** Obtener garantías sólidas de estabilidad, concurrencia y seguridad previas a la puesta en marcha oficial (BK-075, BK-076).

- [ ] **T6.1 — Habilitar suite completa de PostgreSQL en CI**
  - **Acción:** Configurar un servicio de PostgreSQL real en GitHub Actions para ejecutar las 17 pruebas de concurrencia y bloqueos omitidas en local.

- [ ] **T6.2 — Pruebas End-to-End (E2E) con Playwright**
  - **Acción:** Automatizar los 3 flujos críticos en navegador real:
    1. Apertura de turno con arqueo $\rightarrow$ venta de membresía $\rightarrow$ check-in de socio.
    2. Venta de productos/porciones con cobro en efectivo y tarjeta Point.
    3. Cierre de turno y generación de reporte de diferencias.

- [ ] **T6.3 — Procedimientos de respaldo PITR y recuperación ante desastres (BK-075)**
  - **Acción:** Definir objetivos RPO/RTO, pruebas periódicas de restauración de base de datos PostgreSQL con PITR y mitigación de pérdida de dispositivos no sincronizados.

- [ ] **T6.4 — Hardening de Seguridad, Rate Limiting y Despliegue (BK-076)**
  - **Acción:** Rate limiting en login y emparejamiento móvil (`/pair`), rotación segura de secretos, configuración estricta de CORS/cookies y auditoría de vulnerabilidades (`pip audit`, `npm audit`).

---

## 📌 Guía de Uso del Roadmap
Para avanzar con disciplina de ingeniería:
1. **Seleccionar una tarea a la vez** respetando las dependencias entre fases.
2. Seguir el ciclo **Rojo -> Verde -> Refactor** en cada cambio.
3. Marcar la casilla `[x]` correspondiente una vez que los tests aprueben y no existan advertencias de linter ni regresiones.
