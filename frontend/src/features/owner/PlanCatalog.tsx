import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Add01Icon,
  Cash01Icon,
  PencilEdit02Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';

import { useDemo } from '../../demo/DemoProvider';
import { formatMoney } from '../../demo/adapter';
import {
  savePlan,
  togglePlanActive,
  updatePlan,
  getPlanStorageIssue,
  usePlans,
  type Plan,
} from '../../demo/plans';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import './PlanCatalog.css';
import { PlanEditor } from './PlanEditor';
import { listCatalogPlans, listCatalogServices, saveCatalogPlan, toOwnerPlan, updateCatalogPlanStatus, type CatalogPlan, type CatalogRequest, type CatalogService } from '../../api/catalogApi';

type FilterPillOption = 'all' | 'active' | 'membership' | 'visit' | 'inactive';

export function PlanCatalog({ apiRequest }: { apiRequest?: CatalogRequest } = {}) {
  return apiRequest ? <LivePlanCatalog request={apiRequest} /> : <DemoPlanCatalog />;
}

function DemoPlanCatalog() {
  const { state } = useDemo();
  return <CatalogView plans={usePlans()} products={state.products} storageIssue={getPlanStorageIssue()}
    onSave={(input, existing) => { if (existing) updatePlan(existing.id, input); else savePlan(input); }}
    onToggle={id => { togglePlanActive(id); }} />;
}

function LivePlanCatalog({ request }: { request: CatalogRequest }) {
  const [plans, setPlans] = useState<(Plan & { _raw: CatalogPlan })[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshNotice, setRefreshNotice] = useState('');
  const createCode = useRef<string | null>(null);
  async function refresh() {
    const [catalogPlans, catalogServices] = await Promise.all([listCatalogPlans(request), listCatalogServices(request)]);
    setServices(catalogServices);
    setPlans(catalogPlans.map(plan => toOwnerPlan(plan, catalogServices)));
  }
  useEffect(() => {
    let active = true;
    Promise.all([listCatalogPlans(request), listCatalogServices(request)]).then(([catalogPlans, catalogServices]) => {
      if (!active) return;
      setServices(catalogServices);
      setPlans(catalogPlans.map(plan => toOwnerPlan(plan, catalogServices)));
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los planes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request]);
  async function save(input: Omit<Plan, 'id'>, existing?: Plan & { _raw?: CatalogPlan }) {
    if (!existing && !createCode.current) createCode.current = `plan-${crypto.randomUUID().replaceAll('-', '')}`;
    if (existing && !existing._raw) throw new Error('No se puede editar el plan porque no está disponible su versión vigente.');
    await saveCatalogPlan(request, input, services, existing?._raw, createCode.current ?? undefined);
    if (!existing) createCode.current = null;
    setRefreshNotice('');
    try { await refresh(); } catch { setRefreshNotice('El plan se guardó, pero no se pudo actualizar el catálogo. Vuelve a cargar la página para verificarlo.'); }
  }
  async function toggle(id: string, active: boolean) {
    await updateCatalogPlanStatus(request, id, active);
    try { await refresh(); } catch { setRefreshNotice('El estado se guardó, pero no se pudo actualizar el catálogo. Vuelve a cargar la página para verificarlo.'); }
  }
  return <CatalogView plans={plans} products={[]} apiMode loading={loading} loadError={loadError} refreshNotice={refreshNotice}
    onSave={save} onToggle={toggle} />;
}

type CatalogViewProps = {
  plans: Plan[]; products: { id: string; name: string; priceMinor: number; openingQuantity: number }[];
  storageIssue?: string | null; apiMode?: boolean; loading?: boolean; loadError?: string; refreshNotice?: string;
  onSave: (input: Omit<Plan, 'id'>, existing?: Plan & { _raw?: CatalogPlan }) => void | Promise<void>;
  onToggle: (id: string, active: boolean) => void | Promise<void>;
};
function CatalogView({ plans, products, storageIssue, apiMode = false, loading = false, loadError, refreshNotice, onSave, onToggle }: CatalogViewProps) {

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterPillOption>('all');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<(Plan & { _raw?: CatalogPlan }) | null>(null);
  const [toggleError, setToggleError] = useState('');
  const [toggleSaving, setToggleSaving] = useState(false);
  const toggleInFlight = useRef(false);

  const [confirmTogglePlan, setConfirmTogglePlan] = useState<Plan | null>(null);

  // Keyboard accessibility: Close modals on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (isNewModalOpen) setIsNewModalOpen(false);
        if (editingPlan) setEditingPlan(null);
        if (confirmTogglePlan) setConfirmTogglePlan(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isNewModalOpen, editingPlan, confirmTogglePlan]);

  // Pill counts & KPIs
  const counts = useMemo(() => {
    let total = 0;
    let active = 0;
    let membership = 0;
    let visit = 0;
    let inactive = 0;

    for (const p of plans) {
      total += 1;
      if (p.active !== false) {
        active += 1;
      } else {
        inactive += 1;
      }
      if (p.kind === 'membership') {
        membership += 1;
      } else if (p.kind === 'visit') {
        visit += 1;
      }
    }

    return { total, active, membership, visit, inactive };
  }, [plans]);

  // Filter items in table
  const filteredPlans = useMemo(() => {
    return plans.filter(p => {
      // Filter pill
      if (selectedFilter === 'active' && p.active === false) return false;
      if (selectedFilter === 'inactive' && p.active !== false) return false;
      if (selectedFilter === 'membership' && p.kind !== 'membership') return false;
      if (selectedFilter === 'visit' && p.kind !== 'visit') return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesApp = p.applicability.toLowerCase().includes(query);
        const matchesRestr = p.restriction ? p.restriction.toLowerCase().includes(query) : false;
        return matchesName || matchesApp || matchesRestr;
      }

      return true;
    });
  }, [plans, selectedFilter, searchQuery]);

  // Table columns definition
  const columns = useMemo<ColumnDef<Plan>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <button
            type="button"
            className="plan-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Plan / visita {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <div>
            <div className="plan-table-name">{row.original.name}</div>
            {row.original.legacy ? <small className="muted">Oferta previa · fuera del catálogo fuente</small> : null}
          </div>
        ),
      },
      {
        accessorKey: 'kind',
        header: ({ column }) => (
          <button
            type="button"
            className="plan-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Tipo {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <Badge tone="neutral">
            {row.original.kind === 'membership' ? 'Membresía' : 'Visita'}
          </Badge>
        ),
      },
      {
        accessorKey: 'amountMinor',
        header: ({ column }) => (
          <button
            type="button"
            className="plan-sort-btn"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Precio {column.getIsSorted() === 'asc' ? '▲' : column.getIsSorted() === 'desc' ? '▼' : '↕'}
          </button>
        ),
        cell: ({ row }) => (
          <span className="plan-table-price">{formatMoney(row.original.amountMinor)} MXN</span>
        ),
      },
      {
        accessorKey: 'applicability',
        header: 'Aplicación y límite',
        cell: ({ row }) => (
          <div>
            <div>{row.original.applicability}</div>
            <span className="plan-table-restriction-note muted">
              {row.original.restriction || 'Registro de cobro pendiente de validación; no activa acceso automáticamente.'}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Estado',
        cell: ({ row }) => (
          <Badge tone={row.original.active !== false ? 'success' : 'neutral'}>
            {row.original.active !== false ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => (
          <div className="plan-table-actions">
            <Button
              variant="secondary"
              className="plan-action-btn-sm"
              onClick={() => handleOpenEditModal(row.original)}
              aria-label={`Editar ${row.original.name}`}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
              <span>Editar</span>
            </Button>
            <Button
              variant="secondary"
              className="plan-action-btn-sm"
              onClick={() => setConfirmTogglePlan(row.original)}
              aria-label={`${row.original.active !== false ? 'Desactivar' : 'Activar'} ${row.original.name}`}
            >
              {row.original.active !== false ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredPlans,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleOpenNewModal() { setIsNewModalOpen(true); }
  function handleOpenEditModal(plan: Plan & { _raw?: CatalogPlan }) { setEditingPlan(plan); }
  async function handleConfirmToggle() {
    if (!confirmTogglePlan || toggleInFlight.current) return;
    toggleInFlight.current = true;
    setToggleSaving(true);
    try {
      await onToggle(confirmTogglePlan.id, confirmTogglePlan.active === false);
      setConfirmTogglePlan(null);
      setToggleError('');
    } catch (error) { setToggleError(error instanceof Error ? error.message : 'No se pudo guardar.'); }
    finally { toggleInFlight.current = false; setToggleSaving(false); }
  }
  return (
    <div className="plan-catalog-root">
      <PageHeader
        eyebrow="PROPIETARIO · GESTIÓN DE PLANES"
        title="Catálogo de planes"
        description="Gestión integral de membresías y pases de visita. Define precios, vigencias operativas y disponibilidad para recepción."
      />

      {storageIssue ? <Notice tone="warning">{storageIssue}</Notice> : null}
      {loadError ? <p role="alert">{loadError}</p> : null}
      {refreshNotice ? <p role="status">{refreshNotice}</p> : null}
      {toggleError ? <p role="alert">{toggleError}</p> : null}
      {/* Bento Summary KPIs (4 cards) */}
      <div className="plan-bento-grid">
        <div className="plan-kpi-card">
          <div className="plan-kpi-header">
            <span className="plan-kpi-title">Total planes</span>
            <span className="plan-kpi-icon"><HugeiconsIcon icon={Cash01Icon} size={20} /></span>
          </div>
          <div>
            <div className="plan-kpi-value">{counts.total}</div>
            <div className="plan-kpi-subtitle">Planes registrados en catálogo</div>
          </div>
        </div>

        <div className="plan-kpi-card">
          <div className="plan-kpi-header">
            <span className="plan-kpi-title">Planes activos</span>
            <span className="plan-kpi-icon"><Badge tone="success">Activos</Badge></span>
          </div>
          <div>
            <div className="plan-kpi-value">{counts.active}</div>
            <div className="plan-kpi-subtitle">Disponibles para cobro en recepción</div>
          </div>
        </div>

        <div className="plan-kpi-card">
          <div className="plan-kpi-header">
            <span className="plan-kpi-title">Membresías</span>
            <span className="plan-kpi-icon"><Badge tone="neutral">Membresías</Badge></span>
          </div>
          <div>
            <div className="plan-kpi-value">{counts.membership}</div>
            <div className="plan-kpi-subtitle">Planes de acceso periódico</div>
          </div>
        </div>

        <div className="plan-kpi-card">
          <div className="plan-kpi-header">
            <span className="plan-kpi-title">Pases por visita</span>
            <span className="plan-kpi-icon"><Badge tone="neutral">Visitas</Badge></span>
          </div>
          <div>
            <div className="plan-kpi-value">{counts.visit}</div>
            <div className="plan-kpi-subtitle">Tarifas de acceso único</div>
          </div>
        </div>
      </div>

      {/* Interactive Management Panel */}
      <Panel>
        <div className="plan-catalog-toolbar">
          <div className="plan-search-wrap">
            <span className="plan-search-icon">
              <HugeiconsIcon icon={Search01Icon} size={18} />
            </span>
            <input
              type="search"
              className="plan-search-input"
              placeholder="Buscar plan por nombre o descripción..."
              aria-label="Buscar planes"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="plan-filter-pills" role="radiogroup" aria-label="Filtrar planes">
            <button
              type="button"
              className={`plan-pill-btn ${selectedFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('all')}
              aria-pressed={selectedFilter === 'all'}
            >
              <span>Todos</span>
              <span className="plan-pill-count">{counts.total}</span>
            </button>
            <button
              type="button"
              className={`plan-pill-btn ${selectedFilter === 'active' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('active')}
              aria-pressed={selectedFilter === 'active'}
            >
              <span>Activos</span>
              <span className="plan-pill-count">{counts.active}</span>
            </button>
            <button
              type="button"
              className={`plan-pill-btn ${selectedFilter === 'membership' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('membership')}
              aria-pressed={selectedFilter === 'membership'}
            >
              <span>Membresías</span>
              <span className="plan-pill-count">{counts.membership}</span>
            </button>
            <button
              type="button"
              className={`plan-pill-btn ${selectedFilter === 'visit' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('visit')}
              aria-pressed={selectedFilter === 'visit'}
            >
              <span>Visitas</span>
              <span className="plan-pill-count">{counts.visit}</span>
            </button>
            <button
              type="button"
              className={`plan-pill-btn ${selectedFilter === 'inactive' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('inactive')}
              aria-pressed={selectedFilter === 'inactive'}
            >
              <span>Inactivos</span>
              <span className="plan-pill-count">{counts.inactive}</span>
            </button>
          </div>

          <Button onClick={handleOpenNewModal}>
            <HugeiconsIcon icon={Add01Icon} size={18} />
            <span>Nuevo plan</span>
          </Button>
        </div>

        {/* TanStack Table */}
        <TableRegion label="Planes y visitas">
          <table>
            <caption>MXN · catálogo administrado por el propietario</caption>
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th key={header.id} scope="col">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={columns.length}><EmptyState title="Cargando planes">Consultando el catálogo.</EmptyState></td></tr> : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState title="No se encontraron planes">
                      No hay planes que coincidan con la búsqueda o filtro seleccionado.
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableRegion>
      </Panel>

      <Notice tone="warning">
        La beca de Box requiere selección del entrenador; no es tarifa general. Estudiantes y Box kids no se aprueban automáticamente. No se calculan fechas mensuales ni periodos de 30 días.
      </Notice>

      {!apiMode ? <Panel className="mt-6">
        <h2>Catálogo de productos</h2>
        <p className="muted">
          Precio y cantidad registrados para el inventario de recepción.
        </p>
        <TableRegion label="Productos de referencia">
          <table>
            <caption>Productos disponibles para venta en recepción</caption>
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Precio MXN</th>
                <th scope="col">Cantidad inicial</th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{formatMoney(product.priceMinor)}</td>
                  <td>{product.openingQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </Panel> : null}

      {isNewModalOpen ? <PlanEditor onClose={() => setIsNewModalOpen(false)} onSave={input => onSave(input)} /> : null}
      {editingPlan ? <PlanEditor key={editingPlan.id} plan={editingPlan} onClose={() => setEditingPlan(null)} onSave={input => onSave(input, editingPlan)} /> : null}
      {/* Modal: Confirmar Activar / Desactivar */}
      {confirmTogglePlan && (
        <div
          className="plan-modal-backdrop"
          role="presentation"
          onClick={() => setConfirmTogglePlan(null)}
        >
          <div
            className="plan-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="toggle-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="plan-modal-header">
              <h2 id="toggle-modal-title" className="plan-modal-title">
                {confirmTogglePlan.active !== false ? '¿Desactivar plan?' : '¿Activar plan?'}
              </h2>
              <button
                type="button"
                className="plan-modal-close-btn"
                onClick={() => setConfirmTogglePlan(null)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <p>
              ¿Estás seguro de que deseas{' '}
              <strong>{confirmTogglePlan.active !== false ? 'desactivar' : 'activar'}</strong> el
              plan <strong>"{confirmTogglePlan.name}"</strong>?
            </p>
            <Notice tone={confirmTogglePlan.active !== false ? 'warning' : 'neutral'}>
              {confirmTogglePlan.active !== false
                ? 'La recepción ya no podrá ofrecerlo ni cobrarlo. Los registros históricos y cobros pasados se conservan intactos.'
                : 'El plan volverá a estar disponible inmediatamente para la recepción.'}
            </Notice>

            <div className="plan-modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmTogglePlan(null)}
              >
                Cancelar
              </Button>
              <Button disabled={toggleSaving} onClick={handleConfirmToggle}>
                {confirmTogglePlan.active !== false ? 'Confirmar desactivación' : 'Confirmar activación'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
