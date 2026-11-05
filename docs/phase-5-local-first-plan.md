# Fase 5 — Plan de Implementación: Local-First y Modo Contingencia

> **Estado:** Plan aprobado para ejecución. No hay código de Fase 5 implementado todavía.
> **Nota:** la exploración se hizo antes de integrar los commits de Fase 4 (`7908b68`, `34ea63c`). Antes de la Oleada 1, un agente debe revalidar las rutas `archivo:línea` citadas (sobre todo en `ApiReceptionHome.tsx`, `ApplicationShell`, `src/test/setup.ts` y `app/main.py`).
> **Fuente:** `docs/ROADMAP.md` (T5.1–T5.11). Cubre BK-062 a BK-072. BK-073 (multi-pestaña y actualización de esquema) y BK-074 (suite de pruebas) se integran como criterios transversales.
> **Diseño de referencia:** `docs/backend-plan/08-local-first-and-sync.md` y las decisiones D-026, D-027 y D-033 en `docs/backend-plan/02-business-rules-and-decisions.md`.
> **Ejecución:** exploración hecha con agentes Sonnet. La implementación y la verificación también se hacen con agentes Sonnet, en oleadas (sección 7).

---

## 1. Decisiones de contrato (cerradas)

La documentación existente se contradice: `08` describe un esquema store-and-forward simple, y `02/03/04` describen un journal genérico con cursor opaco y API de conflictos. Para Fase 5 queda fijado el contrato siguiente. Todo lo que no aparezca aquí queda fuera de alcance.

| ID | Decisión |
|---|---|
| **F5-D1** | **Cola local inmutable** en IndexedDB con **Dexie**. Cada evento lleva un ID con prefijo del dispositivo: `REC-{CODIGO_ESTACION}-{seq:05d}`, por ejemplo `REC-SUR1-00123`. Un evento encolado nunca se edita: solo cambia su `sync_status`. |
| **F5-D2** | **Matriz de capacidades estricta (D-027).** Las operaciones que dependen de internet se bloquean en la UI de inmediato con el mensaje *"Requiere internet"*. Nunca se encolan. Son: Point de Mercado Pago, links de cobro (Checkout Pro), WhatsApp/Gimi, edición de catálogo, configuración, roles y devoluciones. |
| **F5-D3** | **Flujo unidireccional.** Hay tres endpoints de contrato más uno de soporte: `POST /api/v1/sync/bootstrap`, `POST /api/v1/sync/contingency-events`, `GET /api/v1/sync/roster-delta` y el heartbeat `GET /api/v1/sync/status`. No hay multi-master ni merge a tres vías. |
| **F5-D4** | **Idempotencia por `(event_id, payload_hash)`.** Si llega el mismo par otra vez, se devuelve el recibo original (`duplicate`). Si llega el mismo `event_id` con otro hash, se rechaza (`rejected` / `payload_hash_mismatch`), se registra un evento de seguridad y **nunca se aplica**. |
| **F5-D5** | **Reconciliación por auditoría.** Las diferencias de inventario, de caja, de reloj o de permisos generan **banderas de auditoría** ligadas al turno. La cola nunca se bloquea y nunca se revierte una transacción ya ocurrida físicamente (el dinero está en el cajón y el socio ya entró). |
| **F5-D6** | **Delta por timestamp de actualización.** El cursor es `(changed_at, id)` con desempate por id. Si el cursor tiene más de `SYNC_DELTA_MAX_AGE_DAYS` (7), la respuesta trae `snapshot_required: true` y el cliente vuelve a hacer bootstrap. |
| **F5-D7** | **El PIN offline usa un hash dedicado del dispositivo.** El hash se calcula en el cliente con PBKDF2-SHA256 de WebCrypto (310 000 iteraciones y sal aleatoria por dispositivo y empleado) cuando el empleado inicia sesión **online** con su PIN. El hash bcrypt del servidor **nunca sale del servidor**. No se agrega ninguna dependencia. |
| **F5-D8** | **TTL de la autorización offline: 24 h.** Es configurable con `EVOGYM_SYNC_OFFLINE_GRANT_TTL_HOURS=24`. Se cuenta desde el último login online exitoso de ese empleado en ese dispositivo. Al sincronizar, el servidor revalida los permisos de cada actor. |
| **F5-D9** | **Check-ins cercanos (<5 min, D-033).** Se **vinculan** a la misma visita y se conservan como eventos auditables separados; no se descartan. La ventana es fija desde el primer acceso, se mide con `client_recorded_at`, y exactamente 300 s inicia una visita nueva. Esto corrige la redacción "deduplicación" de T5.8. |
| **F5-D10** | **Reloj (D-033).** El cliente envía un ancla `{server_anchor_utc, monotonic_delta_ms}`, obtenida de `/sync/status` y del helper existente `offlineClock.ts`. Si el desfase supera 5 min, o no hay ancla, el evento se marca `clock_skew` o `unverified_clock`. Nunca se rechaza ni se corrige. |

### Tipos de evento soportados en Fase 5

| `event_type` | Origen (tarea) | Efecto en el servidor |
|---|---|---|
| `attendance.check_in` | T5.3 / T5.8 | `MemberCheckIn` y vínculo a `MemberCheckInVisit` |
| `pos.cash_sale` | T5.3 / T5.8 | `Order` + `OrderItem` + `Payment(cash)` + `StockMovement(sale)` |
| `shift.arqueo_close` | T5.9 | `close_shift` con las denominaciones contadas |
| `shift.open` | T5.9 | `open_shift` con el fondo inicial |

**Fuera de alcance en Fase 5:** estos casos quedan bloqueados offline por la matriz:
- `membership.cash_renewal`
- `member.fast_registration`
- asistencia de personal y check-out
- rentas, gastos y devoluciones
- la API de resolución de conflictos del Admin
- la Background Sync API

D-027 los permite, pero se difieren a una fase posterior.

---

## 2. Estado actual (resultado de la exploración)

### Backend (`api/`)
- **No existe código de sincronización** (ni routers, ni modelos, ni migraciones). La última migración es `0056_gimi_knowledge`, así que la siguiente es **`0057_contingency_sync`**.
- **Piezas reutilizables:**
  - `app/auth/hashing.py` (bcrypt) y `app/auth/credentials.py:41` (bloqueo tras 5 intentos).
  - `ReceptionStation` (`app/db/models/reception_stations.py`, con `credential_digest` sha256).
  - `StaffPairedDevice` (`app/db/models/devices.py`).
  - `evaluate_membership_access` (`app/memberships/eligibility.py`).
  - `post_cash_product_sale` (`app/sales/queries.py:59`).
  - `open_shift`, `close_shift` y `expected_cash_for_shift` (`app/shifts/queries.py:158/305/392`).
  - `append_audit_event` (`app/audit.py:26`).
- **Bloqueos técnicos que hay que resolver:**
  1. La lógica de check-in está escrita directamente en el handler `record_member_check_in` (`app/api/member_check_ins.py`) y fija `occurred_at = utc_now()`. Hay que extraerla a una función de servicio que reciba `occurred_at`.
  2. `post_cash_product_sale` rechaza el stock insuficiente y la deriva de precio. Necesita una política `contingency` que use el precio del dispositivo, permita stock negativo y devuelva las varianzas.
  3. `MemberCheckIn`, `MemberCheckInVisit` y `AuditEvent` son append-only por listeners. Las banderas van en una tabla nueva, nunca con UPDATE.
  4. `AuditEvent.action` tiene un CHECK cerrado. La migración debe agregar `sync_ingest`.
  5. `PublicDomainError` usa un `Literal` cerrado (`app/errors.py:11`). Hay que registrar ahí los códigos nuevos.
  6. `Product` no tiene `updated_at`, así que la migración lo agrega. `MembershipPeriod` y las deudas no tienen `updated_at`, así que el delta del padrón usa el máximo de varios timestamps.
  7. No existe numeración de folio. `Order` recibe `offline_receipt_number` (único y nullable).
  8. No hay `conftest.py`. Los fixtures son helpers importados: `_setup_db` en `tests/test_shifts.py`, y `configured_settings` y `_seed_receptionist` en `tests/test_admin_auth.py`.
- **Línea base:** no se pudo ejecutar porque faltan dependencias. Se instalan con `pip install -e 'api[test]'` y se corre `cd api && python -m pytest -q`.

### Frontend (`frontend/`)
- **PWA:** `vite.config.ts:11-47` ya configura `VitePWA` (`autoUpdate`, manifest e íconos en `public/`). Faltan `navigateFallback`, la exclusión de `/api` y el registro explícito con `virtual:pwa-register`.
- **Almacenamiento offline:** no hay IndexedDB, Dexie, `navigator.onLine` ni Service Worker en `src/`. El único código offline es `src/features/checkIns/offlineClock.ts` (se reutiliza).
- **Puntos de enganche:**
  - **Venta en efectivo:** `submit()` en `app/ApiReceptionHome.tsx:~189-310`.
  - **Check-in:** `recordCheckIn` en `app/ApiMembers.tsx:268-306`.
  - **Turnos:** `features/shifts/ShiftOpenModal.tsx` y `ShiftCloseDialog.tsx`.
  - **Login con PIN:** `ProductAccessProvider.enter()` (`features/auth/ProductAccessProvider.tsx`) y `features/staff/StaffProfileSelection.tsx`.
  - **Indicador de estado:** slot `headerActionsBeforeTheme` de `ApplicationShell`, que se pasa desde `ApiProductApp.tsx:~153`.
  - **Guard de red:** envoltura de `access.request` (`AuthenticatedRequest`).
- **Operaciones a bloquear offline (T5.11):**
  - Tarjeta Point: `createCardIntent` y `submitCardProductSale` en `productSalesApi.ts`, más `PointPaymentModal`.
  - Catálogo: `saveCatalogPlan` y `updateCatalogPlanStatus` (`PlanCatalog.tsx`), y `createCatalogProduct` y `updateCatalogProduct` (`InventoryAnalytics.tsx`).
  - Checkout Pro: no existe en el frontend. Se registra en la matriz para cuando se agregue.
- **Restricción existente:** `RootApp.test.tsx:113` exige que los secretos nunca lleguen a localStorage ni sessionStorage. El hash offline va en IndexedDB y el token del dispositivo también, nunca en Web Storage.
- **Línea base:** no se pudo ejecutar porque falta `node_modules`. Se instala con `npm ci` y se corre `npx vitest run` y `npx tsc -b`.

---

## 3. Diseño del backend

### 3.1 Migración `0057_contingency_sync`
Debe usar `op.batch_alter_table` para que funcione en SQLite.

**`sync_devices`**

| Columna | Detalle |
|---|---|
| `id` | UUID, llave primaria |
| `branch_id` | FK |
| `reception_station_id` | FK nullable |
| `device_prefix` | Por ejemplo `REC-SUR1`. Único y con CHECK `^[A-Z]+-[A-Z0-9]{2,8}$` |
| `token_digest` | sha256, único |
| `provisioned_by` | FK a `staff_users` |
| `issued_at`, `expires_at`, `revoked_at` | |
| `last_seen_at` | |
| `last_ingested_seq` | int |

**`contingency_events`**

| Columna | Detalle |
|---|---|
| `id` | UUID, llave primaria |
| `device_id` | FK |
| `event_id` | String(64), **único global** (el prefijo garantiza unicidad) |
| `seq` | int. Además `UNIQUE(device_id, seq)` |
| `event_type` | CHECK con los 4 tipos |
| `schema_version` | |
| `actor_staff_id` | |
| `payload` | JSON |
| `payload_hash` | char(64) |
| `client_recorded_at` | |
| `clock_anchor_utc`, `clock_monotonic_delta_ms` | nullable |
| `server_received_at` | |
| `status` | `accepted` \| `flagged_audit` \| `rejected` |
| `reason_code` | nullable |
| `result_order_id`, `result_check_in_id`, `result_shift_id` | FKs nullable |

**`sync_audit_flags`**

| Columna | Detalle |
|---|---|
| `id` | |
| `event_row_id` | FK a `contingency_events` |
| `branch_id` | |
| `shift_id` | nullable |
| `kind` | CHECK con: `inventory_variance`, `price_drift`, `cash_discrepancy`, `clock_skew`, `unverified_clock`, `entitlement_denied_on_sync`, `actor_not_authorized`, `orphan_shift_reference`, `linked_check_in` |
| `details` | JSON |
| `created_at` | |
| `resolved_at`, `resolved_by` | nullable. Tabla mutable solo en estos dos campos |

**Cambios a tablas existentes**
- `orders`:
  - Agregar `offline_receipt_number`: String(64), nullable y único.
  - Agregar `origin`: `online` | `contingency`, con default `online`.
- `products`: agregar `updated_at` con server default `now()` y `onupdate`.
- `audit_events`: reescribir `ck_audit_events_action` para agregar `sync_ingest`.

**Otros cambios del backend**
- Exportar los modelos nuevos en `app/db/models/__init__.py`.
- Actualizar `tests/test_migrations.py` con el nuevo head.

### 3.2 Settings (`app/settings.py`)

| Variable | Valor por defecto |
|---|---|
| `sync_device_token_ttl_days` | 30 |
| `sync_offline_grant_ttl_hours` | 24 |
| `sync_batch_max_events` | 100 |
| `sync_batch_max_bytes` | 262144 |
| `sync_delta_page_size` | 500 |
| `sync_delta_max_age_days` | 7 |
| `sync_clock_skew_tolerance_seconds` | 300 |

### 3.3 Paquete `app/sync/` (capa de servicio) y routers

```
api/app/sync/
  __init__.py
  envelope.py      # Pydantic: ContingencyEvent, payloads por tipo, canonical_json(), payload_hash()
  devices.py       # provision_device, authenticate_device_token (dependency), revoke
  bootstrap.py     # build_bootstrap_snapshot(session, branch_id, at)
  roster.py        # roster_row(member) + delta query (keyset changed_at,id)
  ingest.py        # ingest_batch(session, device, events) -> list[Receipt]
  reconcile.py     # apply_check_in / apply_cash_sale / apply_shift_open / apply_arqueo_close
  clock.py         # classify_clock(client_recorded_at, anchor, delta) (espejo de offlineClock.ts)
  flags.py         # raise_flag(...)
api/app/api/sync/
  __init__.py      # incluye los sub-routers; main.py registra uno solo
  bootstrap.py     # POST /api/v1/sync/bootstrap, GET /api/v1/sync/status
  events.py        # POST /api/v1/sync/contingency-events
  delta.py         # GET  /api/v1/sync/roster-delta
  audit.py         # GET  /api/v1/sync/audit-flags (Admin), POST /audit-flags/{id}/resolve
```

**JSON canónico** (debe dar el mismo hash en Python y en TypeScript):
- llaves ordenadas;
- separadores `,` y `:` sin espacios;
- UTF-8 con `ensure_ascii=False`;
- montos en enteros `*_minor`, nunca flotantes;
- fechas en ISO-8601 UTC con `Z` y milisegundos.

Se agrega un **vector de prueba compartido** en `docs/work-packages/contracts/F5-canonical-json-vectors.json` y lo usan las suites de los dos lados.

### 3.4 Endpoints

#### `POST /api/v1/sync/bootstrap` (T5.4)

**Autenticación:** sesión de staff online (Bearer) con permiso de recepción en la sucursal, más `X-Branch-ID`. Requiere internet, según D-027.

**Request:**
```json
{
  "station_code": "SUR1",
  "reception_station_id": "uuid|null",
  "client_schema_version": 1,
  "rotate": false
}
```

**Response:**
```json
{
  "device": {
    "device_id": "...",
    "device_prefix": "REC-SUR1",
    "token": "<opaco, una sola vez>",
    "expires_at": "...",
    "next_seq": 124
  },
  "server_time": "...",
  "offline_grant_ttl_hours": 24,
  "branch": { "id": "...", "code": "...", "name": "...", "timezone": "America/Mexico_City" },
  "roster": [
    {
      "member_id": "...",
      "member_number": "...",
      "full_name": "...",
      "phone_last4": "...",
      "photo_hash": "...|null",
      "status": "...",
      "active_periods": [
        { "period_id": "...", "starts_on": "...", "ends_on": "...", "access": "valid|valid_with_outstanding_balance|denied" }
      ],
      "has_debt": false,
      "changed_at": "..."
    }
  ],
  "catalog": [
    { "product_id": "...", "code": "...", "name": "...", "unit": "piece|scoop", "price_minor": 0, "is_active": true, "on_hand": 0 }
  ],
  "registers": [
    { "register_id": "...", "name": "...", "open_shift": { "shift_id": "...", "opened_at": "...", "opening_cash_minor": 0 } }
  ],
  "cursor": { "changed_at": "...", "id": "..." }
}
```

**Reglas del bootstrap:**
- El padrón solo incluye socios con un `MembershipPeriod` vigente en la sucursal o que vence en ≤ 7 días.
- **No** incluye notas ni datos de salud. El teléfono se reduce a los últimos 4 dígitos.
- La operación es idempotente con `rotate=false`: si la estación ya tiene un dispositivo vigente, se emite un token nuevo y se revoca el anterior.
- `next_seq` es `last_ingested_seq + 1`. Así el dispositivo recupera su secuencia aunque el navegador haya perdido datos.

#### `GET /api/v1/sync/status` (soporte de T5.10)
- **Autenticación:** token de dispositivo.
- **Respuesta:** `{server_time, branch_active, device_expires_at, snapshot_required, min_client_schema_version}`.
- Funciona como heartbeat y como ancla de reloj.

#### `POST /api/v1/sync/contingency-events` (T5.5)
- **Autenticación:** `Authorization: Bearer <device token>`. Se valida con la dependencia `authenticate_device_token`, que exige que el dispositivo no esté revocado ni expirado y que la sucursal esté activa.
- **Body:** `{events: [ContingencyEvent]}`.
  - Máximo `sync_batch_max_events` eventos y `sync_batch_max_bytes` bytes. Un lote más grande devuelve 413.
  - Los eventos se ordenan por `seq`.
- **Por evento**, cada uno en **su propia transacción**, sin ficción de "todo el lote o nada":
  1. Validar el esquema. Si falla: `rejected/invalid_payload`.
  2. Recalcular el hash. Si no coincide con el enviado: `rejected/payload_hash_mismatch`.
  3. Verificar que el prefijo de `event_id` corresponda al dispositivo. Si no: `rejected/device_mismatch` más un evento de seguridad.
  4. Buscar el `event_id`:
     - existe con el mismo hash: `duplicate`, se devuelve el recibo original;
     - existe con distinto hash: `rejected/payload_hash_mismatch` más `queue_security_event`, sin aplicar nada.
  5. Revalidar al actor con `authorize(...)` para la sucursal. Si falla, se aplica de todos modos y se agrega la bandera `actor_not_authorized` (F5-D5).
  6. Clasificar el reloj. Si corresponde, se agrega la bandera `clock_skew` o `unverified_clock`.
  7. Aplicar el efecto de dominio (sección 3.5). En la misma transacción se escriben la fila de `contingency_events`, las banderas y el `append_audit_event(action="sync_ingest")`.
  8. Actualizar `device.last_ingested_seq` y `last_seen_at`.
- **Response:**
  ```json
  {"receipts": [{"event_id": "...", "status": "accepted|duplicate|flagged_audit|rejected", "reason_code": "...", "server_refs": {"order_id": "...", "check_in_id": "...", "shift_id": "..."}, "flags": ["..."]}]}
  ```
- **Estado `flagged_audit`:** el evento se aplicó y tiene al menos una bandera.
- **Estado `rejected`:** solo se usa para fallas de integridad, nunca para reglas de negocio.

#### `GET /api/v1/sync/roster-delta?cursor=<changed_at>|<id>&limit=500` (T5.6)
- **Autenticación:** token de dispositivo.
- **`changed_at` de cada socio:** es el máximo de estos timestamps:
  - `Member.updated_at`
  - `MembershipPeriod.created_at`
  - el momento de pago o creación de la deuda
  - `MemberAccessDecision.created_at`
- **Catálogo:** se usa `Product.updated_at`. El catálogo es pequeño, así que cuando cambia algo se envía completo.
- **Response:**
  ```json
  {"members": [RosterRow], "removed_member_ids": [], "catalog": [] /* o null si no cambió */, "registers": [...], "next_cursor": {...}, "has_more": true, "snapshot_required": false}
  ```
- **Bajas:** un socio sin periodo vigente aparece en `removed_member_ids`. No hay soft-delete; la baja se infiere del estado.
- **Consistencia:** la consulta se acota a `changed_at <= server_now` (capturado al inicio), con desempate por `id`.

#### `GET /api/v1/sync/audit-flags` y `POST /api/v1/sync/audit-flags/{id}/resolve` (alerta de T5.9)
- Solo para Admin.
- Filtros: `branch_id`, `shift_id`, `kind` y `unresolved=true`.
- Además, `shift_financial_summary` agrega `contingency_flags_count` para que la pantalla de turnos muestre la alerta.

### 3.5 Reconciliación (T5.8 y T5.9): refactors y reglas

**Refactor previo** (Oleada 1). Debe ser no funcional, así que los tests existentes deben seguir en verde:
- Extraer de `app/api/member_check_ins.py` la función `record_check_in(session, *, branch_id, period_id, actor_id, occurred_at, idempotency_key, fingerprint, access_decision) -> (check_in, visit, replayed)` y llevarla a `app/attendance/service.py`. El handler online la llama con `occurred_at=utc_now()`.
- Agregar a `post_cash_product_sale` un parámetro `policy: SalePolicy = SalePolicy.ONLINE`. Con `SalePolicy.CONTINGENCY` la venta:
  - usa `unit_price_minor` del payload;
  - registra `price_drift` si difiere del precio del servidor;
  - permite stock negativo y devuelve la lista de varianzas;
  - no exige `ProductSaleIntent`;
  - acepta `occurred_at`, `offline_receipt_number` y `financial_shift_id`.

**Reglas por tipo de evento:**

| Evento | Regla |
|---|---|
| `attendance.check_in` | Payload: `{member_id, period_id, branch_id, local_access_decision}`. El servidor reevalúa con `evaluate_membership_access(period, fecha de client_recorded_at)`. Si el servidor deniega, el check-in **se registra igual** con la bandera `entitlement_denied_on_sync`, porque el acceso ya ocurrió. La ventana de 5 minutos sigue F5-D9 y usa `client_recorded_at`. Dentro de un lote, los eventos de un mismo socio se procesan en orden de `client_recorded_at`. Si el evento se vincula a una visita existente, se agrega la bandera `linked_check_in` como información. La llave de idempotencia es `event_id`. |
| `pos.cash_sale` | Payload: `{register_id, local_shift_ref, member_id?, items:[{product_id, quantity, unit_price_minor}], total_minor, online_idempotency_key?}`. **Contra el doble cobro:** si viene `online_idempotency_key` y ya existe una `Order(seller, branch, idempotency_key)`, el evento se trata como `duplicate` ligado a esa orden. `local_shift_ref` puede ser un `shift_id` del servidor o el `event_id` de un `shift.open` offline; en ese caso se busca en `contingency_events.result_shift_id`. Si no se puede resolver, la venta se aplica como overtime sobre el último turno y se agrega la bandera `orphan_shift_reference`. Cada línea con stock resultante < 0 genera `inventory_variance`. `Order.origin` queda en `contingency` y `offline_receipt_number` en `event_id`. |
| `shift.arqueo_close` | Payload: `{shift_ref, denomination_counts:[{denomination_minor, quantity}], voucher_count, closing_notes}`. Se llama a `close_shift(now=client_recorded_at)`. El servidor calcula lo esperado con `expected_cash_for_shift`, que incluye las ventas ya ingeridas. Si `difference_minor != 0`, se agrega la bandera `cash_discrepancy` con `{expected, counted, difference}`. Un cierre repetido con los mismos conteos es `duplicate`. Si el turno ya fue cerrado online con conteos distintos, la llamada no falla: se agrega `cash_discrepancy` con ambos conteos. |
| `shift.open` | Payload: `{register_id, opening_cash_minor, denomination_counts}`. Se llama a `open_shift(now=client_recorded_at)`. Si ya hay un turno abierto en esa caja, se reutiliza y se agrega la bandera `cash_discrepancy` cuando el fondo difiere. |

**Ventas que llegan después del arqueo.** El dispositivo envía en orden de `seq`, así que no deberían llegar ventas posteriores a un arqueo. Si llega una, se aplica como overtime con la bandera `orphan_shift_reference` y se recalcula `difference_minor` en la bandera, nunca en el turno cerrado.

### 3.6 Errores y seguridad
- **Códigos nuevos** en `DomainCode` y `_PUBLIC_MESSAGES`: `sync_device_revoked`, `sync_device_expired`, `sync_snapshot_required`, `sync_batch_too_large`.
- **CORS:** no requiere cambios (se usa `Authorization`).
- **`_AuthBodyLimitMiddleware`:** **no** se agrega `/contingency-events`. Ese endpoint tiene su propio límite.
- **Rate limit:** el bootstrap usa `auth_rate_limiter`.
- **Logs:** nunca se registran el payload completo ni el token.

---

## 4. Diseño del frontend

### 4.1 Estructura nueva
```
frontend/src/offline/
  db.ts                 # Dexie EvoGymLocalDB (versionado)
  canonicalJson.ts      # canonicalJson() + payloadHash() (WebCrypto SHA-256)
  sequence.ts           # allocateEventId(): Web Lock 'evogym-seq' + transacción Dexie
  capabilities.ts       # matriz D-027 + isAllowedOffline(cmd) + OnlineOnlyError
  dispatcher.ts         # dispatch(command) → valida, crea evento, proyección optimista
  syncApi.ts            # bootstrap / status / postEvents / rosterDelta (cliente HTTP)
  bootstrap.ts          # aplica snapshot a Dexie
  rosterDelta.ts        # aplica páginas delta atómicamente y luego avanza el cursor
  flushManager.ts       # vaciado por lotes, backoff, Web Lock 'evogym-flush'
  connectivity.ts       # online/offline hint + heartbeat /sync/status
  offlinePin.ts         # PBKDF2 derive/verify, TTL, lockout local
  SyncProvider.tsx      # contexto: {status, pendingCount, lastSyncAt, flushNow}
  OfflineStatusBadge.tsx
  RequiresOnline.tsx    # wrapper UI "Requiere internet"
  *.test.ts(x)
```

### 4.2 T5.1 — Shell de la PWA
- En `vite.config.ts` → `VitePWA`, agregar `workbox`:
  - `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`
  - `navigateFallback: '/index.html'`
  - `navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json/]`
  - **sin** `runtimeCaching` para `/api` (prohibido cachear respuestas autenticadas)
  - `cleanupOutdatedCaches: true`
- En `src/main.tsx`, llamar a `registerSW({ onOfflineReady, onNeedRefresh })` desde `virtual:pwa-register`. Agregar `"vite-plugin-pwa/client"` a los `types` de `tsconfig.app.json`.
- Crear un hook `usePwaLifecycle` que muestre un aviso con *"Lista para usar sin conexión"* y *"Nueva versión disponible"*. Mientras haya eventos pendientes, la recarga se pospone para no perder la cola durante una actualización (BK-073).

### 4.3 T5.2 — Base local con Dexie
- **Dependencias:** `dexie` y, como dev, `fake-indexeddb`. Se importa `fake-indexeddb/auto` en `src/test/setup.ts`.
- **Tablas en `version(1)`:**

  | Tabla | Llave e índices |
  |---|---|
  | `meta` | `&key`: schemaVersion, cursor, lastSyncAt, storageHealthy, serverAnchor |
  | `device` | `&id`: deviceId, devicePrefix, token, expiresAt, branchId |
  | `members` | `&member_id`, `member_number`, `*nameTokens` |
  | `catalog` | `&product_id`, `unit` |
  | `registers` | `&register_id` |
  | `shift_state` | `&register_id`: estado optimista, efectivo esperado local |
  | `offline_credentials` | `&staff_id`: salt, hash, iterations, grantExpiresAt, failedAttempts, lockedUntil |
  | `local_event_queue` | `&event_id`, `seq`, `sync_status`, `created_at` |
  | `receipts` | `&event_id` |
  | `local_check_ins` | `++id`, `member_id`, `recorded_at` (para la regla de 5 minutos local) |

- **Persistencia:** al primer bootstrap se llama `navigator.storage.persist()`. Si una escritura falla por cuota, `storageHealthy=false` y el dispatcher rechaza las operaciones offline con el mensaje *"Almacenamiento lleno: no se puede operar sin conexión"* (fail-closed).
- **Migraciones futuras:** van con `db.version(n).upgrade(...)` y nunca borran `local_event_queue`. Si la versión es incompatible, la cola pasa a modo solo lectura y se puede exportar (BK-073).

### 4.4 T5.3 — Dispatcher y folios
- La función es `dispatch({type, payload, actor})`. Primero valida con la matriz de capacidades: un comando online-only lanza `OnlineOnlyError` y no deja efectos. Después ejecuta **una sola transacción Dexie** que hace lo siguiente:
  1. obtiene el `seq` con `allocateEventId()`, protegido con Web Lock para que dos pestañas nunca repitan folio;
  2. construye el envelope con `client_recorded_at` y el ancla de reloj;
  3. calcula `payload_hash`;
  4. escribe en `local_event_queue` con `sync_status='queued'`;
  5. aplica la proyección optimista (check-in local, `on_hand` local, efectivo esperado local).
- La UI muestra el folio provisional `REC-SUR1-00123` **solo después** de que la transacción confirmó, porque el append es durable antes de mostrar "pendiente".
- Al terminar, se avisa a `flushManager.kick()`.
- **Enganches (desvío a cola):**
  - **`ApiReceptionHome.submit()`, rama de efectivo.** Si la app está offline, se despacha `pos.cash_sale` con el precio del catálogo local. Si la llamada online falla con `OperationalApiNetworkError` o `ProductSaleError` sin `definitelyRejected`, se despacha con `online_idempotency_key` igual a la llave usada (es la protección contra el doble cobro).
  - **`ApiMembers.recordCheckIn`, más la búsqueda de recepción offline sobre `members` local.** Se despacha `attendance.check_in` con la decisión de acceso local calculada desde `active_periods`.
  - **`ShiftCloseDialog` y `ShiftOpenModal`.** Si la app está offline, se despachan `shift.arqueo_close` y `shift.open`.

### 4.5 T5.6 — Cliente del delta
- Se ejecuta tras cada flush exitoso y cada 5 minutos mientras hay conexión.
- Cada página se aplica en una transacción Dexie, y el cursor avanza **en la misma transacción**.
- Con `snapshot_required` se repite el bootstrap y se conserva la cola.

### 4.6 T5.7 — PIN offline
- En `ProductAccessProvider.enter()`, después de un login online exitoso, se llama a `offlinePin.remember(staffId, branchId, pin, ttlHours)`. Esa función genera la sal aleatoria, deriva con PBKDF2-SHA256 (310 000 iteraciones) y guarda `grantExpiresAt = now + 24h`.
- Cuando la app está offline, `StaffProfileSelection` permite entrar con el PIN contra `offline_credentials`. Las reglas son:
  - 5 intentos fallidos producen un bloqueo local de 5 minutos;
  - la comparación es en tiempo constante;
  - un grant expirado muestra *"Autorización offline vencida: conéctate para iniciar sesión"*.
- El resultado es un principal `{kind:'employee', session:{offline:true, expiresAt}}` limitado a la matriz de capacidades. `request` queda envuelto para que todo pase por el dispatcher.
- Al salir de un perfil, o si el servidor revoca el dispositivo, se borran `offline_credentials` del staff afectado.
- Nada de esto va en localStorage ni sessionStorage, así que el test de `RootApp.test.tsx:113` debe seguir verde.

### 4.7 T5.10 — Reconexión e indicador
- **Conectividad:** `connectivity.ts` toma `online` y `offline` como pista y confirma con un heartbeat `GET /sync/status` (timeout 4 s) cada 30 s cuando sospecha que no hay red, o al volver `online`, `visibilitychange` o `focus`. El heartbeat también refresca el ancla de reloj.
- **Vaciado (`flushManager`):**
  - adquiere el Web Lock `evogym-flush`, así que solo una pestaña vacía la cola;
  - envía lotes de ≤ 50 eventos en orden de `seq`;
  - marca `sending`;
  - procesa los recibos:
    - `accepted` y `duplicate`: se guarda el recibo y se purga el evento;
    - `flagged_audit`: se purga el evento y se guarda el recibo con insignia de auditoría;
    - `rejected`: el evento pasa a `rejected`, queda visible en "Eventos con error" y **no bloquea** los siguientes.
- **Errores de red o 5xx:** se aplica backoff exponencial con jitter (2 s, 4 s, 8 s… hasta 5 min). Si se pierde la respuesta, el estado queda `unknown` y se reintenta con el mismo `event_id` (el servidor devuelve `duplicate`).
- **Estados de `SyncProvider`:**
  - `offline`: **Offline**, gris, con el número de pendientes.
  - `syncing`: **Sincronizando (n)**, ámbar.
  - `synced`: **Sincronizado**, verde, con la última hora.
  - `error`: **Error de sincronización**, rojo, con reintento manual.
- **Ubicación del indicador:** `OfflineStatusBadge` va en el slot `headerActionsBeforeTheme` (`ApiProductApp.tsx:~153`). Se monta `SyncProvider` dentro de `ProductAccessProvider` (`RootApp.tsx`).

### 4.8 T5.11 — Guardián de capacidades online-only
- **Matriz (`capabilities.ts`):**
  - **Permitido offline:** `attendance.check_in`, `pos.cash_sale`, `shift.open` y `shift.arqueo_close`.
  - **Todo lo demás es online-only:** `point.card_payment`, `checkout_pro.link`, `catalog.edit`, `inventory.product_edit`, `inventory.stock_movement`, `membership.sale`, `rental.*`, `expense.*`, `refund.*`, `gimi.*`, `whatsapp.*` y `staff.admin`.
- **UI:**
  - `useCapability(cmd)` devuelve `{allowed, reason}`.
  - `<RequiresOnline cmd=...>` deshabilita el control y muestra el tooltip *"Requiere internet"*.
  - Se aplica en el método tarjeta de `CurrentPurchaseCard` y `PointPaymentModal`, en `PlanCatalog` (guardar y estado), en `InventoryAnalytics` (alta y edición de producto, movimientos), en `LiveMembershipCheckout` y en los modales de rentas y gastos.
- **Defensa en profundidad:** el wrapper de `request` lanza `OnlineOnlyError` **antes** de llamar a `fetch` cuando la app está offline y la ruta coincide con un comando online-only, como `/card-intent`, `/product-sales/card`, `/catalog/` (POST, PUT o PATCH) y `/inventory/products`.

---

## 5. Criterios de aceptación por tarea

| Tarea | Criterio verificable |
|---|---|
| T5.1 | `npm run build` genera `sw.js`. En `vite preview`, con la red cortada en Playwright (`context.setOffline(true)`), recargar `/reception/home` arranca la app. `/api/*` nunca aparece en el precache (se revisa el manifiesto del SW). |
| T5.2 | Pruebas con `fake-indexeddb`: el esquema crea todas las tablas; si la cuota falla (mock de `QuotaExceededError`), `storageHealthy=false` y el dispatcher rechaza. Una actualización de versión conserva la cola. |
| T5.3 | El folio tiene el formato `REC-SUR1-00001`. Dos "pestañas" simuladas en paralelo no repiten `seq`. El evento existe en Dexie antes de que la UI muestre "pendiente". Un comando online-only offline lanza `OnlineOnlyError` sin escribir nada. El hash TS coincide con los vectores compartidos. |
| T5.4 | La respuesta contiene el token (solo una vez), el padrón sin PII sensible, el catálogo, las cajas y el cursor. Sin sesión → 401. Con otra sucursal → 403. Un token rotado invalida el anterior. `next_seq` refleja `last_ingested_seq`. |
| T5.5 | El mismo `(event_id, hash)` dos veces produce `duplicate` con el mismo `server_refs` y una sola `Order`. El mismo id con otro hash produce `rejected/payload_hash_mismatch`, sin efecto y con evento de seguridad. Un lote de más de 100 eventos devuelve 413. Un evento inválido en medio del lote no impide aplicar los demás. Un token revocado devuelve 401. |
| T5.6 | Un socio modificado después del cursor aparece en el delta. Un pago de deuda o un periodo nuevo también lo hacen aparecer. Un socio sin vigencia sale en `removed_member_ids`. La paginación con empates de `changed_at` no pierde ni repite filas. Un cursor de más de 7 días devuelve `snapshot_required`. |
| T5.7 | El PIN correcto entra y el incorrecto no. Tras 5 fallos hay un bloqueo de 5 minutos. Un grant de más de 24 h (con reloj simulado) se rechaza. El hash nunca aparece en localStorage ni sessionStorage. Al sincronizar con un actor sin permiso, el evento queda `flagged_audit/actor_not_authorized`. |
| T5.8 | Dos check-ins a 299 s comparten visita y quedan como 2 registros con `linked_check_in`. A 300 s se crean visitas distintas. Una venta con stock insuficiente se aplica y produce `inventory_variance` con stock negativo. Una venta con `online_idempotency_key` ya cobrada devuelve `duplicate` y no hay doble cobro. Un acceso denegado en el servidor se registra con `entitlement_denied_on_sync`. |
| T5.9 | Con el flujo abrir online → ventas offline → arqueo offline → abrir offline → ventas, el servidor calcula lo esperado de cada turno incluyendo las ventas sincronizadas. Un conteo distinto del esperado genera `cash_discrepancy` visible en `/sync/audit-flags` y en `shift_financial_summary.contingency_flags_count`. |
| T5.10 | Con un reloj falso de vitest: las fallas consecutivas aplican backoff de 2, 4 y 8 s; una respuesta perdida se reenvía con el mismo id; dos pestañas no vacían la cola al mismo tiempo; el badge pasa por Offline → Sincronizando → Sincronizado. |
| T5.11 | Offline, el botón de tarjeta Point y el guardado de catálogo están deshabilitados con "Requiere internet". El wrapper de `request` no llama a `fetch` para rutas online-only. Online, todo funciona igual que antes (sin regresiones). |
| Global | La suite de backend (`pytest`), la de frontend (`vitest`), `tsc -b` y `npm run build` están en verde. Un E2E Playwright de humo (sección 7, Oleada 4) pasa. |

---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Doble cobro si la venta online sí llegó al servidor pero la respuesta se perdió y luego se encola | `online_idempotency_key` en el payload y búsqueda de `Order` existente en la reconciliación. |
| Hash distinto entre Python y TS | JSON canónico con montos enteros y vectores de prueba compartidos que ambas suites validan. |
| SQLite no prueba bloqueos (`with_for_update` no hace nada) | Las pruebas de concurrencia de ingesta se marcan `*_postgres.py` (se omiten en local y se habilitan en CI con T6.1). |
| El refactor de check-in o de venta rompe el flujo online | Oleada 1: refactor no funcional verificado con la suite existente antes de agregar la política de contingencia. |
| Pérdida de la cola por limpieza del navegador | `storage.persist()`, contador de pendientes visible y `next_seq` del servidor en el re-bootstrap (los folios no se repiten). Riesgo residual documentado (D-030 sigue sin resolverse). |
| Un token de dispositivo robado | El token solo permite ingerir eventos y leer el padrón reducido de su sucursal. Tiene TTL de 30 días, se revoca desde Admin y el servidor revalida al actor por evento. |

---

## 7. Ejecución con agentes Sonnet

Todos los agentes de implementación y de verificación usan `model: sonnet`. La propiedad de los archivos es **disjunta** dentro de cada oleada, para que los agentes paralelos no choquen. El orquestador (sesión principal) hace commit y push al final de cada oleada verificada, en la rama `integration/frontend-design`.

### Oleada 0: entorno y línea base (1 agente)
- **E0 (env):**
  - `pip install -e 'api[test]'` y `cd api && python -m pytest -q`;
  - `cd frontend && npm ci && npx vitest run && npx tsc -b`;
  - registrar los resultados de línea base en `docs/phase-5-baseline.md`.
- **Salida:** si la línea base no está en verde, se detiene el plan y se reporta.

### Oleada 1: cimientos (3 agentes en paralelo)

| Agente | Tareas | Archivos propios |
|---|---|---|
| **B1: backend-modelo** | Migración 0057, modelos, settings, `app/sync/envelope.py`, `devices.py`, `clock.py`, códigos de error, `app/api/sync/__init__.py` con sub-routers vacíos registrados en `main.py`, vectores JSON canónicos | `api/migrations/versions/0057_*`, `api/app/db/models/sync.py`, `models/__init__.py`, `settings.py`, `errors.py`, `main.py`, `app/sync/{envelope,devices,clock}.py`, `app/api/sync/*`, `docs/work-packages/contracts/F5-canonical-json-vectors.json`, tests `test_sync_models.py`, `test_migrations.py` |
| **B2: backend-refactor** | Extraer `record_check_in` a `app/attendance/service.py`; agregar `SalePolicy` a `post_cash_product_sale` (sin cambiar el comportamiento online); agregar `occurred_at` y `now` a `open_shift` y `close_shift` si hace falta | `api/app/api/member_check_ins.py`, `api/app/attendance/service.py`, `api/app/sales/queries.py`, `api/app/shifts/queries.py`, tests nuevos `test_contingency_policies.py` |
| **F1: frontend-base** | T5.1 (PWA), T5.2 (Dexie), `canonicalJson.ts`, `sequence.ts`, `capabilities.ts` | `vite.config.ts`, `main.tsx`, `tsconfig.app.json`, `package.json`, `src/test/setup.ts`, `src/offline/{db,canonicalJson,sequence,capabilities}.ts` y sus tests |

**Nota de coordinación:** F1 lee los vectores JSON canónicos que escribe B1. Para no esperar, el orquestador escribe el archivo de vectores antes de lanzar la oleada.

**Verificación V1 (agente Sonnet independiente, solo lectura y ejecución):**
- ejecuta las suites completas;
- revisa los diffs contra las secciones 1, 3.1–3.3 y 4.2–4.4;
- confirma que el refactor B2 no cambió el comportamiento (todos los tests previos en verde);
- reporta hallazgos con `archivo:línea`.

El orquestador corrige o reasigna lo que haga falta, y después hace commit con el mensaje `feat(sync): phase 5 wave 1 foundations`.

### Oleada 2: lógica de sincronización (3 agentes en paralelo)

| Agente | Tareas | Archivos propios |
|---|---|---|
| **B3: backend-ingesta** | T5.5, T5.8, T5.9: `ingest.py`, `reconcile.py`, `flags.py`, `api/sync/events.py`, `api/sync/audit.py`, `contingency_flags_count` en `shift_financial_summary` | `app/sync/{ingest,reconcile,flags}.py`, `app/api/sync/{events,audit}.py`, tests `test_sync_ingest.py`, `test_sync_reconcile.py`, `test_sync_cash_reconciliation.py`, `test_sync_ingest_postgres.py` |
| **B4: backend-bootstrap-delta** | T5.4 y T5.6: `bootstrap.py`, `roster.py`, `api/sync/bootstrap.py` (incluye `/status`), `api/sync/delta.py` | `app/sync/{bootstrap,roster}.py`, `app/api/sync/{bootstrap,delta}.py`, tests `test_sync_bootstrap.py`, `test_sync_roster_delta.py` |
| **F2: frontend-dispatcher** | T5.3 completo (dispatcher y proyecciones), `syncApi.ts`, `bootstrap.ts`, `rosterDelta.ts`, T5.7 `offlinePin.ts` con su enganche en `ProductAccessProvider` y `StaffProfileSelection` | `src/offline/{dispatcher,syncApi,bootstrap,rosterDelta,offlinePin}.ts`, `features/auth/ProductAccessProvider.tsx`, `features/staff/StaffProfileSelection.tsx` y sus tests |

**Verificación V2:**
- ejecuta las suites;
- revisa cada criterio de T5.4–T5.9 de la sección 5;
- intenta romper la idempotencia (doble envío, hash alterado, prefijo ajeno);
- comprueba que no hay PII de más en el bootstrap.

Después se hace commit con `feat(sync): contingency ingest, bootstrap, delta and offline PIN`.

### Oleada 3: experiencia offline en la UI (2 agentes en paralelo)

| Agente | Tareas | Archivos propios |
|---|---|---|
| **F3: frontend-sync-manager** | T5.10: `connectivity.ts`, `flushManager.ts`, `SyncProvider.tsx`, `OfflineStatusBadge.tsx`, montaje en `RootApp.tsx` y `ApiProductApp.tsx`, `usePwaLifecycle` | `src/offline/{connectivity,flushManager,SyncProvider,OfflineStatusBadge}.*`, `app/RootApp.tsx`, `app/ApiProductApp.tsx`, `src/shared/usePwaLifecycle.ts` |
| **F4: frontend-flujos-y-guard** | Enganches del dispatcher en `ApiReceptionHome.submit`, `ApiMembers.recordCheckIn`, búsqueda offline de socios, `ShiftOpenModal` y `ShiftCloseDialog`; T5.11 con `RequiresOnline`, `useCapability`, el wrapper de `request` y su aplicación en las pantallas de la sección 4.8 | `app/ApiReceptionHome.tsx`, `app/ApiMembers.tsx`, `features/reception/*` (solo los listados), `features/shifts/*`, `features/owner/{PlanCatalog,InventoryAnalytics}.tsx`, `src/offline/RequiresOnline.tsx`, `features/auth/` (solo el wrapper de `request`, coordinado con F2 ya fusionado) |

**Verificación V3:**
- ejecuta `vitest` completo, `tsc -b` y `npm run build`;
- revisa los criterios T5.1, T5.10 y T5.11;
- busca regresiones en los flujos online (las pruebas existentes de recepción deben seguir pasando sin cambios en sus aserciones).

Después se hace commit con `feat(offline): sync manager, status badge and online-only guard`.

### Oleada 4: certificación de la fase (1 agente de implementación y 1 verificador)
- **E2E (Sonnet):** agrega `frontend/e2e/offline-contingency.spec.ts` con Playwright (preinstalado). El backend corre con SQLite y `seed_dev.py`, y el frontend con `vite preview`. El flujo es:
  1. login online y bootstrap;
  2. `context.setOffline(true)`;
  3. check-in y venta en efectivo, verificando el folio `REC-…`;
  4. arqueo offline;
  5. confirmar que la tarjeta Point está deshabilitada;
  6. `setOffline(false)`;
  7. esperar "Sincronizado";
  8. consultar la API y verificar la orden con `origin=contingency`, el check-in y la bandera `cash_discrepancy` si se forzó una diferencia.
- **V4 (verificador final, Sonnet):**
  - corre todo: pytest, vitest, tsc, build y E2E;
  - recorre la tabla de la sección 5 y marca cada criterio con evidencia (comando y salida);
  - propone los cambios a `docs/ROADMAP.md`: marcar T5.x, corregir la redacción de T5.8 (vincular, no deduplicar) y agregar T5.12 (BK-073) y T5.13 (BK-074).
- El orquestador hace el commit final y el push.

### Plantilla de prompt para cada agente de implementación
> Contexto: repo `/home/user/EvoGym`, rama `integration/frontend-design`. Lee `docs/phase-5-local-first-plan.md` secciones 1, \<secciones relevantes\> y 5. Tu tarea es \<agente\>. **Solo puedes modificar** estos archivos: \<lista\>. Sigue Rojo → Verde → Refactor: primero escribe tests que fallen para cada criterio de aceptación de tus tareas. No hagas commit. Al terminar ejecuta \<comandos de test\> y reporta: archivos cambiados, tests agregados, salida final de los tests y cualquier desviación del plan con su justificación.

### Plantilla de prompt para cada verificador
> Solo lectura y ejecución, sin modificar archivos. Ejecuta \<comandos\>. Para cada criterio de la sección 5 de las tareas \<T5.x\>, indica PASA o FALLA con evidencia (`archivo:línea` del test o la salida). Revisa además las violaciones de las decisiones F5-D1…D10, las regresiones online, los secretos o PII en Web Storage o logs, y los archivos modificados fuera de la propiedad asignada.

---

## 8. Pendientes que no bloquean, pero quedan documentados
- **D-030** (cuota, retención, pérdida del dispositivo): se adopta fail-closed y re-bootstrap. La política formal queda para T6.3.
- **D-029** (RPO/RTO): pertenece a la Fase 6.
- **Tipos D-027 diferidos:** `membership.cash_renewal`, `member.fast_registration` y asistencia de personal offline. Requieren una ampliación de la matriz y de los payloads en una fase posterior.
- **Concurrencia real de la ingesta en PostgreSQL:** las pruebas se escriben ahora y se ejecutan en CI con T6.1.

---

## 9. Bitácora de ejecución

### Oleada 0 y Oleada 1: completadas
- **Línea base:** se registró en `docs/phase-5-baseline.md`.
- **Commits de la Oleada 1:**
  - `4047d25`: F1 (PWA, Dexie, JSON canónico, secuencia, matriz de capacidades)
  - `29f708d`: B2 (`apply_member_check_in`, `post_contingency_cash_sale`, `open_shift(now=)`)
  - `3e6dcad`: B1 (migración `0057`, modelos de sincronización, tokens de dispositivo, envelope, reloj)
  - commit de limpieza posterior a V1
- **Verificación V1:**
  - backend: 799 pasan, 44 omitidas y 1 falla preexistente;
  - frontend: 1030 de 1030;
  - `tsc` y el build: OK;
  - JSON canónico Python ↔ TypeScript: 302 payloads aleatorios sin diferencias;
  - migración `0057`: sube, baja y vuelve a subir en SQLite y en PostgreSQL 16.
- **Nombres reales de las funciones**, que difieren del plan:
  - `app/memberships/service.py::apply_member_check_in` en lugar de `record_check_in`;
  - `app/sales/queries.py::post_contingency_cash_sale` (función hermana) en lugar del parámetro `policy=`.

### Hallazgos de V1 que heredan B3 y B4 (Oleada 2)
1. **`post_contingency_cash_sale` todavía rechaza** estos casos:
   - caja inexistente o inactiva;
   - sucursal inactiva;
   - que no exista ningún turno (FirstShiftRequired);
   - socio inexistente;
   - líneas duplicadas;
   - producto inexistente;
   - total distinto de `expected_total_minor`;
   - total mayor que MAX_MINOR;
   - cancelación previa.

   Según F5-D5, B3 debe **normalizar antes de aplicar**: si el socio no existe, usar `member_id=None` con bandera; fusionar las líneas duplicadas; enviar `unit_prices` para todas las líneas y recalcular el total esperado con esos precios. Si persiste algún caso, debe agregar un modo no estricto que acepte la venta y la marque con bandera. Solo puede quedar `rejected` lo que sea de integridad.
2. **`shift_id` apuntando a un turno ya cerrado:** hoy la venta cae como overtime en silencio. B3 debe detectarlo y agregar la bandera `orphan_shift_reference`.
3. **Check-in tardío con hora anterior a la visita más antigua:** crearía una visita nueva a menos de 300 s de otra. B3 procesa los eventos de cada socio en orden de `client_recorded_at`, y además debe vincular el evento a la visita que empiece dentro de los 300 s siguientes (visita "posterior cercana").
4. **Si el periodo no existe (404)** o falta la sucursal, el evento debe salir `rejected/invalid_reference`, nunca como un 500.
5. **B3 debe validar en la ingesta** que el `payload_hash` recalculado coincida con el enviado, que el sufijo del `event_id` corresponda al `seq` (ya validado en el envelope) y que el prefijo pertenezca al dispositivo. Los saltos de `seq` están permitidos.
6. **B4:** el bootstrap siembra `next_seq = last_ingested_seq + 1`, calculado sobre todos los dispositivos históricos con ese prefijo.
