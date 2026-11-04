import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  maxWidth?: string;
  closeLabel?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  panelClassName?: string;
  hideCloseButton?: boolean;
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function getTabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex >= 0,
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  maxWidth,
  closeLabel = 'Cerrar',
  dismissible = true,
  initialFocusRef,
  className = '',
  panelClassName = '',
  hideCloseButton = false,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();

    const target =
      initialFocusRef?.current ??
      (bodyRef.current ? getTabbables(bodyRef.current)[0] : undefined) ??
      panelRef.current;
    target?.focus();

    return () => {
      if (dialog.open) dialog.close();
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      if (previous && previous.isConnected) previous.focus();
    };
    // initialFocusRef is read only at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      // Handled here (and preventDefault) so the native cancel event does not fire twice; jsdom never fires it.
      event.preventDefault();
      if (dismissible) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const tabbables = getTabbables(dialog);
    if (tabbables.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = tabbables[0];
    const last = tabbables[tabbables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // A press that started inside the panel (e.g. a drag-select) and is released on the
  // backdrop must not close the dialog: both mousedown and click must hit the dialog element.
  const pressStartedInPanel = useRef(false);

  function handleMouseDown(event: ReactMouseEvent<HTMLDialogElement>) {
    pressStartedInPanel.current = event.target !== event.currentTarget;
  }

  function handleClick(event: ReactMouseEvent<HTMLDialogElement>) {
    const startedInPanel = pressStartedInPanel.current;
    pressStartedInPanel.current = false;
    if (event.target === event.currentTarget && !startedInPanel && dismissible) onClose();
  }

  const style = maxWidth ? ({ '--ui-dialog-max-width': maxWidth } as CSSProperties) : undefined;

  return (
    <dialog
      ref={dialogRef}
      className={`ui-dialog ui-dialog--${size} ${className}`.trim()}
      style={style}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={event => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {open && (
        <div ref={panelRef} className={`ui-dialog__panel ${panelClassName}`.trim()} tabIndex={-1}>
          <div className="ui-dialog__header">
            <h2 id={titleId} className="ui-dialog__title">{title}</h2>
            {!hideCloseButton && (
              <button
                type="button"
                className="ui-dialog__close"
                onClick={onClose}
                disabled={!dismissible}
                aria-label={closeLabel}
              >
                <span aria-hidden="true">✕</span>
              </button>
            )}
          </div>
          {description && <p id={descriptionId} className="ui-dialog__description">{description}</p>}
          <div ref={bodyRef} className="ui-dialog__body">{children}</div>
          {footer && <div className="ui-dialog__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
