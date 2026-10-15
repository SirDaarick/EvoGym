import { useMemo, useState } from 'react';
import { barY, defineChart } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlarmClockIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  BarChartIcon,
  BulbIcon,
  Calendar01Icon,
  Clock01Icon,
  InformationCircleIcon,
  Search01Icon,
  SparklesIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';

import { useDemo } from '../../demo/DemoProvider';
import {
  getAttendanceAnalytics,
  type AttendancePeriod,
  type DayOfWeekTrafficBin,
  type HourlyTrafficBin,
  type LiveOccupant,
} from '../../demo/attendanceAnalyticsSelector';
import { Badge, EmptyState, PageHeader, Panel, TableRegion } from '../../shared/ui';
import './AttendanceAnalytics.css';

const PERIOD_OPTIONS: { id: AttendancePeriod; label: string; ariaLabel: string }[] = [
  { id: 'today', label: 'Hoy', ariaLabel: 'Filtrar hoy' },
  { id: 'week', label: 'Últimos 7 días', ariaLabel: 'Filtrar últimos 7 días' },
  { id: 'month', label: 'Últimos 30 días', ariaLabel: 'Filtrar últimos 30 días' },
];

export function AttendanceAnalytics() {
  const { state } = useDemo();
  const [period, setPeriod] = useState<AttendancePeriod>('week');
  const [searchOccupant, setSearchOccupant] = useState('');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'elapsedMinutes', desc: true },
  ]);

  // Compute analytics using pure selector
  const analytics = useMemo(() => {
    return getAttendanceAnalytics(state.attendance, state.members, state.demoClock, period);
  }, [state.attendance, state.members, state.demoClock, period]);

  // Chart 1: Hourly Traffic (06:00 - 22:00, 16 operating hours)
  // Highlights peak hour in brand orange (#FC6C06) and valley in sky blue (#0284C7)
  const hourlyChart = useMemo(() => {
    if (!analytics.hourlyBins.length) return null;
    return defineChart({
      marks: [
        barY(analytics.hourlyBins, {
          x: 'hourLabel',
          y: 'visits',
          fill: (d: HourlyTrafficBin) =>
            d.isPeak ? '#FC6C06' : d.isValley ? '#0284C7' : '#2455A4',
          radius: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand().padding(0.22),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            label: 'Visitas',
            ticks: { format: (val: number) => `${Math.round(val)}` },
          },
        },
      },
      tooltip,
      keyboard: true,
    });
  }, [analytics.hourlyBins]);

  // Chart 2: Day of Week Traffic (Lunes a Domingo)
  // Highlights busiest day in brand orange (#FC6C06)
  const dayOfWeekChart = useMemo(() => {
    if (!analytics.dayOfWeekBins.length) return null;
    return defineChart({
      marks: [
        barY(analytics.dayOfWeekBins, {
          x: 'dayName',
          y: 'visits',
          fill: (d: DayOfWeekTrafficBin) => (d.isBusiest ? '#FC6C06' : '#2455A4'),
          radius: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand().padding(0.28),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: {
            label: 'Visitas',
            ticks: { format: (val: number) => `${Math.round(val)}` },
          },
        },
      },
      tooltip,
      keyboard: true,
    });
  }, [analytics.dayOfWeekBins]);

  // Filter live occupants table by search query
  const filteredOccupants = useMemo(() => {
    const q = searchOccupant.trim().toLowerCase();
    if (!q) return analytics.liveOccupants;
    return analytics.liveOccupants.filter(
      item =>
        item.memberName.toLowerCase().includes(q) ||
        item.planName.toLowerCase().includes(q)
    );
  }, [analytics.liveOccupants, searchOccupant]);

  // TanStack Table columns for Live Occupants
  const columns = useMemo<ColumnDef<LiveOccupant>[]>(
    () => [
      {
        accessorKey: 'memberName',
        header: ({ column }) => (
          <button
            type="button"
            className="att-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Socio en sala {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div className="att-occupant-name-cell">
            <span className="att-avatar-badge" aria-hidden="true">
              {row.original.memberName.slice(0, 2).toUpperCase()}
            </span>
            <div className="att-occupant-meta">
              <span className="att-occupant-name">{row.original.memberName}</span>
              <span className="att-occupant-id">ID: {row.original.memberId}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'planName',
        header: ({ column }) => (
          <button
            type="button"
            className="att-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Membresía {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <Badge tone="neutral">
            {row.original.planName}
          </Badge>
        ),
      },
      {
        accessorKey: 'checkInTime',
        header: ({ column }) => (
          <button
            type="button"
            className="att-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Hora de entrada {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <span className="att-checkin-time">{row.original.checkInFormatted}</span>
        ),
      },
      {
        accessorKey: 'elapsedMinutes',
        header: ({ column }) => (
          <button
            type="button"
            className="att-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Tiempo en sala {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => {
          const mins = row.original.elapsedMinutes;
          const isLongWorkout = mins >= 90;
          return (
            <div className="att-elapsed-cell">
              <span className={`att-elapsed-mins ${isLongWorkout ? 'long-workout' : ''}`}>
                {mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
              </span>
              {isLongWorkout && <span className="att-long-badge" title="Más de 90 min en sala">+90 min</span>}
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Estado',
        cell: () => (
          <span className="att-live-status-pill">
            <span className="att-live-dot" aria-hidden="true" />
            En entrenamiento
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredOccupants,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="attendance-analytics-page">
      <PageHeader
        eyebrow="PROPIETARIO · AFLUENCIA Y AFORO"
        title="Afluencia y capacidad del gimnasio"
        description="Monitoreo de ocupación en tiempo real, horas pico y patrones semanales de tráfico."
      />

      {/* Period Filter Bar */}
      <div className="att-period-bar clay-card">
        <div className="att-period-info">
          <HugeiconsIcon icon={Calendar01Icon} size={18} className="att-period-icon" aria-hidden="true" />
          <span className="att-period-label">Período de análisis:</span>
        </div>
        <div className="att-period-pills" role="group" aria-label="Seleccionar período de análisis">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`att-period-pill ${period === opt.id ? 'active' : ''}`}
              aria-pressed={period === opt.id}
              aria-label={opt.ariaLabel}
              onClick={() => setPeriod(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bento KPI Grid (6 Claymorphism Cards) */}
      <section className="att-bento-grid" aria-label="Indicadores clave de afluencia">
        {/* Card 1: Live Occupancy vs Capacity 50 */}
        <article className="att-kpi-card clay-card att-kpi-highlight">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Ocupación en vivo</span>
            <span className="att-pulse-wrapper">
              <span className="att-pulse-dot" aria-hidden="true" />
              <Badge tone={analytics.liveOccupancyPercent >= 75 ? 'warning' : 'success'}>
                {analytics.liveOccupancyPercent}% aforo
              </Badge>
            </span>
          </div>
          <div className="att-kpi-body">
            <div className="att-kpi-main-stat">
              <span className="att-kpi-value">{analytics.liveOccupancyCount}</span>
              <span className="att-kpi-denominator">/ {analytics.gymCapacity} socios</span>
            </div>
            <div className="att-capacity-bar-track" aria-hidden="true">
              <div
                className="att-capacity-bar-fill"
                style={{ width: `${Math.min(100, analytics.liveOccupancyPercent)}%` }}
              />
            </div>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={UserGroupIcon} size={16} aria-hidden="true" />
            <span>Capacidad máxima: {analytics.gymCapacity} personas</span>
          </div>
        </article>

        {/* Card 2: Peak Hour */}
        <article className="att-kpi-card clay-card">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Hora pico</span>
            <span className="att-stat-badge peak">
              <HugeiconsIcon icon={ArrowUp01Icon} size={14} aria-hidden="true" />
              Pico
            </span>
          </div>
          <div className="att-kpi-body">
            <p className="att-kpi-value text-accent">{analytics.peakHour.label}</p>
            <p className="att-kpi-subtext">
              {analytics.peakHour.visits} visitas registradas ({analytics.peakHour.occupancyPercent}% aforo)
            </p>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={Clock01Icon} size={16} aria-hidden="true" />
            <span>Turno Nocturno habitual</span>
          </div>
        </article>

        {/* Card 3: Valley Hour */}
        <article className="att-kpi-card clay-card">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Hora valle</span>
            <span className="att-stat-badge valley">
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden="true" />
              Valle
            </span>
          </div>
          <div className="att-kpi-body">
            <p className="att-kpi-value text-sky">{analytics.valleyHour.label}</p>
            <p className="att-kpi-subtext">
              {analytics.valleyHour.visits} visitas ({analytics.valleyHour.occupancyPercent}% aforo)
            </p>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={SparklesIcon} size={16} aria-hidden="true" />
            <span>Oportunidad off-peak</span>
          </div>
        </article>

        {/* Card 4: Busiest Day */}
        <article className="att-kpi-card clay-card">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Día más concurrido</span>
            <Badge tone="neutral">{analytics.busiestDay.percent}% tráfico</Badge>
          </div>
          <div className="att-kpi-body">
            <p className="att-kpi-value">{analytics.busiestDay.dayName}</p>
            <p className="att-kpi-subtext">
              {analytics.busiestDay.visits} visitas en la semana
            </p>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={Calendar01Icon} size={16} aria-hidden="true" />
            <span>Mayor disciplina de inicio</span>
          </div>
        </article>

        {/* Card 5: Average Workout Duration */}
        <article className="att-kpi-card clay-card">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Duración promedio</span>
            <Badge tone="success">Óptimo</Badge>
          </div>
          <div className="att-kpi-body">
            <p className="att-kpi-value">{analytics.averageDurationMinutes} min</p>
            <p className="att-kpi-subtext">Tiempo de sesión por socio</p>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={AlarmClockIcon} size={16} aria-hidden="true" />
            <span>Estándar fitness 60–75 min</span>
          </div>
        </article>

        {/* Card 6: Total Visits */}
        <article className="att-kpi-card clay-card">
          <div className="att-kpi-header">
            <span className="att-kpi-title">Total visitas</span>
            <Badge tone="neutral">
              {period === 'today' ? 'Hoy' : period === 'week' ? 'Semana' : 'Mes'}
            </Badge>
          </div>
          <div className="att-kpi-body">
            <p className="att-kpi-value">{analytics.totalVisits}</p>
            <p className="att-kpi-subtext">
              {analytics.rawVisitsCount > 0 ? `${analytics.rawVisitsCount} registradas` : 'Distribución proyectada'}
            </p>
          </div>
          <div className="att-kpi-footer">
            <HugeiconsIcon icon={BarChartIcon} size={16} aria-hidden="true" />
            <span>Volumen de accesos</span>
          </div>
        </article>
      </section>

      {/* Charts Grid (Hourly Traffic & Day of Week Traffic) */}
      <div className="att-charts-grid">
        {/* Hourly Traffic Chart (06:00 to 22:00) */}
        <Panel className="att-chart-panel clay-card">
          <div className="att-panel-head">
            <div>
              <h2 className="att-panel-title">Afluencia por hora operativa (06:00 a 22:00)</h2>
              <p className="att-panel-desc">
                Distribución horaria en 16 franjas de operación con pico resaltado en color naranja de marca
              </p>
            </div>
            <div className="att-chart-legend" aria-hidden="true">
              <span className="legend-item">
                <span className="legend-swatch peak" /> Hora pico ({analytics.peakHour.label})
              </span>
              <span className="legend-item">
                <span className="legend-swatch valley" /> Hora valle ({analytics.valleyHour.label})
              </span>
              <span className="legend-item">
                <span className="legend-swatch normal" /> Flujo regular
              </span>
            </div>
          </div>
          <div className="att-chart-container">
            {hourlyChart ? (
              <Chart
                definition={hourlyChart}
                height={250}
                ariaLabel="Gráfico de barras de afluencia por hora operativa"
              />
            ) : (
              <EmptyState title="Sin datos de afluencia">
                No hay información de accesos para graficar en este período.
              </EmptyState>
            )}
          </div>
        </Panel>

        {/* Day of Week Traffic Chart (Lunes a Domingo) */}
        <Panel className="att-chart-panel clay-card">
          <div className="att-panel-head">
            <div>
              <h2 className="att-panel-title">Distribución semanal por día</h2>
              <p className="att-panel-desc">
                Volumen acumulado de visitas de Lunes a Domingo; día más concurrido destacado
              </p>
            </div>
            <div className="att-chart-legend" aria-hidden="true">
              <span className="legend-item">
                <span className="legend-swatch peak" /> Día estelar ({analytics.busiestDay.dayName})
              </span>
              <span className="legend-item">
                <span className="legend-swatch normal" /> Días de semana
              </span>
            </div>
          </div>
          <div className="att-chart-container">
            {dayOfWeekChart ? (
              <Chart
                definition={dayOfWeekChart}
                height={250}
                ariaLabel="Gráfico de barras de afluencia por día de la semana"
              />
            ) : (
              <EmptyState title="Sin datos semanales">
                No hay información suficiente para comparar días de la semana.
              </EmptyState>
            )}
          </div>
        </Panel>
      </div>

      {/* Operational Time Slots (Matutino, Vespertino, Nocturno) */}
      <section className="att-slots-section" aria-label="Franjas horarias operativas">
        <h2 className="att-section-title">Franjas operativas y balance de carga</h2>
        <div className="att-slots-grid">
          {analytics.timeSlots.map(slot => (
            <article key={slot.slot} className={`att-slot-card clay-card status-${slot.status}`}>
              <div className="att-slot-header">
                <div>
                  <h3 className="att-slot-name">{slot.name}</h3>
                  <span className="att-slot-hours">{slot.hoursRange}</span>
                </div>
                <Badge
                  tone={
                    slot.status === 'crowded'
                      ? 'warning'
                      : slot.status === 'opportunity'
                      ? 'neutral'
                      : 'success'
                  }
                >
                  {slot.percent}% del tráfico
                </Badge>
              </div>
              <div className="att-slot-figures">
                <span className="att-slot-visits">{slot.visits} visitas</span>
                <div className="att-slot-progress-track" aria-hidden="true">
                  <div
                    className="att-slot-progress-fill"
                    style={{ width: `${Math.min(100, slot.percent)}%` }}
                  />
                </div>
              </div>
              <p className="att-slot-desc">{slot.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Live Occupants TanStack Table */}
      <Panel className="att-table-panel clay-card">
        <div className="att-table-head">
          <div>
            <div className="att-live-header-badge">
              <span className="att-pulse-dot" aria-hidden="true" />
              <h2 className="att-panel-title">Socios actualmente en el gimnasio</h2>
            </div>
            <p className="att-panel-desc">
              Listado en tiempo real de socios que ingresaron y no han registrado salida
            </p>
          </div>
          <div className="att-search-wrapper">
            <HugeiconsIcon icon={Search01Icon} size={16} className="att-search-icon" aria-hidden="true" />
            <input
              type="search"
              className="att-search-input"
              placeholder="Buscar por socio o plan..."
              aria-label="Buscar socio en sala"
              value={searchOccupant}
              onChange={e => setSearchOccupant(e.target.value)}
            />
          </div>
        </div>

        {filteredOccupants.length > 0 ? (
          <TableRegion label="Tabla de socios activos en el gimnasio">
            <table className="att-occupants-table">
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th key={header.id} scope="col" aria-sort={header.column.getCanSort()
                        ? header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'
                        : undefined}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        ) : (
          <EmptyState title="Sin socios en sala">
            {searchOccupant
              ? 'No se encontraron socios que coincidan con la búsqueda.'
              : 'Actualmente no hay socios registrados dentro de las instalaciones del gimnasio.'}
          </EmptyState>
        )}
      </Panel>

      {/* Strategic Operational Insights Panel */}
      <section className="att-insights-section" aria-label="Recomendaciones operativas">
        <div className="att-insights-head">
          <div className="att-insights-title-row">
            <HugeiconsIcon icon={BulbIcon} size={22} className="att-insights-icon" aria-hidden="true" />
            <h2 className="att-section-title">Recomendaciones estratégicas para el propietario</h2>
          </div>
          <p className="att-panel-desc">
            Decisiones operativas sugeridas con base en el flujo horario, aforo y capacidad instalada
          </p>
        </div>

        <div className="att-insights-grid">
          {analytics.recommendations.map(insight => (
            <article key={insight.id} className="att-insight-card clay-card">
              <div className="att-insight-header">
                <span className="att-insight-title">{insight.title}</span>
                <Badge
                  tone={
                    insight.urgency === 'high'
                      ? 'warning'
                      : insight.urgency === 'medium'
                      ? 'neutral'
                      : 'success'
                  }
                >
                  {insight.urgency === 'high'
                    ? 'Alta prioridad'
                    : insight.urgency === 'medium'
                    ? 'Oportunidad'
                    : 'Informativa'}
                </Badge>
              </div>
              <p className="att-insight-desc">{insight.description}</p>
              <div className="att-insight-action-box">
                <strong className="att-action-label">Acción recomendada:</strong>
                <p className="att-action-text">{insight.recommendation}</p>
              </div>
              <div className="att-insight-impact">
                <HugeiconsIcon icon={InformationCircleIcon} size={14} aria-hidden="true" />
                <span>{insight.impact}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
