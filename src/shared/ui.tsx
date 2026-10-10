import { useRef, useState } from 'react';
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

  return <button type="button" className={`button button-${variant} ${className}`} {...buttonProps} disabled={disabled} style={{ ...style, ...(spark ? { '--click-spark-x': spark.x, '--click-spark-y': spark.y } as CSSProperties : {}) }} onClick={handleClick}>
    {children}
    {spark && <span key={spark.id} aria-hidden="true" className="click-spark" onAnimationEnd={() => setSpark(null)} />}
  </button>;
}
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel spotlight-card ${className}`} onPointerMove={event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--spotlight-x', `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty('--spotlight-y', `${event.clientY - bounds.top}px`);
  }}>{children}</section>;
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
