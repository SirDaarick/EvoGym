import { Chart } from '@tanstack/charts/react';
import { barY, defineChart, lineY } from '@tanstack/charts';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { demoTrend } from './catalog-data';

export function CatalogCharts({ weeks }: { weeks: 4 | 12 }) {
  const rows = demoTrend.slice(-weeks);
  const trendChart = defineChart({
    marks: [lineY(rows, { x: 'period', y: 'amount' })],
    scales: {
      x: { scale: scalePoint, axis: { label: 'Periodo de muestra' } },
      y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'Miles de pesos demo' } },
    },
  });
  const comparisonChart = defineChart({
    marks: [barY(rows, { x: 'period', y: 'amount', inset: 4 })],
    scales: {
      x: { scale: () => scaleBand().padding(0.2) },
      y: { scale: scaleLinear, nice: true, grid: true },
    },
  });

  return <div className="catalog-chart-grid">
    <section className="catalog-chart chart-card" aria-labelledby="trend-title">
      <h3 id="trend-title">Tendencia de ingresos ficticios</h3>
      <p className="muted">Miles de pesos por semana · datos artificiales para revisar el componente.</p>
      <Chart definition={trendChart} height={240} ariaLabel="Tendencia de ingresos de muestra" ariaDescription="Tendencia ficticia, no corresponde a ingresos reales." />
      <table aria-label="Datos de tendencia de ejemplo"><caption>Valores de tendencia ficticia · {weeks} semanas demo (MXN)</caption><thead><tr><th scope="col">Periodo</th><th scope="col">Monto</th></tr></thead><tbody>{rows.map(item => <tr key={item.period}><td>{item.period}</td><td>${item.amount.toLocaleString('es-MX')},000</td></tr>)}</tbody></table>
    </section>
    <section className="catalog-chart chart-card" aria-labelledby="comparison-title">
      <h3 id="comparison-title">Comparación por periodo</h3>
      <p className="muted">Barras con línea base común; no es un reporte operativo.</p>
      <Chart definition={comparisonChart} height={240} ariaLabel="Comparación de ingresos por periodo" ariaDescription="Comparación de cantidades ficticias en miles de pesos." />
      <ul className="chart-legend" aria-label="Valores de comparación">{rows.map(item => <li key={item.period}>{item.period}: ${item.amount.toLocaleString('es-MX')},000 MXN demo</li>)}</ul>
    </section>
  </div>;
}
