import { useEffect, useRef, useState } from 'react';
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
export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
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
  titleId = 'modal-title',
  children,
  actions,
  maxWidth = '440px',
  isSubmitting = false,
  className = '',
  cardClassName = '',
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={`staff-modal-overlay ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={e => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className={`staff-modal-card ${cardClassName}`.trim()}
        style={{ maxWidth, textAlign: 'left', alignItems: 'stretch' }}
      >
        <div
          className="staff-modal-header"
          style={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <button
            type="button"
            className="staff-modal-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>
        {children}
        {actions && <div className="staff-modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
