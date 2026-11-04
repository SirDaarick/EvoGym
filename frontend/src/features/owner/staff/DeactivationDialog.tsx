import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/components/ui';
import type { DeactivationState } from './useStaffAccountActions';

interface Props {
  state: DeactivationState;
  busy: boolean;
  onResolve: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeactivationDialog({ state, busy, onResolve, onConfirm, onClose }: Props) {
  const { pending, active, profile } = state;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      hideCloseButton
      title={`Desactivar cuenta de ${profile.full_name}`}
      footer={<Button variant="secondary" disabled={busy} onClick={onClose}>Cerrar</Button>}
    >
      {pending ? <>
        <p>Hay una venta pendiente por ${(pending.payload.expected_total_minor / 100).toFixed(2)}. Resuélvela antes de desactivar la cuenta.</p>
        <p>Caja: {pending.register_id}. Productos: {pending.payload.items.reduce((sum, item) => sum + item.quantity, 0)}.</p>
        <p>Al resolverla, se confirmará si ya se registró; si no, el intento se cancelará para impedir un cobro tardío.</p>
        <Button disabled={busy} onClick={onResolve}>Resolver venta pendiente</Button>
      </> : active ? <>
        <p>Se revocarán las sesiones y dispositivos vinculados a esta cuenta.</p>
        <Button disabled={busy} onClick={onConfirm}>Confirmar desactivación de cuenta</Button>
      </> : <p>Esta cuenta está inactiva y no tiene ventas pendientes.</p>}
    </Dialog>
  );
}
