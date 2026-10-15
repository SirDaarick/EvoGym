# T16 — Centro de Alertas Operativas (Operational Alert Center)

Consolida excepciones operativas críticas (descuadres de efectivo, mermas de inventario, gastos de caja y transferencias pendientes) en una sola vista para el Propietario (Owner), permitiendo auditoría inmediata y navegación directa a la fuente de cada anomalía sin métricas artificiales.

## Quick path

1. Escribir pruebas unitarias del selector puro `getOperationalAlerts` y verificar fallo RED.
2. Implementar el selector puro extrayendo alertas de turnos, inventario, gastos y ventas/pagos hasta pasar a GREEN.
3. Construir la pantalla `AlertCenter` con layout Bento, gráfico de dona TanStack Charts y tabla interactiva TanStack Table.
4. Integrar ruta `/owner/alerts` y navegación en `navigation.ts` y `App.tsx`.
5. Ejecutar suite enfocada con `npx vitest run src/demo/alertCenterSelector.test.ts src/features/owner/AlertCenter.test.tsx`.

## Details

| Área | Decisión |
|---|---|
| Fuentes de datos | Cierres de turno con descuadre (`cashDifferenceMinor !== 0`), mermas (`StockMovement.kind === 'waste'`), gastos en efectivo no planificados (`state.expenses`), transferencias bancarias pendientes (`method === 'transfer' && status === 'pending'`). |
| Filtro de periodos | Selector de 4 periodos (`Hoy`, `Semana`, `Mes`, `Todo`) con fecha de referencia vinculada al reloj demo (`demoClock`). |
| Visualización gráfica | TanStack Charts (`@tanstack/charts/react`, `@tanstack/charts/polar`) con dona proporcional por categoría y conteo central de eventos. |
| Tabla interactiva | TanStack Table (`@tanstack/react-table`) con ordenamiento por columnas, filtros por categoría (pills) y enlaces accesibles directos a cada sección (`/owner/shifts`, `/owner/inventory`, `/owner/history`). |
| Minimalismo informativo | Cero puntuaciones artificiales ni textos decorativos; KPIs directos: conteo de alertas, descuadres/gastos de caja y transferencias pendientes. |
| Tokens de diseño | Adaptación completa a temas claro y oscuro usando tokens oficiales EGC (`#FC6C06`, `#202020`, `#FCFCFC`, clay depth). |

## Checklist

- [x] **S01 — Selector Test-First (RED)**: Pruebas unitarias en `src/demo/alertCenterSelector.test.ts` cubriendo extracción de descuadres, mermas, gastos, transferencias pendientes, períodos temporales y cálculo de KPIs. Verificado fallo inicial RED (`Failed to resolve import "./alertCenterSelector"`).
- [x] **S02 — Implementación del Selector (GREEN)**: Módulo `src/demo/alertCenterSelector.ts` que implementa la extracción de anomalías, cálculo de métricas financieras e impacto por categoría. Verificado GREEN con 8/8 pruebas pasando.
- [x] **S03 — Componente AlertCenter & Estilos**: Pantalla `src/features/owner/AlertCenter.tsx` y `AlertCenter.css` con layout Bento, 3 paneles KPI, dona TanStack Charts, tabla TanStack Table con enlaces de acción (`/owner/shifts`, `/owner/inventory`, `/owner/history`) y estados vacíos.
- [x] **S04 — Integración de Navegación y Rutas**: Actualización de `src/app/navigation.ts` agregando `alerts` a las rutas de `OWNER`, e integración de ruta `/owner/alerts` e ícono SVG en `src/app/App.tsx`.
- [x] **S05 — Verificación y Pruebas de Integración**: Pruebas en `src/features/owner/AlertCenter.test.tsx` verificando renderizado de KPIs, selector de período, filtros de categoría y navegación protegida (redirección para RECEPTION). Suite enfocada pasa 2 archivos y 15 pruebas.

## Verification Evidence

Comando enfocado ejecutado:
```bash
npx vitest run src/demo/alertCenterSelector.test.ts src/features/owner/AlertCenter.test.tsx
```

Resultado observado:
- `src/demo/alertCenterSelector.test.ts` (8 pruebas): PASSED
- `src/features/owner/AlertCenter.test.tsx` (7 pruebas): PASSED
- Total: 2 archivos pasados, 15 pruebas pasadas (0 fallos).

## Next step

Entrega y notificación al llamador (parent agent `e9964b92-9901-443d-8363-f9ee97527be1`).
