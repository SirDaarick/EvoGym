import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/components/ui';

interface Props {
  pin: string;
  description: string;
  /** Shown above the PIN when the dialog should name the employee. */
  employeeName?: string;
  onClose: () => void;
}

export function IssuedPinDialog({ pin, description, employeeName, onClose }: Props) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="PIN Inicial Generado"
      description={description}
      maxWidth="420px"
      hideCloseButton
      footer={<Button variant="primary" onClick={onClose}>Entendido y copiado</Button>}
    >
      <div style={{ padding: '16px', background: 'var(--color-canvas)', borderRadius: '12px', textAlign: 'center' }}>
        {employeeName && <span className="muted" style={{ fontSize: '13px' }}>Empleado: {employeeName}</span>}
        <p style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '8px', margin: '12px 0', color: 'var(--color-primary-ink)' }}>{pin}</p>
      </div>
    </Dialog>
  );
}
