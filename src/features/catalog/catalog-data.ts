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

export const demoStock = [
  { id: 'P-01', product: 'Agua · muestra', opening: 24, received: 8, sold: 7, waste: 1, expected: 24 },
  { id: 'P-02', product: 'Barra · muestra', opening: 12, received: 6, sold: 4, waste: 0, expected: 14 },
  { id: 'P-03', product: 'Guantes · muestra', opening: 16, received: 0, sold: 0, waste: 0, expected: 16 },
];
