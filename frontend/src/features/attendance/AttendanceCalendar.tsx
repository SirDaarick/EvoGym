import { useMemo, useRef, useState } from 'react';
import { defineChart, rect } from '@tanstack/charts';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { Chart } from '@tanstack/charts/react';
import type { AttendanceVisit } from '../../domain/models';
import { attendanceDay, attendanceDuration } from '../../demo/attendanceOperations';

import { useIsDarkMode } from '../../shared/theme';

export type HeatCell = { date: string; x0: number; x1: number; y0: number; y1: number; count: number; minutes: number; unknown: number; level: number; future: boolean };
const COLORS_LIGHT = ['#f4f4f5', '#fed7aa', '#fb923c', '#c2410c'];
const COLORS_DARK = ['#262626', '#7c2d12', '#ea580c', '#fb923c'];

const dayDateFormatter = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDayDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dayDateFormatter.format(date);
  } catch {
    return dateStr;
  }
}

export function buildAttendanceYearCells(year: number, visits: AttendanceVisit[], now: string): HeatCell[] {
  const start = new Date(`${year}-01-01T12:00:00Z`);
  const end = new Date(`${year}-12-31T12:00:00Z`);
  const today = attendanceDay(now) ?? now.slice(0, 10);
  const count = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const offset = (start.getUTCDay() + 6) % 7;
  const totalsByDay = new Map<string, { count: number; minutes: number; unknown: number }>();
  for (const visit of visits) {
    const day = attendanceDay(visit.observedCheckIn);
    if (day === null) continue;
    const total = totalsByDay.get(day) ?? { count: 0, minutes: 0, unknown: 0 };
    const duration = attendanceDuration(visit);
    total.count += 1;
    total.minutes += duration ?? 0;
    total.unknown += duration === null ? 1 : 0;
    totalsByDay.set(day, total);
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
    const { count: visitsOnDay, minutes, unknown } = totalsByDay.get(date) ?? { count: 0, minutes: 0, unknown: 0 };
    const weekday = (offset + index) % 7;
    return { date, x0: Math.floor((offset + index) / 7), x1: Math.floor((offset + index) / 7) + 1,
      // The chart y scale maps zero to the bottom, so invert rows to put Monday at the top.
      y0: 6 - weekday, y1: 7 - weekday, count: visitsOnDay, minutes, unknown,
      level: minutes === 0 ? 0 : minutes <= 60 ? 1 : minutes <= 120 ? 2 : 3, future: date > today };
  });
}

export function AttendanceCalendar({ visits, now, label = 'Frecuencia de asistencia', showIllustrativeDisclaimer = true }: { visits: AttendanceVisit[]; now: string; label?: string; showIllustrativeDisclaimer?: boolean }) {
  const isDark = useIsDarkMode();
  const colors = isDark ? COLORS_DARK : COLORS_LIGHT;
  const unknownStroke = isDark ? '#fb923c' : '#c2410c';
  const initialYear = Number(attendanceDay(now)?.slice(0, 4) ?? new Date().getFullYear());
  const [year, setYear] = useState(initialYear);
  const [selected, setSelected] = useState('');
  const [hoveredDay, setHoveredDay] = useState<{
    date: string;
    count: number;
    minutes: number;
    unknown: number;
    x: number;
    y: number;
  } | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const lastDateRef = useRef<string | null>(null);

  const cells = useMemo(() => buildAttendanceYearCells(year, visits, now), [year, visits, now]);
  const weeks = Math.ceil(((new Date(`${year}-01-01T12:00:00Z`).getUTCDay() + 6) % 7 + cells.length) / 7);
  const chartWidth = Math.max(weeks * 15, 720);

  const chart = useMemo(() => defineChart({ marks: [
    ...colors.map((color, level) => rect(cells.filter(cell => !cell.future && cell.level === level), { x1: 'x0', x2: 'x1', y1: 'y0', y2: 'y1', fill: color, inset: 2, radius: 2 })),
    rect(cells.filter(cell => !cell.future && cell.unknown > 0), { id: 'unknown-duration-outline', x1: 'x0', x2: 'x1', y1: 'y0', y2: 'y1', fill: 'none', stroke: unknownStroke, strokeWidth: 1.4, inset: 1, radius: 2 }),
  ], scales: { x: { scale: scaleLinear().domain([0, weeks]) }, y: { scale: scaleLinear().domain([0, 7]) } } }), [cells, weeks, colors, unknownStroke]);

  const chartElement = useMemo(() => (
    <Chart definition={chart} ariaLabel={`Mapa de calor de asistencia ${year}`} width={chartWidth} height={142} />
  ), [chart, chartWidth, year]);

  const visitsInYear = cells.reduce((sum, cell) => sum + cell.count, 0);
  const today = attendanceDay(now) ?? now.slice(0, 10);
  const start30 = new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const daysIn30 = visits.filter(visit => { const day = attendanceDay(visit.observedCheckIn); return day !== null && day >= start30 && day <= today; }).length;
  const totalVisits = visits.length;
  const visibleCells: (HeatCell | null)[] = useMemo(() => [
    ...Array.from({ length: (new Date(`${year}-01-01T12:00:00Z`).getUTCDay() + 6) % 7 }, () => null),
    ...cells
  ], [year, cells]);
  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('es-MX', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)))), [year]);

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!chartWrapperRef.current) return;
    const rect = chartWrapperRef.current.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    if (offsetX < 0 || offsetX > chartWidth || offsetY < 0 || offsetY > 142) {
      if (lastDateRef.current !== null) {
        lastDateRef.current = null;
        setHoveredDay(null);
      }
      return;
    }
    const week = Math.floor((offsetX / chartWidth) * weeks);
    const row = Math.floor((offsetY / 142) * 7);
    const cell = cells.find(c => c.x0 === week && (6 - c.y0) === row);
    if (cell && !cell.future) {
      const tooltipX = Math.min(Math.max(offsetX, 70), chartWidth - 90);
      const tooltipY = Math.max(offsetY - 54, 4);

      if (lastDateRef.current !== cell.date) {
        lastDateRef.current = cell.date;
        setHoveredDay({
          date: cell.date,
          count: cell.count,
          minutes: cell.minutes,
          unknown: cell.unknown,
          x: tooltipX,
          y: tooltipY,
        });
        const formatted = formatDayDate(cell.date);
        setSelected(`${formatted}: ${cell.count} ${cell.count === 1 ? 'visita' : 'visitas'}, ${cell.minutes} min medidos${cell.unknown ? `, ${cell.unknown} duración desconocida` : ''}`);
      } else if (tooltipRef.current) {
        tooltipRef.current.style.left = `${tooltipX}px`;
        tooltipRef.current.style.top = `${tooltipY}px`;
      }
    } else if (lastDateRef.current !== null) {
      lastDateRef.current = null;
      setHoveredDay(null);
    }
  }

  function handlePointerLeave() {
    lastDateRef.current = null;
    setHoveredDay(null);
  }

  const srOnlyButtons = useMemo(() => (
    <div className="sr-only" role="group" aria-label="Visitas diarias del año">
      {visibleCells.map((cell, index) => cell ? (
        <button
          type="button"
          key={cell.date}
          disabled={cell.future}
          aria-label={`${cell.date}: ${cell.count} visitas, ${cell.minutes} min medidos, ${cell.unknown} duración desconocida`}
          title={`${cell.date}: ${cell.count} visitas, ${cell.minutes} min medidos`}
          onFocus={() => setSelected(`${cell.date}: ${cell.count} visitas, ${cell.minutes} min medidos`)}
          onClick={() => setSelected(`${cell.date}: ${cell.count} visitas, ${cell.minutes} min medidos`)}
        />
      ) : <span key={`empty-${index}`} />)}
    </div>
  ), [visibleCells]);

  return <section className="attendance-calendar" aria-label={label}>
    <div className="attendance-heading"><h2>Frecuencia de asistencia</h2><div className="attendance-kpis"><span><strong>{totalVisits}</strong> visitas totales</span><span><strong>{daysIn30}</strong> visitas últimos 30 días</span></div></div>
    <div className="attendance-year-control"><button type="button" aria-label="Año anterior" onClick={() => setYear(value => value - 1)}>‹</button><strong>{year}</strong><button type="button" aria-label="Año siguiente" disabled={year >= initialYear} onClick={() => setYear(value => Math.min(initialYear, value + 1))}>›</button></div>
    <div className="attendance-heatmap-scroll">
      <div className="attendance-month-labels" aria-hidden="true">{monthLabels.map((month, index) => <span key={index}>{month}</span>)}</div>
      <div
        ref={chartWrapperRef}
        className="attendance-chart-wrapper"
        role="img"
        aria-label={`Mapa anual de asistencia ${year}; ${visitsInYear} visitas. Los tonos naranjas indican duración medida.`}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
      >
        {chartElement}
        {hoveredDay && (
          <div
            ref={tooltipRef}
            className="attendance-hover-tooltip"
            style={{
              left: `${hoveredDay.x}px`,
              top: `${hoveredDay.y}px`,
            }}
          >
            <div className="attendance-tooltip-title">{formatDayDate(hoveredDay.date)}</div>
            <div className="attendance-tooltip-desc">
              {hoveredDay.count === 0 ? 'Sin asistencia registrada' : `${hoveredDay.count} ${hoveredDay.count === 1 ? 'visita' : 'visitas'} · ${hoveredDay.minutes} min`}
            </div>
          </div>
        )}
      </div>
    </div>
    {srOnlyButtons}
    <p role="status" aria-label="Detalle del día" className="sr-only">{selected || 'Selecciona un día para ver su detalle.'}</p>
  </section>;
}
