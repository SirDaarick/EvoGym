import { Chart } from '@tanstack/charts/react';
import { barY, defineChart, group, lineY } from '@tanstack/charts';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { scalePoint } from '@tanstack/charts/scales/point';
import { demoCategories, demoTrend } from './catalog-data';

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
  const categoryRows = demoCategories.flatMap(row => [
    { category: row.category, scenario: 'Escenario A', units: row.scenarioA },
    { category: row.category, scenario: 'Escenario B', units: row.scenarioB },
  ]);
  const categoryChart = defineChart({
    marks: [barY(categoryRows, { x: 'category', y: 'units', z: 'scenario', fill: datum => datum.scenario === 'Escenario A' ? 'var(--ts-chart-1)' : 'var(--ts-chart-2)', layout: group({ padding: 0.1 }), inset: 2 })],
    scales: {
      x: { scale: () => scaleBand().padding(0.2) },
      y: { scale: scaleLinear, nice: true, grid: true, axis: { label: 'Unidades ficticias' } },
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
    <section className="catalog-chart chart-card catalog-chart-wide" aria-labelledby="category-title">
      <h3 id="category-title">Comparación de categorías ficticias</h3>
      <p className="muted">Dos escenarios artificiales por categoría; no representan inventario ni ventas reales.</p>
      <Chart definition={categoryChart} height={260} ariaLabel="Comparación de categorías ficticias" ariaDescription="Barras agrupadas por categoría para comparar dos escenarios artificiales. La tabla siguiente contiene todos los valores exactos." />
      <ul className="chart-legend chart-series-legend" aria-label="Escenarios de categorías ficticias">
        <li><span className="chart-series-swatch" data-series="scenario-a" style={{ backgroundColor: 'var(--ts-chart-1)' }} aria-hidden="true" />Escenario A</li>
        <li><span className="chart-series-swatch" data-series="scenario-b" style={{ backgroundColor: 'var(--ts-chart-2)' }} aria-hidden="true" />Escenario B</li>
      </ul>
      <table aria-label="Valores exactos de categorías ficticias">
        <caption>Unidades ficticias por categoría y escenario</caption>
        <thead><tr><th scope="col">Categoría</th><th scope="col">Escenario A</th><th scope="col">Escenario B</th></tr></thead>
        <tbody>{demoCategories.map(row => <tr key={row.category}><th scope="row">{row.category}</th><td>{row.scenarioA}</td><td>{row.scenarioB}</td></tr>)}</tbody>
      </table>
    </section>
  </div>;
}
