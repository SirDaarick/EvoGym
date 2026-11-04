import { useState } from 'react';
import { Button, Field } from '@/shared/ui';
import { Dialog } from '@/shared/components/ui';
import { parseMoney } from '@/shared/formatters/money';
import JellyRadio from '@/features/catalog/react-bits/JellyRadio';
import SquishSwitch from '@/features/catalog/react-bits/SquishSwitch';
import CodeSlots, { type CodeSlotsStatus } from '@/features/catalog/react-bits/CodeSlots';
import type { StaffProfile } from '@/features/staff/staffStore';

export interface StaffFormValues {
  name: string;
  shift: string;
  salaryMinor: number;
  active: boolean;
  hasPin: boolean;
  pin: string;
}

interface Props {
  /** Profile being edited, or `null` to create a new receptionist. */
  staff: StaffProfile | null;
  onSave: (values: StaffFormValues) => void;
  onClose: () => void;
}

const labelStyle = { fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' } as const;
const slotColors = {
  accentColor: 'var(--color-primary)', slotColor: 'var(--color-canvas)', inkColor: 'var(--color-ink)', digitColor: 'var(--color-ink)',
} as const;

export function StaffFormModal({ staff, onSave, onClose }: Props) {
  const [name, setName] = useState(staff?.name ?? '');
  const [shift, setShift] = useState(staff?.shift ?? 'Matutino');
  const [salaryText, setSalaryText] = useState(staff?.salaryMinor ? (staff.salaryMinor / 100).toString() : '8000');
  const [isActive, setIsActive] = useState(staff?.active ?? true);
  const [hasPin, setHasPin] = useState(staff?.hasPin ?? false);
  const [pin1, setPin1] = useState(staff?.hasPin ? (staff.pin ?? '1234') : '');
  const [pin2, setPin2] = useState(staff?.hasPin ? (staff.pin ?? '1234') : '');
  const [errors, setErrors] = useState<{ name?: string; salary?: string; pin?: string }>({});

  // 2-phase PIN status
  const pinReady = pin1.length === 4 && pin2.length === 4;
  const pinsMatch = pin1 === pin2;
  const pinStatus: CodeSlotsStatus = hasPin && pinReady && pinsMatch ? 'success' : 'idle';
  const pinMessage = hasPin && pinReady
    ? (pinsMatch ? '✓ PIN confirmado correctamente' : 'Los PINs no coinciden. Por favor verifica.')
    : '';
  const pinInvalid = hasPin && (!pinReady || !pinsMatch);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const salaryMinor = parseMoney(salaryText);
    if (!name.trim()) next.name = 'Ingresa el nombre completo.';
    if (salaryMinor === null || salaryMinor < 0) next.salary = 'Ingresa un sueldo mensual válido.';
    if (pinInvalid) next.pin = 'Debes ingresar y confirmar el mismo PIN de 4 dígitos.';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave({ name: name.trim(), shift, salaryMinor: salaryMinor!, active: isActive, hasPin, pin: hasPin ? pin1 : '' });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      hideCloseButton
      size="lg"
      title={staff ? 'Editar Recepcionista' : 'Nuevo Recepcionista'}
      description="Registra los datos de acceso, turno y remuneración del empleado"
    >
      <form onSubmit={handleSubmit} className="staff-form">
        <Field id="staff-name-input" label="Nombre completo *" type="text" required value={name} error={errors.name}
          onChange={e => setName(e.target.value)} placeholder="Ej. Valeria Morales" autoFocus />
        <div className="field-row">
          <div className="field">
            <label htmlFor="staff-shift-select">Turno asignado</label>
            <select id="staff-shift-select" value={shift} onChange={e => setShift(e.target.value)}>
              <option value="Matutino">Matutino (06:00 - 14:00)</option>
              <option value="Vespertino">Vespertino (14:00 - 22:00)</option>
              <option value="Mixto">Mixto</option>
              <option value="Fin de semana">Fin de semana</option>
            </select>
          </div>
          <Field id="staff-salary-input" label="Sueldo mensual (MXN) *" type="number" step="50" min="0" required
            value={salaryText} error={errors.salary} onChange={e => setSalaryText(e.target.value)} placeholder="8000" />
        </div>
        <div className="field">
          <label style={labelStyle}>Estado de la cuenta</label>
          <JellyRadio items={[{ value: 'active', label: '● Activo' }, { value: 'inactive', label: '○ Inactivo' }]}
            value={isActive ? 'active' : 'inactive'} onChange={val => setIsActive(val === 'active')} size="sm"
            chipColor="var(--color-surface-soft, #242424)" activeColor="var(--color-primary, #FC6C06)"
            textColor="var(--color-muted, #a3a3a3)" activeTextColor="#080808" ariaLabel="Estado de la cuenta" />
        </div>

        <div className="staff-pin-toggle-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Configurar PIN de acceso</strong>
              <p className="muted" style={{ fontSize: '12px', margin: '2px 0 0' }}>
                Opcional. Si está desactivado, el empleado entrará directamente sin clave.
              </p>
            </div>
            <SquishSwitch checked={hasPin} onChange={checked => { setHasPin(checked); if (!checked) { setPin1(''); setPin2(''); } }}
              ariaLabel="Activar PIN de acceso" trackOnColor="var(--color-primary)" thumbOnColor="var(--color-primary-text)" />
          </div>
          {hasPin && (
            <div className="staff-2phase-pin-container">
              <div className="pin-phase-box">
                <label style={labelStyle}>1. Ingresa el PIN (4 dígitos)</label>
                <CodeSlots length={4} value={pin1} onChange={setPin1} mask autoFocus ariaLabel="Primer ingreso del PIN" {...slotColors} />
              </div>
              <div className="pin-phase-box">
                <label style={labelStyle}>2. Confirma el PIN (repite los 4 dígitos)</label>
                <CodeSlots length={4} value={pin2} onChange={setPin2} mask ariaLabel="Confirmación del PIN" status={pinStatus} {...slotColors} />
              </div>
              {pinMessage && <p className={pinStatus === 'success' ? 'pin-confirm-success' : 'staff-pin-error'} role="status">{pinMessage}</p>}
              {errors.pin && !pinMessage && <p className="field-error" role="alert">{errors.pin}</p>}
            </div>
          )}
        </div>

        <div className="staff-modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={pinInvalid}>{staff ? 'Guardar cambios' : 'Crear perfil'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
