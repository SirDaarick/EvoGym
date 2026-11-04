import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={tone === 'danger' ? 'ui-dialog__confirm--danger' : ''}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
