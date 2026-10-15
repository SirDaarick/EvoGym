export interface DemoMovement {
  id: string;
  member: string;
  kind: string;
  amountMinor: number;
  status: string;
  date: string;
}

export const demoMovements: DemoMovement[] = [
  { id: 'M-101', member: 'Mariana Solís', kind: 'Membresía · muestra', amountMinor: 89000, status: 'Ejemplo confirmado', date: '2026-10-02' },
  { id: 'M-102', member: 'Diego Ramos', kind: 'Producto · muestra', amountMinor: 13500, status: 'Ejemplo pendiente', date: '2026-10-03' },
  { id: 'M-103', member: 'Lucía Torres', kind: 'Visita · muestra', amountMinor: 6000, status: 'Ejemplo confirmado', date: '2026-10-04' },
  { id: 'M-104', member: 'Andrés Vega', kind: 'Membresía · muestra', amountMinor: 75000, status: 'Ejemplo desconocido', date: '2026-10-05' },
];

export const demoTrend = [
  { period: 'Semana 1', amount: 1080 },
  { period: 'Semana 2', amount: 1200 },
  { period: 'Semana 3', amount: 1170 },
  { period: 'Semana 4', amount: 1330 },
  { period: 'Semana 5', amount: 1280 },
  { period: 'Semana 6', amount: 1540 },
  { period: 'Semana 7', amount: 1190 },
  { period: 'Semana 8', amount: 1720 },
  { period: 'Semana 9', amount: 1440 },
  { period: 'Semana 10', amount: 1610 },
  { period: 'Semana 11', amount: 1520 },
  { period: 'Semana 12', amount: 1890 },
];

// Illustrative values support side-by-side category comparisons, not stock or sales.
export const demoCategories = [
  { category: 'Bebidas', scenarioA: 24, scenarioB: 18 },
  { category: 'Botanas', scenarioA: 14, scenarioB: 20 },
  { category: 'Accesorios', scenarioA: 9, scenarioB: 12 },
];

export const demoStock = [
  { id: 'P-01', product: 'Agua · muestra', opening: 24, received: 8, sold: 7, waste: 1, expected: 24 },
  { id: 'P-02', product: 'Barra · muestra', opening: 12, received: 6, sold: 4, waste: 0, expected: 14 },
  { id: 'P-03', product: 'Guantes · muestra', opening: 16, received: 0, sold: 0, waste: 0, expected: 16 },
];

export const workflowDemos = [
  { id: 'T01', title: 'Perfil y entrada', summary: 'Perfil de referencia; selección de vista, sin autenticación ni PIN.' },
  { id: 'T02', title: 'Perfiles de recepción', summary: 'Referencia visual de perfiles; credenciales y permisos siguen fuera de alcance.' },
  { id: 'T03', title: 'Inicio, venta y merma', summary: 'Carrito de ejemplo; no representa inventario ni cobro real.' },
  { id: 'T04', title: 'Gasto imprevisto', summary: 'Captura y revisión ilustrativas; reglas por confirmar.' },
  { id: 'T05', title: 'Cambio de recepción', summary: 'Movimiento de referencia; atribución y autorización no resueltas.' },
  { id: 'T06', title: 'Renta de guantes', summary: 'Estados visuales de préstamo y devolución, sin disponibilidad real.' },
  { id: 'T07', title: 'Porciones de suplemento', summary: 'Cantidad de muestra; unidad y conversión requieren validación.' },
  { id: 'T08', title: 'Casilleros', summary: 'Asignación ilustrativa; vigencia y estado actual no calculados.' },
  { id: 'T09', title: 'Búsqueda de socios', summary: 'Resultados de referencia, detalle y estado vacío.' },
  { id: 'T10', title: 'Alta y visita', summary: 'Formulario de muestra; no crea registros ni acceso.' },
  { id: 'T11', title: 'Perfil y asistencia', summary: 'Calendario reutilizado con visitas ilustrativas y duración desconocida.' },
  { id: 'T12', title: 'Inventario y recepción', summary: 'Stock de muestra; conteo físico y discrepancia permanecen separados.' },
  { id: 'T13', title: 'Actividad de turno', summary: 'Tabla de movimientos de referencia, no una bitácora actual.' },
  { id: 'T14', title: 'Corte y entrega', summary: 'Conteo visual; libreta obligatoria y Excel siguen siendo el maestro.' },
  { id: 'T15', title: 'Estado y alertas', summary: 'Alertas de muestra; sin indicadores de negocio inventados.' },
  { id: 'T16', title: 'Movimientos señalados', summary: 'Revisión ilustrativa; no se agrega borrar ni revertir.' },
  { id: 'T17', title: 'Reportes de gastos', summary: 'Rango y exportación visual; cifras no confirmadas.' },
  { id: 'T18', title: 'Productos y análisis', summary: 'Comparaciones de tendencia artificial; no son reporte operativo.' },
];
