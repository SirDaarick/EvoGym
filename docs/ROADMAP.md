# EvoGym — Roadmap Maestro y Plan de Trabajo Accionable

Este documento centraliza todas las tareas pendientes, correcciones de seguridad y mejoras arquitectónicas del proyecto **EvoGym**, organizadas por fases y prioridades para su ejecución secuencial y controlada.

---

## 📋 Resumen de Fases

| Fase | Enfoque | Impacto / Riesgo | Prioridad |
|---|---|---|---|
| **Fase 0** | Trabajo en Curso (Suplementos y Porciones) | Alto (migración DB y stock) | 🔴 Inmediato |
| **Fase 1** | Defectos Críticos de Seguridad y Estabilidad | Alto (seguridad financiera y bugs de turnos) | 🔴 Alta |
| **Fase 2** | Arquitectura y Resiliencia del Backend | Medio-Alto (mantenibilidad y transaccionalidad) | 🟡 Media-Alta |
| **Fase 3** | Arquitectura y Calidad del Frontend | Medio (experiencia de desarrollo y UI robusta) | 🟡 Media-Alta |
| **Fase 4** | Módulos Funcionales Pendientes | Medio (completitud operativa del gimnasio) | 🟢 Media |
| **Fase 5** | Local-First y Modo Contingencia (Offline) | Alto (operación continua sin internet) | 🟢 Media |
| **Fase 6** | Pruebas Integrales y Preparación para Producción | Alto (certificación final de release) | 🔵 Final |

---

## 🚀 Fase 0: Trabajo en Curso (Suplementos y Porciones)
> **Objetivo:** Concluir y verificar la especificación activa en `odd/tasks/supplements-inventory-sales.md` para evitar estados a medias en la base de datos y la interfaz.

- [x] **T0.1 — Validar migración Alembic 0053 y modelo de datos**
  - **Archivos:** `api/app/db/models/inventory.py`, `api/migrations/versions/0053_scoop_products.py`.
  - **Detalle:** Permitir `unit IN ('piece', 'scoop')` y almacenar `servings_per_container` (requerido positivo si es scoop). Verificar compatibilidad hacia atrás en SQLite y PostgreSQL.
  - **Criterio de éxito:** Migración ejecuta limpia y reversible (`upgrade` / `downgrade`), suite `pytest api/tests/test_inventory.py` pasa al 100%.

- [x] **T0.2 — Apertura atómica de bote a porciones y ajuste de merma**
  - **Archivos:** `api/app/inventory/`, `frontend/src/features/inventory/Inventory.tsx`, `frontend/src/features/owner/InventoryAnalytics.tsx`.
  - **Detalle:** La acción de "Abrir bote" debe restar 1 bote cerrado e incrementar $N$ porciones en una sola transacción atómica (sin registrarlo como merma ni venta). Proveer acción rápida de merma/ajuste para limpiar sobrantes.
  - **Criterio de éxito:** Pruebas de integración de inventario cubren apertura con stock suficiente, rechazo por stock insuficiente y cálculo de equivalencias en UI.

- [x] **T0.3 — POS de porciones en recepción y separación de catálogo**
  - **Archivos:** `frontend/src/features/reception/SuplementosModal.tsx`, `frontend/src/app/ApiReceptionHome.tsx`.
  - **Detalle:** Conectar `SuplementosModal` a la API viva de ventas para cobros en efectivo y terminal Point. Filtrar el catálogo principal para que los botes completos no se confundan con porciones sueltas.
  - **Criterio de éxito:** Venta en efectivo y tarjeta descuenta scoops del stock en vivo y genera orden con devolución habilitada en el mismo día.

---

## 🔒 Fase 1: Defectos Críticos de Seguridad y Estabilidad
> **Objetivo:** Eliminar vulnerabilidades en cobros, prevenir errores 500 en turnos y corregir desfases de fecha operativa.

- [ ] **T1.1 — Restringir terminal de tarjetas mock a entornos de prueba**
  - **Archivos:** `api/app/sales/point.py:259`.
  - **Problema:** Si Mercado Pago no está configurado, la terminal mock auto-aprueba cualquier cobro en cualquier entorno.
  - **Acción:** Permitir el fallback mock **únicamente** cuando `ENVIRONMENT in ('development', 'test', 'demo')`. En staging/producción debe fallar con error descriptivo (`503 / 400 Configuration Error`).

- [ ] **T1.2 — Corregir captura de excepción en asistencia de personal**
  - **Archivos:** `api/app/api/staff_attendance.py:641`.
  - **Problema:** Un bloque `except IntegrityError` inalcanzable produce un error 500 no controlado ante registros duplicados.
  - **Acción:** Manejar la violación de unicidad adecuadamente y devolver código `409 Conflict` con mensaje claro.

- [ ] **T1.3 — Desacoplar bloqueos de base de datos de llamadas HTTP externas**
  - **Archivos:** `api/app/sales/point.py`.
  - **Problema:** Durante la llamada de cobro a la terminal Point (~15s), la conexión de base de datos mantiene bloqueos de fila abiertos, saturando el pool de conexiones.
  - **Acción:** Confirmar la reserva del inventario o pedido, liberar la transacción mientras se espera la respuesta HTTP externa, y resolver el resultado atómicamente al recibir la respuesta o webhook.

- [ ] **T1.4 — Normalizar fecha de negocio del gimnasio en Frontend**
  - **Archivos:** 12 archivos en `frontend/src/` (búsqueda de `toISOString().split('T')[0]`).
  - **Problema:** En el turno vespertino/nocturno, UTC cambia de día antes que la hora local de México (`America/Mexico_City`), mostrando asistencias y reportes con fecha de mañana.
  - **Acción:** Implementar una utilidad central `getBusinessDate()` que respete la zona horaria oficial del gimnasio y reemplazar los 12 cálculos manuales.

- [ ] **T1.5 — Respetar TTL de sesión de staff configurado**
  - **Archivos:** `api/app/api/admin_auth.py:141`.
  - **Problema:** La expiración de la sesión de recepción está fijada en 90 días en duro, ignorando el parámetro de configuración.
  - **Acción:** Enlazar la expiración a la variable de entorno `STAFF_SESSION_TTL_HOURS`.

- [ ] **T1.6 — Manejo robusto de errores en cargas secundarias del frontend**
  - **Archivos:** `frontend/src/features/reception/` y `frontend/src/features/staff/`.
  - **Problema:** Múltiples promesas tienen bloques `catch {}` vacíos que ocultan fallos de red al usuario y no cancelan peticiones pendientes al desmontar (`AbortController`).
  - **Acción:** Manejar estados de error visibles y propagar abort signals.

---

## 🏗️ Fase 2: Arquitectura y Resiliencia del Backend
> **Objetivo:** Pasar de routers sobrecargados a una arquitectura limpia con separación de responsabilidades y reutilización de fontanería.

- [ ] **T2.1 — Implementar Capa de Servicio de Dominio (`app/<dominio>/service.py`)**
  - **Problema:** Los routers de FastAPI contienen cientos de líneas de transacciones, bloqueos de filas y cálculos contables.
  - **Acción:**
    - `sales/service.py`: Centralizar cobros de membresías, POS de productos y devoluciones.
    - `shifts/service.py`: Lógica de apertura, conteo de denominaciones, cortes y arqueos.
    - `attendance/service.py`: Reglas de entrada de socios y personal.
  - **Beneficio:** Controladores delgados, pruebas unitarias de negocio sin levantar FastAPI, y código reutilizable.

- [ ] **T2.2 — Centralizar dependencias de sesión y autenticación (`deps.py`)**
  - **Archivos:** `api/app/api/deps.py`.
  - **Problema:** Existen ~9 resolutores de credenciales duplicados y ~60 endpoints abriendo sesiones de base de datos manualmente.
  - **Acción:** Crear dependencia canónica `SessionDep = Annotated[Session, Depends(get_db)]` y un resolutor unificado `CurrentUser` con verificación tipada de roles y permisos (`require_permission(...)`).

- [ ] **T2.3 — Estandarizar catálogo de errores y sobre de respuesta**
  - **Archivos:** `api/app/core/errors.py`.
  - **Acción:** Definir clase base `AppError(code, message, details)` con excepciones de dominio (`NotFoundError`, `InsufficientStockError`, `ShiftClosedError`) y un handler global que devuelva errores normalizados.

- [ ] **T2.4 — Desacoplar modelos por Bounded Contexts**
  - **Archivos:** `api/app/db/models/`.
  - **Acción:** Separar el paquete monolítico de modelos para que cada módulo mantenga sus entidades, evitando referencias circulares y facilitando futuras extracciones.

---

## 🎨 Fase 3: Arquitectura y Calidad del Frontend
> **Objetivo:** Desacoplar la UI del código de demostración, estructurar componentes con Atomic Design y optimizar la reactividad.

- [ ] **T3.1 — Romper acoplamiento con `frontend/src/demo/`**
  - **Problema:** Utilidades críticas de negocio (`formatMoney`, tipos `Plan`, estado de membresía) se importan desde `demo/`.
  - **Acción:** Trasladar tipos y funciones puras a `frontend/src/domain/` y `frontend/src/shared/formatters/`. Dejar `demo/` únicamente para fixtures y simulaciones aisladas.

- [ ] **T3.2 — Cliente HTTP centralizado e interceptores**
  - **Archivos:** `frontend/src/api/http.ts`.
  - **Acción:** Crear una instancia única de cliente HTTP que gestione automáticamente tokens de sesión, cabeceras de sucursal, reintentos seguros y mapeo de errores tipados.

- [ ] **T3.3 — Descomposición de componentes gigantes (Container / Presentational)**
  - **Archivos:** `Inventory.tsx`, `ApiReceptionHome.tsx`, `StaffManagement.tsx`.
  - **Acción:** Separar la obtención de datos y mutaciones (Contenedor / Hooks) de la presentación visual pura (Presentational). Reducir archivos de +1,000 líneas a piezas testeables de <250 líneas.

- [ ] **T3.4 — Adoptar TanStack Query (React Query)**
  - **Acción:** Reemplazar llamadas en `useEffect` y estados locales duplicados por consultas cacheadas (`useQuery`, `useMutation`), logrando invalidación automática de datos y estados de carga consistentes.

- [ ] **T3.5 — Primitivo accesible para Diálogos y Modales**
  - **Archivos:** `frontend/src/shared/components/ui/Dialog.tsx`.
  - **Problema:** Existen cerca de 30 implementaciones manuales de modales con problemas de gestión de foco y accesibilidad (WAI-ARIA).
  - **Acción:** Implementar un modal base accesible (foco atrapado, cierre con tecla Escape, bloqueo de scroll de fondo) y migrar los modales de la aplicación a esta base.

---

## 💼 Fase 4: Módulos Funcionales Pendientes
> **Objetivo:** Completar los flujos de negocio del gimnasio que actualmente solo existen en interfaz simulada.

- [ ] **T4.1 — Rentas de Lockers y Guantes**
  - **Alcance:** Modelos relacionales, endpoints de asignación, cobro, vencimiento y devolución de casilleros y equipo deportivo.

- [ ] **T4.2 — Gastos de Operación y Caja Chica**
  - **Alcance:** Registro de egresos desde recepción con comprobante, categoría y afectación directa al arqueo de efectivo del turno actual.

- [ ] **T4.3 — Finanzas y Nómina de Personal**
  - **Alcance:** Cálculo de horas laboradas basadas en `staff_attendance_logs`, registro de anticipos y liquidación quincenal.

- [ ] **T4.4 — Resumen Diario de Operaciones (`DailyOperationsSummary`)**
  - **Alcance:** Endpoint y vista para que el dueño/administrador consulte ventas consolidadas por método de pago (efectivo, transferencias, terminales Point), cancelaciones y discrepancias de caja.

---

## ⚡ Fase 5: Local-First y Modo Contingencia (Offline)
> **Objetivo:** Garantizar que la recepción pueda registrar entradas y ventas en efectivo aun si se corta la conexión a internet.

- [ ] **T5.1 — Base de datos local en navegador (IndexedDB / Dexie)**
  - **Alcance:** Esquema local para almacenar temporalmente ventas en efectivo de mostrador, asistencias de socios y apertura/cierre de turnos.

- [ ] **T5.2 — Cola de sincronización y conciliación en Backend**
  - **Alcance:** Endpoint transaccional `POST /api/v1/sync/contingency-batch` con llaves de idempotencia (`idempotency_key`) para procesar las operaciones retenidas sin duplicar cargos ni accesos al volver la conexión.

---

## 🧪 Fase 6: Pruebas Integrales y Preparación para Producción
> **Objetivo:** Obtener garantías sólidas de estabilidad, concurrencia y seguridad previas a la puesta en marcha.

- [ ] **T6.1 — Habilitar suite completa de PostgreSQL en CI**
  - **Acción:** Configurar base de datos PostgreSQL temporal en GitHub Actions y ejecutar las 17 pruebas de concurrencia y bloqueos actualmente omitidas.

- [ ] **T6.2 — Pruebas End-to-End (E2E) con Playwright**
  - **Acción:** Automatizar los 3 flujos críticos:
    1. Apertura de turno con arqueo -> cobro de membresía -> registro de visita.
    2. Venta de productos y porciones con cobro en efectivo y tarjeta Point.
    3. Cierre de turno y generación de reporte de diferencias.

- [ ] **T6.3 — Hardening de Seguridad y Despliegue**
  - **Acción:** Rate limiting en login y emparejamiento móvil (`/pair`), rotación de secretos en producción, backups automáticos de PostgreSQL con PITR y auditoría final de dependencias (`pip audit`, `npm audit`).

---

## 📌 Guía de Uso del Roadmap
Para avanzar con disciplina:
1. **Seleccionar una tarea a la vez** respetando las dependencias de fase.
2. Seguir el ciclo **Rojo -> Verde -> Refactor** en cada cambio.
3. Marcar la casilla `[x]` correspondiente una vez que los tests aprueben y no existan advertencias de linter.
