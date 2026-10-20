# EvoGym — Plataforma Integral de Operaciones para Gimnasio

Repositorio oficial del sistema integral de gestión y operaciones para **EvoGym**.

---

## 🏗️ Estructura del Repositorio

El proyecto está organizado en una arquitectura monorepo modular:

```text
EvoGym/
├── frontend/               # Aplicación cliente en React 19 + TypeScript + Vite
│   ├── src/                # Código fuente estructurado por features y dominio
│   └── README.md           # Documentación específica del frontend
├── backend/                # Servicio API, persistencia PostgreSQL y scripts de migración
│   └── README.md           # Entorno de notebooks para análisis de datos migrados
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
- **Política de Crédito:** `credit_limit_minor` tiene valor por defecto `0`. Si el límite es 0, no se permite fiado. Si el socio tiene saldo deudor, el check-in en recepción queda bloqueado hasta saldar.
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

## 🚀 Próximos Pasos: Desarrollo del Backend

1. **Definición de Stack Backend:** Selección de framework/runtime (Node.js/TypeScript o Python) y ORM/Query Builder (Drizzle / Prisma / SQLAlchemy).
2. **Migraciones DDL:** Creación de scripts SQL en PostgreSQL con extensión `pgvector`.
3. **Migración de Datos Históricos:** Scripts para cargar los 4,337 socios y 17,776 membresías históricas desde los archivos de `backend/`.
4. **Endpoints de la API:** Rutas REST / tRPC organizadas por los mismos Bounded Contexts del frontend.
