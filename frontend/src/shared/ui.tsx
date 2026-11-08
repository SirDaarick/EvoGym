import { cloneElement, isValidElement, useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Dialog } from './components/ui/Dialog';
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const { children, disabled, onClick, style, ...buttonProps } = props;
  const [spark, setSpark] = useState<{ id: number; x: string; y: string } | null>(null);
  const sparkId = useRef(0);

  function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    const ariaDisabled = buttonProps['aria-disabled'] === true || buttonProps['aria-disabled'] === 'true';
    const reducedMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    if (!disabled && !ariaDisabled && !reducedMotion) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const keyboardActivation = event.detail === 0;
      setSpark({
        id: ++sparkId.current,
        x: keyboardActivation ? '50%' : `${event.clientX - bounds.left}px`,
        y: keyboardActivation ? '50%' : `${event.clientY - bounds.top}px`,
      });
    }
    onClick?.(event);
  }

  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`.trim()}
      {...buttonProps}
      disabled={disabled}
      style={{ ...style, ...(spark ? ({ '--click-spark-x': spark.x, '--click-spark-y': spark.y } as CSSProperties) : {}) }}
      onClick={handleClick}
    >
      {children}
      {spark && <span key={spark.id} aria-hidden="true" className="click-spark" onAnimationEnd={() => setSpark(null)} />}
    </button>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`.trim()}>{children}</section>;
}
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: ReactNode; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{action}</header>;
}
export type Tone = 'neutral' | 'success' | 'warning' | 'error';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2><p className="muted">{children}</p></div>;
}
export function Field({ label, id, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; error?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...props} />
    {error && <p id={`${id}-error`} className="field-error">{error}</p>}</div>;
}
/**
 * Wraps any single form control (input, select, textarea, ...). Wires the control's
 * aria-invalid / aria-describedby to the inline error text (`${id}-error`).
 */
export function FormField({ label, id, error, children, className = '', style }: { label: ReactNode; id: string; error?: string; children: ReactElement<Record<string, unknown>>; className?: string; style?: CSSProperties }) {
  const errorId = `${id}-error`;
  const control = isValidElement(children)
    ? cloneElement(children, {
      id,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': [children.props['aria-describedby'], error ? errorId : undefined].filter(Boolean).join(' ') || undefined,
    })
    : children;
  return <div className={`field ${className}`.trim()} style={style}><label htmlFor={id}>{label}</label>{control}
    {error && <p id={errorId} className="field-error">{error}</p>}</div>;
}

/** Per-field inline validation state. Keys are field names; clear a key when its field changes. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clear = useCallback((key: string) => setErrors(prev => {
    if (!(key in prev)) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  }), []);
  const clearAll = useCallback(() => setErrors({}), []);
  return { errors, setErrors, clear, clearAll };
}

/** Focuses the first control (by DOM id) in the list. Call right after setting errors. */
export function focusFirstInvalid(ids: Array<string | undefined | false>) {
  const id = ids.find(Boolean);
  if (id) document.getElementById(id)?.focus();
}

export function TableRegion({ children, label }: { children: ReactNode; label: string }) {
  return <div className="table-region" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId?: string;
  children: ReactNode;
  actions?: ReactNode;
  maxWidth?: string;
  isSubmitting?: boolean;
  className?: string;
  cardClassName?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  actions,
  maxWidth = '440px',
  isSubmitting = false,
  className = '',
  cardClassName = '',
}: ModalProps) {
  // titleId is kept for API compatibility; Dialog generates its own accessible ids.
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={title}
      footer={actions}
      maxWidth={maxWidth}
      dismissible={!isSubmitting}
      className={className}
      panelClassName={cardClassName}
    >
      {children}
    </Dialog>
  );
}
