# EvoGym — Plataforma Integral de Operaciones para Gimnasio

Repositorio oficial del sistema integral de gestión y operaciones para **EvoGym**.

---

## 🏗️ Estructura del Repositorio

El proyecto está organizado en una arquitectura monorepo modular:

```
EvoGym/
├── frontend/               # Aplicación cliente en React 19 + TypeScript + Vite
│   ├── src/                # Código fuente estructurado por features y dominio
│   ├── index.html          # Punto de entrada HTML
│   ├── package.json        # Dependencias y scripts de frontend
│   ├── tsconfig*.json      # Configuración de compilador TypeScript
│   ├── vite.config.ts      # Configuración de Vite y Tailwind
│   └── README.md           # Documentación específica del frontend
├── backend/                # [Próximamente] Servicio API y persistencia en base de datos
├── Design.md               # Especificación del sistema de diseño visual (Bento, Claymorphism)
└── odd/                    # Tareas, planes arquitectónicos y prototipos
```

---

## ⚡ Inicio Rápido (Frontend)

Para ejecutar el frontend en modo de desarrollo:

```bash
cd frontend
npm install
npm run dev
```

### Comandos Principales de Calidad:

```bash
cd frontend
npm run typecheck    # Verificación de tipos con TypeScript
npm run test         # Ejecución de suite de pruebas con Vitest
npm run build        # Compilación de producción con Vite
```

Consulta [`frontend/README.md`](frontend/README.md) para más detalles técnicos sobre el stack de cliente, tokens de diseño y catálogo de componentes.
