import { useEffect, useMemo, useState } from 'react';
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
import { formatMoney, parseMoney } from '../../demo/adapter';
import {
  savePlan,
  togglePlanActive,
  updatePlan,
  usePlans,
  type Plan,
} from '../../demo/plans';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel, TableRegion } from '../../shared/ui';
import './PlanCatalog.css';

type FilterPillOption = 'all' | 'active' | 'membership' | 'visit' | 'inactive';

export function PlanCatalog() {
  const { state } = useDemo();
  const plans = usePlans();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<FilterPillOption>('all');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'name', desc: false },
  ]);

  // Modals state
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'membership' | 'visit'>('membership');
  const [newPrice, setNewPrice] = useState('');
  const [newApplicability, setNewApplicability] = useState('');
  const [newRestriction, setNewRestriction] = useState('');
  const [newError, setNewError] = useState('');

  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<'membership' | 'visit'>('membership');
  const [editPrice, setEditPrice] = useState('');
  const [editApplicability, setEditApplicability] = useState('');
  const [editRestriction, setEditRestriction] = useState('');
  const [editError, setEditError] = useState('');

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

  // Modal handlers
  function handleOpenNewModal() {
    setNewName('');
    setNewKind('membership');
    setNewPrice('');
    setNewApplicability('');
    setNewRestriction('');
    setNewError('');
    setIsNewModalOpen(true);
  }

  function handleSaveNewPlan(e: React.FormEvent) {
    e.preventDefault();
    setNewError('');

    if (!newName.trim()) {
      setNewError('El nombre del plan es obligatorio.');
      return;
    }

    const priceMinor = parseMoney(newPrice);
    if (priceMinor === null || priceMinor <= 0) {
      setNewError('Ingresa un precio válido mayor a 0 MXN.');
      return;
    }

    if (!newApplicability.trim()) {
      setNewError('La descripción de aplicabilidad es obligatoria.');
      return;
    }

    savePlan({
      name: newName.trim(),
      kind: newKind,
      amountMinor: priceMinor,
      applicability: newApplicability.trim(),
      restriction: newRestriction.trim() || undefined,
      active: true,
    });

    setIsNewModalOpen(false);
  }

  function handleOpenEditModal(plan: Plan) {
    setEditingPlan(plan);
    setEditName(plan.name);
    setEditKind(plan.kind);
    setEditPrice((plan.amountMinor / 100).toFixed(2));
    setEditApplicability(plan.applicability);
    setEditRestriction(plan.restriction || '');
    setEditError('');
  }

  function handleSaveEditPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan) return;
    setEditError('');

    if (!editName.trim()) {
      setEditError('El nombre del plan es obligatorio.');
      return;
    }

    const priceMinor = parseMoney(editPrice);
    if (priceMinor === null || priceMinor <= 0) {
      setEditError('Ingresa un precio válido mayor a 0 MXN.');
      return;
    }

    if (!editApplicability.trim()) {
      setEditError('La descripción de aplicabilidad es obligatoria.');
      return;
    }

    updatePlan(editingPlan.id, {
      name: editName.trim(),
      kind: editKind,
      amountMinor: priceMinor,
      applicability: editApplicability.trim(),
      restriction: editRestriction.trim() || undefined,
    });

    setEditingPlan(null);
  }

  function handleConfirmToggle() {
    if (!confirmTogglePlan) return;
    togglePlanActive(confirmTogglePlan.id);
    setConfirmTogglePlan(null);
  }

  return (
    <div className="plan-catalog-root">
      <PageHeader
        eyebrow="PROPIETARIO · GESTIÓN DE PLANES"
        title="Catálogo de planes"
        description="Gestión integral de membresías y pases de visita. Define precios, vigencias operativas y disponibilidad para recepción."
      />

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
              {table.getRowModel().rows.length === 0 ? (
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

      {/* Products Catalog Panel */}
      <Panel className="mt-6">
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
              {state.products.map(product => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{formatMoney(product.priceMinor)}</td>
                  <td>{product.openingQuantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </Panel>

      {/* Modal: Nuevo Plan */}
      {isNewModalOpen && (
        <div
          className="plan-modal-backdrop"
          role="presentation"
          onClick={() => setIsNewModalOpen(false)}
        >
          <div
            className="plan-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-plan-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="plan-modal-header">
              <h2 id="new-plan-modal-title" className="plan-modal-title">
                Nuevo plan
              </h2>
              <button
                type="button"
                className="plan-modal-close-btn"
                onClick={() => setIsNewModalOpen(false)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveNewPlan} className="plan-form-grid">
              {newError && <Notice tone="error">{newError}</Notice>}

              <div className="field">
                <label htmlFor="new-plan-name">Nombre del plan</label>
                <input
                  id="new-plan-name"
                  type="text"
                  required
                  placeholder="ej. Box Anual Premium"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="new-plan-kind">Tipo de acceso</label>
                <select
                  id="new-plan-kind"
                  value={newKind}
                  onChange={e => setNewKind(e.target.value as 'membership' | 'visit')}
                >
                  <option value="membership">Membresía</option>
                  <option value="visit">Pase por visita</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="new-plan-price">Precio MXN</label>
                <input
                  id="new-plan-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="ej. 500.00"
                  value={newPrice}
                  onChange={e => setNewPrice(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="new-plan-applicability">Descripción de aplicabilidad</label>
                <textarea
                  id="new-plan-applicability"
                  required
                  rows={2}
                  placeholder="ej. Acceso a Box en horarios matutinos y vespertinos."
                  value={newApplicability}
                  onChange={e => setNewApplicability(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="new-plan-restriction">Restricción u observación (opcional)</label>
                <input
                  id="new-plan-restriction"
                  type="text"
                  placeholder="ej. Requiere comprobante de inscripción vigente."
                  value={newRestriction}
                  onChange={e => setNewRestriction(e.target.value)}
                />
              </div>

              <div className="plan-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsNewModalOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit">Guardar plan</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Plan */}
      {editingPlan && (
        <div
          className="plan-modal-backdrop"
          role="presentation"
          onClick={() => setEditingPlan(null)}
        >
          <div
            className="plan-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-plan-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="plan-modal-header">
              <h2 id="edit-plan-modal-title" className="plan-modal-title">
                Editar plan
              </h2>
              <button
                type="button"
                className="plan-modal-close-btn"
                onClick={() => setEditingPlan(null)}
                aria-label="Cerrar modal"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveEditPlan} className="plan-form-grid">
              {editError && <Notice tone="error">{editError}</Notice>}

              <div className="field">
                <label htmlFor="edit-plan-name">Nombre del plan</label>
                <input
                  id="edit-plan-name"
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="edit-plan-kind">Tipo de acceso</label>
                <select
                  id="edit-plan-kind"
                  value={editKind}
                  onChange={e => setEditKind(e.target.value as 'membership' | 'visit')}
                >
                  <option value="membership">Membresía</option>
                  <option value="visit">Pase por visita</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="edit-plan-price">Precio MXN</label>
                <input
                  id="edit-plan-price"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={editPrice}
                  onChange={e => setEditPrice(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="edit-plan-applicability">Descripción de aplicabilidad</label>
                <textarea
                  id="edit-plan-applicability"
                  required
                  rows={2}
                  value={editApplicability}
                  onChange={e => setEditApplicability(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="edit-plan-restriction">Restricción u observación (opcional)</label>
                <input
                  id="edit-plan-restriction"
                  type="text"
                  value={editRestriction}
                  onChange={e => setEditRestriction(e.target.value)}
                />
              </div>

              <div className="plan-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingPlan(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit">Guardar cambios</Button>
              </div>
            </form>
          </div>
        </div>
      )}

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
              <Button onClick={handleConfirmToggle}>
                {confirmTogglePlan.active !== false ? 'Confirmar desactivación' : 'Confirmar activación'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
