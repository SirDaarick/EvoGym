import { categoryLabels, validPeriod } from '@/domain/reporting';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { PaymentMethod } from '../../domain/models';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import { useDemo } from '../../demo/DemoProvider';
import { defaultPeriod, ownerHistory, type HistoryFilter } from '../../demo/ownerOperations';
import { EmptyState, PageHeader, Panel } from '../../shared/ui';
import { NotebookNotice, paymentMethods } from '../../shared/operationPresentation';
import { HistoryTable } from './HistoryTable';
import { LiveHistory } from './LiveHistory';
import { PeriodFields } from './PeriodFields';

export function History({ apiRequest }: { apiRequest?: AuthenticatedRequest } = {}) {
  return apiRequest ? <LiveHistory apiRequest={apiRequest} /> : <DemoHistory />;
}

function DemoHistory() {
  const { state } = useDemo();
  const [filter, setFilter] = useState<HistoryFilter>(() => ({
    ...defaultPeriod(state),
    category: 'all',
    method: 'all',
  }));

  const records = useMemo(() => ownerHistory(state, filter), [state, filter]);

  return (
    <>
      <PageHeader
        eyebrow="PROPIETARIO · TRAZABILIDAD LOCAL"
        title="Historial de movimientos"
        description="Pagos, ventas, cantidades, conteos y turnos. Consulta de solo lectura."
      />
      <Panel>
        <PeriodFields period={filter} onChange={period => setFilter({ ...filter, ...period })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="history-category">Categoría</label>
            <select
              id="history-category"
              value={filter.category}
              onChange={event =>
                setFilter({ ...filter, category: event.target.value as HistoryFilter['category'] })
              }
            >
              <option value="all">Todas las categorías</option>
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-method">Método</label>
            <select
              id="history-method"
              value={filter.method}
              onChange={event =>
                setFilter({ ...filter, method: event.target.value as PaymentMethod | 'all' })
              }
            >
              <option value="all">Todos / no aplica</option>
              {Object.entries(paymentMethods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="muted">
          Filtrar por método muestra solo operaciones de pago. Reposición, merma, conteo y turnos no tienen método ni importe de venta.
        </p>
      </Panel>

      {validPeriod(filter) && (
        <Panel className="mt-6">
          {records.length ? (
            <>
              <HistoryTable records={records} caption={`${records.length} registros · referencias locales, no comprobantes ni folios físicos`} />
            </>
          ) : (
            <EmptyState title="Sin movimientos para estos filtros">
              No hay registros locales coincidentes. Cambia el periodo, categoría o método.
            </EmptyState>
          )}
        </Panel>
      )}

      <NotebookNotice />
      <div className="flow">
        <Link to="/owner/shifts">Consultar resumen por turno</Link>
      </div>
    </>
  );
}
