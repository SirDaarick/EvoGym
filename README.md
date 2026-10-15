# EvoGym — Frontend de Operaciones

Sistema frontend de alto rendimiento para la gestión operativa y administrativa del gimnasio **EvoGym**. Diseñado con una arquitectura moderna por capas, composición **Bento Grid**, profundidad táctil **Claymorphism** y soporte completo para modo claro y oscuro.

---

## 🚀 Tecnologías y Stack

- **Framework:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Empaquetador y Entorno:** [Vite 6](https://vite.dev/)
- **Estilos y Sistema Visual:** [Tailwind CSS v4](https://tailwindcss.com/) + CSS Tokens personalizados (EGC Brand `#FC6C06`, Claymorphism)
- **Enrutamiento:** [React Router v8](https://reactrouter.com/)
- **Tablas de Datos:** [@tanstack/react-table v8](https://tanstack.com/table) (ordenamiento, paginación, filtros)
- **Gráficas y Visualización:** [@tanstack/charts v1](https://tanstack.com/charts) (gráficas de barras, tendencias, donas polares)
- **Iconografía:** [@hugeicons/react](https://hugeicons.com/)
- **Animaciones e Interacciones:** [Motion](https://motion.dev/) & [GSAP](https://gsap.com/)
- **Testing:** [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/)

---

## 🎨 Sistema Visual y Línea de Diseño

El sistema sigue la identidad visual oficial de **EvoGym**:

- **Paleta de Marca:**
  - Naranja Oficial (**EGC Orange**): `#FC6C06`
  - Blanco Oficial (**EGC White**): `#FCFCFC`
  - Negro Marca (**Brand Black**): `#080808`
  - Gris Técnico (**Technical Gray**): `#202020`
  - Gris Secundario (**Secondary Gray**): `#555555`
- **Composición Bento:** Paneles modulares asimétricos con radio de borde de `20px` (`--radius-panel`) y organización por importancia de tarea.
- **Claymorphism:** Elevaciones táctiles con doble sombra suave y bisel interior de luz (`--shadow-clay`), diferenciado tanto en modo claro como en modo oscuro.
- **Accesibilidad y Contraste:** Botones primarios en `#FC6C06` con texto `#080808`, ofreciendo un ratio de contraste de `6.95:1` cumpliendo ampliamente con **WCAG AA**.
- **Dark Mode Completo:** Tema oscuro nativo con alternador rápido en cabecera y persistencia de preferencia.

---

## 📂 Arquitectura del Proyecto

Estructurado siguiendo principios de **Screaming / Modular Architecture**:

```
src/
├── app/                  # Shell principal, navegación lateral colapsable, enrutamiento
├── domain/               # Modelos y contratos de negocio fuertemente tipados
├── demo/                 # Adaptadores de datos de prueba y lógica desacoplada (listo para Backend)
├── features/             # Módulos por dominio de negocio
│   ├── attendance/       # Registro y calendario de asistencias con TanStack Charts
│   ├── catalog/          # Catálogo interactivo de componentes compartidos y React Bits
│   ├── inventory/        # Catálogo y control de existencias en recepción
│   ├── members/          # Directorio de socios, registro y ficha de detalle con TanStack Table
│   ├── owner/            # Portal administrativo (KPIs, historial, inventario analítico, planes)
│   ├── payments/         # Cobro de membresías y calculadora de efectivo
│   ├── reception/        # Terminal de punto de venta, carrito rápido y atajos operativos
│   ├── sales/            # Módulo de ventas y operaciones de caja
│   ├── shifts/           # Control y cierre de turnos con desglose de denominaciones MXN
│   └── staff/            # Selector de perfiles de recepción y verificación de PIN de Admin
├── shared/               # Componentes UI reutilizables (Badge, Button, Field, Notice, Panel, etc.)
└── styles.css            # Tokens de diseño, Tailwind v4 y variables CSS
```

---

## 🔑 Funcionalidades Principales

### 1. Recepción y Punto de Venta
- **Carrito Reactivo:** Selección de productos, control de cantidades con clic derecho/izquierdo, cobro en efectivo, tarjeta o transferencia.
- **Calculadora de Efectivo:** Cálculo automático de cambio e importes exactos.
- **Atajos Operativos Rápidos:** Modales para registro ágil de Gastos imprevistos, Extras, Guantes, Suplementos y Casilleros.
- **Control de Mermas:** Registro inmediato de bajas de inventario con justificación.

### 2. Administración y Control de Turnos
- **Cierre de Turnos:** Desglose interactivo por denominaciones de billetes y monedas mexicanas (MXN) o captura manual con validación de diferencias.
- **Trazabilidad y Movimientos:** Tablas construidas sobre `@tanstack/react-table` con ordenamiento por fecha y paginación.

### 3. Portal de Propietario (Owner)
- **Análisis de Inventario:** Gráficas de rotación con `@tanstack/charts` y tabla dinámica con búsqueda en tiempo real.
- **Gestión de Planes y Tarifas:** Catálogo completo para crear, editar y activar/desactivar membresías y pases por visita.
- **Historial Global:** Registro centralizado de transacciones financieras y de inventario.

### 4. Menú Lateral Ergonómico
- Barra lateral compacta por defecto (76px) para maximizar el área de trabajo.
- Expansión fluida al interactuar y colapso automático al salir el cursor, con soporte para anclaje fijo (*pinning*) y navegación accesible por teclado.

---

## 🛠️ Comandos de Desarrollo

### Instalación de dependencias
```bash
npm install
```

### Iniciar servidor de desarrollo
```bash
npm run dev
```

### Verificación de Tipos (TypeScript)
```bash
npm run typecheck
```

### Ejecución de Pruebas Unitarias y de Integración
```bash
npm test
```

### Construcción para Producción
```bash
npm run build
npm run preview
```

---

## 🔌 Preparación para Integración con Backend

El frontend mantiene todas las operaciones de datos abstraídas a través de contratos tipados en `src/domain/models.ts` y operaciones puras en `src/demo/`. Para conectar una API REST o GraphQL:
1. Reemplazar los métodos de `DemoProvider` por clientes HTTP (Axios / Fetch / TanStack Query).
2. Los modelos de datos (`Member`, `Sale`, `Shift`, `Product`, `StockMovement`) ya están normalizados y listos para mapearse contra las entidades de la base de datos.
