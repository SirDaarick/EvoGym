# EvoGym — Plataforma Integral de Operaciones para Gimnasio

Repositorio oficial del sistema integral de gestión y operaciones para **EvoGym**.

**Estado al 2026-10-22, entrega local:** las correcciones acotadas de CORS/recepción, compilación, errores públicos, tres resolutores de autenticación y validación de socios tienen commits locales y verificaciones enfocadas. En el prefijo limpio R5: **335 pruebas API aprobadas, 17 omitidas de PostgreSQL; frontend completo: 2 fallidas y 471 aprobadas**. Tipos y build/PWA pasaron, pero el resultado frontend sigue siendo parcial: un fallo de teclado reproduce en la base y otro timeout no se reprodujo de forma enfocada. Los anteriores 367/578 aprobados pertenecen a otro snapshot con trabajo sin incorporar. La [auditoría](docs/backend-audit/README.md) documenta límites; no es un backend completo ni certificación de producción.

---

## 🏗️ Estructura del Repositorio

El proyecto está organizado en una arquitectura monorepo modular:

```text
EvoGym/
├── frontend/               # Aplicación cliente en React 19 + TypeScript + Vite
│   ├── src/                # Código fuente estructurado por features y dominio
│   └── README.md           # Documentación específica del frontend
├── api/                    # Servicio FastAPI, SQLAlchemy, pruebas y migraciones Alembic
│   └── README.md           # Desarrollo local y límites del servicio
├── backend/                # Workspace local de notebooks y datos privados; no es la API
├── docs/                   # Especificación técnica y diseño de datos
│   ├── database-map.md     # Mapeo relacional de base de datos detallado
│   └── er-diagram.md       # Diagrama Entidad-Relación (ER) modular por Bounded Contexts
├── Design.md               # Especificación del sistema de diseño visual (Bento, Claymorphism)
└── odd/                    # Tareas, planes de trabajo y especificaciones ODD
```

---

## 🧠 Decisiones de Negocio y Arquitectura Confirmadas

El diseño del sistema y el modelo de datos están alineados con las reglas operativas reales del gimnasio:

### 1. Control de Turnos y Caja Chica
- **Apertura de Turno con Stepper (`ShiftOpenModal`):** La apertura no es automática por PIN. Requiere un flujo guiado en 3 pasos:
  1. Conteo de efectivo inicial desglosado por denominaciones de billetes y monedas (`opening_cash_minor`).
  2. Verificación y ajuste de inventario inicial (mermas/diferencias).
  3. Resumen y confirmación de apertura de caja.
- **Ventas en Transición / Overtime:** Ventas cobradas fuera del horario o en cambio de turno se vinculan al turno entrante pero quedan marcadas con la bandera `is_overtime: true` para auditoría contable.

### 2. Seguridad, Kiosko y Vinculación Móvil (Device Pairing)
- **Kiosko de Mostrador (PC de Recepción):** La computadora del gimnasio mantiene la sesión de sucursal abierta, permitiendo a los recepcionistas ingresar rápidamente con su **PIN de 4 dígitos** sin necesidad de memorizar contraseñas largas.
- **Acceso Dueño / Admin:** Siempre requiere credenciales completas (`email` + `password_hash` seguro con Argon2id/bcrypt).
- **Vinculación de Celulares de Empleados (`staff_device_pairings`):** El Administrador genera un código temporal de 6 dígitos (válido por 10 minutos). El empleado lo ingresa en `/pair` en su teléfono para enrolar su dispositivo sin contraseñas. El Admin puede revocar el acceso con un clic en cualquier momento.

### 3. Asistencia Laboral de Personal (`staff_attendance_logs`)
- **Desacoplamiento total de socios:** Se eliminó el antipatrón de registrar empleados como "socios falsos".
- La recepcionista en turno pasa lista desde su panel de personal (`recorded_by`), registrando hora de entrada (`clock_in_at`), salida (`clock_out_at`) y notas opcionales.

### 4. Pagos con Tarjeta y Terminal Mercado Pago Point
- **Catálogo de Terminales (`payment_terminals`):** Las terminales físicas Point están desacopladas de las cajas. Permite operar 1 terminal hoy, y agregar terminales o nuevas sucursales en el futuro sin cambios de código.
- **Trazabilidad Bancaria:** En `payments` se auditan folio de intención (`external_intent_id`), número de autorización (`authorization_code`), últimos 4 dígitos (`card_last_digits`), marca de tarjeta y comisión retenida (`fee_minor`).

### 5. Asistente Inteligente (Gimi Chatbot) y Notificaciones
- **RAG Nativo en PostgreSQL con `pgvector`:** El conocimiento de Gimi (`gimi_knowledge_chunks`) almacena vectores con índice **HNSW** en la misma base de datos relacional, evitando la complejidad y costo de bases vectoriales externas.
- **Identidad Unificada:** El bot empareja el número de WhatsApp con `members.phone` para conocer la membresía y adeudos del cliente al instante.
- **Bitácora Saliente (`notification_logs`):** Previene envíos duplicados de recordatorios de cobro y comprobantes de pago.

### 6. Control de Fiado / Crédito y Alcance Acotado
- **Política de Crédito:** no se infiere autorización de crédito automática. El pago parcial en efectivo ya aprobado puede mantener acceso durante la vigencia con advertencia de saldo; restricciones por revisión de fondos y decisiones administrativas tienen reglas específicas. La política restante se rige por D-013 en el [registro de decisiones](docs/backend-plan/02-business-rules-and-decisions.md), no por un bloqueo general de toda deuda.
- **Fuera de Alcance Confirmado:** Torniquetes/hardware RFID y congelamiento/pausa de membresías no forman parte del sistema (la recepción es manual y la vigencia corre continuo).

---

## 🌐 Estrategia de Entornos (QA vs. Producción)

Para garantizar la integridad financiera y operativa, el sistema opera con dos entornos completamente aislados:

| Entorno | Base de Datos | Mercado Pago | WhatsApp / Notificaciones | Propósito |
|---|---|---|---|---|
| **QA / Staging** | PostgreSQL Staging (datos seed/prueba) | Modo Sandbox (tarjetas de prueba) | Número de prueba / Sandbox | Pruebas de integración, simulación de cortes y validación de features sin impacto real. |
| **Producción** | PostgreSQL Prod (alta disponibilidad) | Modo Live (cobros reales) | Línea oficial de EvoGym | Operación real diaria en el gimnasio. |

---

## 📚 Documentación Técnica Detallada

- [Auditoría del backend](docs/backend-audit/README.md): estado observado, resultados y límites de verificación.
- [Hallazgos y pasos de corrección](docs/backend-audit/findings.md), [brechas del frontend](docs/backend-audit/frontend-contract-gaps.md) y [ruta de finalización](docs/backend-audit/roadmap.md).
- [Índice del plan backend](docs/backend-plan/README.md): decisiones de negocio y documentación histórica.
- [API](api/README.md): configuración y ejecución local; no trasladar datos privados al servicio.
- [docs/database-map.md](docs/database-map.md): Mapeo completo de tablas, campos, tipos minor/bigint, convenciones y restricciones.
- [docs/er-diagram.md](docs/er-diagram.md): Diagrama Entidad-Relación modular por Bounded Contexts con diagramas interactivos Mermaid.
- [Design.md](Design.md): Guía de estilo visual y componentes UI.

---

## ⚡ Inicio Rápido (Frontend)

Para ejecutar el frontend en modo de desarrollo:

```bash
cd frontend
npm install
npm run dev
```

### Comandos de Calidad:

```bash
cd frontend
npm run typecheck    # Verificación de tipos con TypeScript
npm run test         # Ejecución de suite de pruebas con Vitest
npm run build        # Compilación de producción con Vite
```

---

## 🚀 Próximo paso del backend

Documentar y resolver los dos resultados pendientes de la suite frontend sin debilitar sus pruebas; después, integrar lecturas autorizadas de historial/adeudos y errores tipados, u obtener prueba PostgreSQL aislada cuando se autorice. CORS y la aceptación de compilación ya están corregidos. La estrategia local `auto-chain` / `feature-branch-chain` está aprobada y seis commits de código existen; D1–D3 de documentación y sus recibos siguen pendientes. No hay PR, push ni publicación autorizados. La [ruta detallada](docs/backend-audit/roadmap.md) conserva horarios, sincronización, dominios y preparación de producción como trabajo restante.
