import { useCallback, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useStaff, saveStaffProfile, toggleStaffActive, type StaffProfile } from '../staff/staffStore';
import { formatMoney, parseMoney } from '../../demo/adapter';
import { Button, Panel } from '../../shared/ui';
import SquishSwitch from '../catalog/react-bits/SquishSwitch';
import CodeSlots, { type CodeSlotsStatus } from '../catalog/react-bits/CodeSlots';
import SwipeToast from '../catalog/react-bits/SwipeToast';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import { DevicePairingModal } from '../staff/DevicePairingModal';

export function StaffManagement() {
  const staffList = useStaff();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [sorting, setSorting] = useState<SortingState>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pairingStaff, setPairingStaff] = useState<StaffProfile | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [shift, setShift] = useState('Matutino');
  const [salaryText, setSalaryText] = useState('8000');
  const [isActive, setIsActive] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');

  // Toast state
  const [toast, setToast] = useState<{
    open: boolean;
    type: 'success' | 'error';
    title: string;
    description: string;
  } | null>(null);

  // Filter receptionists with stable memoization
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (s.role !== 'RECEPTION') return false;
      const matchesStatus =
        statusFilter === 'all' ? true : statusFilter === 'active' ? s.active : !s.active;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        query === '' ||
        s.name.toLowerCase().includes(query) ||
        s.shift.toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [staffList, statusFilter, searchQuery]);

  function openCreateModal() {
    setEditingId(null);
    setName('');
    setShift('Matutino');
    setSalaryText('8000');
    setIsActive(true);
    setHasPin(false);
    setPin1('');
    setPin2('');
    setIsModalOpen(true);
  }

  const openEditModal = useCallback((staff: StaffProfile) => {
    setEditingId(staff.id);
    setName(staff.name);
    setShift(staff.shift);
    setSalaryText(staff.salaryMinor ? (staff.salaryMinor / 100).toString() : '8000');
    setIsActive(staff.active);
    setHasPin(staff.hasPin);
    setPin1(staff.hasPin ? (staff.pin ?? '1234') : '');
    setPin2(staff.hasPin ? (staff.pin ?? '1234') : '');
    setIsModalOpen(true);
  }, []);

  function closeModal() {
    setIsModalOpen(false);
    setEditingId(null);
    setPin1('');
    setPin2('');
  }

  // 2-phase PIN status validation
  let pinStatus: CodeSlotsStatus = 'idle';
  let pinValidationMsg = '';
  let isPinMismatch = false;
  if (hasPin) {
    if (pin1.length === 4 && pin2.length === 4) {
      if (pin1 === pin2) {
        pinStatus = 'success';
        pinValidationMsg = '✓ PIN confirmado correctamente';
      } else {
        pinStatus = 'idle';
        isPinMismatch = true;
        pinValidationMsg = 'Los PINs no coinciden. Por favor verifica.';
      }
    }
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    if (hasPin) {
      if (pin1.length < 4 || pin2.length < 4 || pin1 !== pin2) {
        setToast({
          open: true,
          type: 'error',
          title: 'Error de PIN',
          description: 'Debes ingresar y confirmar el mismo PIN de 4 dígitos.',
        });
        return;
      }
    }

    const salaryMinor = parseMoney(salaryText) ?? 800000;
    const staffId = editingId ?? `recep-${Date.now().toString().slice(-4)}`;

    saveStaffProfile({
      id: staffId,
      name: name.trim(),
      role: 'RECEPTION',
      shift,
      salaryMinor,
      hasPin,
      pin: hasPin ? pin1 : '',
      active: isActive,
    });

    setToast({
      open: true,
      type: 'success',
      title: editingId ? 'Perfil actualizado' : 'Recepcionista registrado',
      description: `El perfil de ${name.trim()} se ha guardado correctamente.`,
    });

    closeModal();
  }

  const handleToggleStatus = useCallback((staff: StaffProfile) => {
    const updated = toggleStaffActive(staff.id);
    if (updated) {
      setToast({
        open: true,
        type: 'success',
        title: updated.active ? 'Perfil reactivado' : 'Perfil desactivado',
        description: `${updated.name} ${updated.active ? 'ahora aparecerá' : 'ya no aparecerá'} en la pantalla de inicio.`,
      });
    }
  }, []);

  const receptionStaff = staffList.filter((s) => s.role === 'RECEPTION');
  const activeCount = receptionStaff.filter((s) => s.active).length;
  const inactiveCount = receptionStaff.length - activeCount;

  const columns = useMemo<ColumnDef<StaffProfile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Recepcionista',
        cell: ({ row }) => (
          <div className="staff-cell">
            <div className="staff-avatar staff-avatar-recep" aria-hidden="true">
              {row.original.avatarInitials}
            </div>
            <div className="staff-info">
              <strong>{row.original.name}</strong>
              <span className="muted">ID: {row.original.id}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'shift',
        header: 'Turno',
        cell: ({ row }) => row.original.shift,
      },
      {
        accessorKey: 'salaryMinor',
        header: 'Sueldo mensual',
        sortDescFirst: false,
        cell: ({ row }) => (
          <span className="staff-salary-cell">
            <strong>{formatMoney(row.original.salaryMinor)}</strong>
          </span>
        ),
      },
      {
        accessorKey: 'hasPin',
        header: 'Credencial',
        cell: ({ row }) => (
          <span className="badge-pin">
            {row.original.hasPin ? '🔒 Con PIN' : '⚡ Acceso directo'}
          </span>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Estado',
        cell: ({ row }) => (
          <span className={`badge ${row.original.active ? 'badge-success' : 'badge-neutral'}`}>
            {row.original.active ? '● Activo' : '○ Inactivo'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end', width: '100%' }}>
            <Button
              variant="secondary"
              onClick={() => setPairingStaff(row.original)}
              title="Vincular teléfono del empleado sin contraseñas"
            >
              Vincular Dispositivo
            </Button>
            <Button variant="secondary" onClick={() => openEditModal(row.original)}>
              Editar
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleToggleStatus(row.original)}
              style={{
                color: row.original.active ? 'var(--catalog-field-error, #A32222)' : 'inherit',
              }}
            >
              {row.original.active ? 'Desactivar' : 'Activar'}
            </Button>
          </div>
        ),
      },
    ],
    [openEditModal, handleToggleStatus]
  );

  const table = useReactTable({
    data: filteredStaff,
    columns,
    getRowId: (row) => row.id,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="staff-mgmt-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">ADMINISTRACIÓN · PERSONAL</p>
          <h1>Equipo de Recepción</h1>
          <p className="muted">
            {activeCount} activos · {inactiveCount} inactivos · {receptionStaff.length} en total
          </p>
        </div>
        <Button variant="primary" onClick={openCreateModal}>
          <span>+</span> Nuevo recepcionista
        </Button>
      </header>

      {/* Main Content Panel (No KPIs, direct to management) */}
      <Panel className="staff-mgmt-panel">
        <div className="staff-mgmt-toolbar">
          <div className="field staff-mgmt-search">
            <label htmlFor="staff-search-input" className="sr-only">
              Buscar recepcionista
            </label>
            <input
              id="staff-search-input"
              type="text"
              placeholder="Buscar por nombre o turno..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="staff-mgmt-filters">
            <JellyRadio
              items={[
                { value: 'all', label: 'Todos' },
                { value: 'active', label: 'Activos' },
                { value: 'inactive', label: 'Inactivos' },
              ]}
              value={statusFilter}
              onChange={(val) => setStatusFilter(val as 'all' | 'active' | 'inactive')}
              size="sm"
              chipColor="var(--color-surface-soft, #242424)"
              activeColor="var(--color-primary, #FC6C06)"
              textColor="var(--color-muted, #a3a3a3)"
              activeTextColor="#080808"
              ariaLabel="Filtrar por estado"
            />
          </div>
        </div>

        {/* Elevated TanStack Table */}
        <div
          className="table-region staff-table-region"
          role="region"
          aria-label="Listado de recepcionistas"
        >
          <table className="staff-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const isSorted = header.column.getIsSorted();
                    const headerLabel =
                      typeof header.column.columnDef.header === 'string'
                        ? header.column.columnDef.header
                        : 'columna';

                    return (
                      <th
                        key={header.id}
                        style={header.id === 'actions' ? { textAlign: 'right' } : undefined}
                        aria-sort={
                          canSort
                            ? isSorted === 'asc'
                              ? 'ascending'
                              : isSorted === 'desc'
                              ? 'descending'
                              : 'none'
                            : undefined
                        }
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="staff-table-sort-btn"
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={`Ordenar por ${headerLabel.toLowerCase()}`}
                          >
                            <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <span className="sort-indicator" aria-hidden="true">
                              {isSorted === 'asc' ? ' ▲' : isSorted === 'desc' ? ' ▼' : ' ⇅'}
                            </span>
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    style={{ textAlign: 'center', padding: '32px', color: 'var(--color-muted)' }}
                  >
                    No se encontraron recepcionistas con los criterios actuales.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={cell.column.id === 'actions' ? { textAlign: 'right' } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Modal Dialog with 2-phase PIN and SquishSwitch */}
      {isModalOpen && (
        <div className="staff-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-staff-form-title">
          <div className="staff-modal-card staff-mgmt-modal-card">
            <div className="staff-modal-header" style={{ width: '100%', textAlign: 'left', alignItems: 'flex-start' }}>
              <h2 id="modal-staff-form-title">
                {editingId ? 'Editar Recepcionista' : 'Nuevo Recepcionista'}
              </h2>
              <p className="muted">Registra los datos de acceso, turno y remuneración del empleado</p>
            </div>

            <form onSubmit={handleSave} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="field">
                <label htmlFor="staff-name-field">Nombre completo *</label>
                <input
                  id="staff-name-field"
                  type="text"
                  required
                  placeholder="Ej. Valeria Morales"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="staff-shift-field">Turno asignado</label>
                <select
                  id="staff-shift-field"
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                >
                  <option value="Matutino">Turno Matutino (06:00 – 14:00)</option>
                  <option value="Vespertino">Turno Vespertino (14:00 – 22:00)</option>
                  <option value="Mixto">Turno Mixto / Rotativo</option>
                  <option value="Fin de semana">Fin de semana</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="staff-salary-field">Sueldo mensual (MXN) *</label>
                <input
                  id="staff-salary-field"
                  type="number"
                  step="50"
                  min="0"
                  required
                  placeholder="8000"
                  value={salaryText}
                  onChange={(e) => setSalaryText(e.target.value)}
                />
              </div>

              <div className="field">
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Estado de la cuenta
                </label>
                <JellyRadio
                  items={[
                    { value: 'active', label: '● Activo' },
                    { value: 'inactive', label: '○ Inactivo' },
                  ]}
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(val) => setIsActive(val === 'active')}
                  size="sm"
                  chipColor="var(--color-surface-soft, #242424)"
                  activeColor="var(--color-primary, #FC6C06)"
                  textColor="var(--color-muted, #a3a3a3)"
                  activeTextColor="#080808"
                  ariaLabel="Estado de la cuenta"
                />
              </div>

              {/* 2-Phase PIN Configuration with SquishSwitch */}
              <div className="staff-pin-toggle-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>Configurar PIN de acceso</strong>
                    <p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>
                      Opcional. Si está desactivado, el empleado entrará directamente sin clave.
                    </p>
                  </div>
                  <SquishSwitch
                    checked={hasPin}
                    onChange={(checked) => {
                      setHasPin(checked);
                      if (!checked) {
                        setPin1('');
                        setPin2('');
                      }
                    }}
                    ariaLabel="Activar PIN de acceso"
                    trackOnColor="var(--color-primary)"
                    thumbOnColor="var(--color-primary-text)"
                  />
                </div>

                {hasPin && (
                  <div className="staff-2phase-pin-container">
                    {/* Phase 1 */}
                    <div className="pin-phase-box">
                      <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                        1. Ingresa el PIN (4 dígitos)
                      </label>
                      <CodeSlots
                        length={4}
                        value={pin1}
                        onChange={setPin1}
                        mask
                        autoFocus
                        ariaLabel="Primer ingreso del PIN"
                        accentColor="var(--color-primary)"
                        slotColor="var(--color-canvas)"
                        inkColor="var(--color-ink)"
                        digitColor="var(--color-ink)"
                      />
                    </div>

                    {/* Phase 2: Confirmation */}
                    <div className="pin-phase-box">
                      <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                        2. Confirma el PIN (repite los 4 dígitos)
                      </label>
                      <CodeSlots
                        length={4}
                        value={pin2}
                        onChange={setPin2}
                        mask
                        ariaLabel="Confirmación del PIN"
                        status={pinStatus}
                        accentColor="var(--color-primary)"
                        slotColor="var(--color-canvas)"
                        inkColor="var(--color-ink)"
                        digitColor="var(--color-ink)"
                      />
                    </div>

                    {pinValidationMsg && (
                      <p
                        className={pinStatus === 'success' ? 'pin-confirm-success' : 'staff-pin-error'}
                        role="status"
                      >
                        {pinValidationMsg}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="staff-modal-actions">
                <Button variant="secondary" onClick={closeModal}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={hasPin && (pin1.length < 4 || pin2.length < 4 || pin1 !== pin2)}
                >
                  {editingId ? 'Guardar cambios' : 'Crear perfil'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SwipeToast notification */}
      {toast && (
        <div className="staff-toast-wrapper">
          <SwipeToast
            open={toast.open}
            title={toast.title}
            description={toast.description}
            duration={3200}
            fuse={toast.type === 'error' ? 'none' : 'bottom'}
            closeButton
            closeLabel="Cerrar notificación"
            background="var(--color-surface)"
            color="var(--color-ink)"
            fuseColor={toast.type === 'error' ? 'var(--catalog-field-error, #A32222)' : 'var(--color-primary)'}
            onClose={() => setToast(null)}
          />
        </div>
      )}

      {/* Device Pairing Modal */}
      {pairingStaff && (
        <DevicePairingModal
          isOpen={Boolean(pairingStaff)}
          staff={pairingStaff}
          onClose={() => setPairingStaff(null)}
        />
      )}
    </div>
  );
}
