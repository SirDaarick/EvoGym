import { useEffect, useRef, useState, type ReactNode } from 'react';
import './MobileDetailPanel.css';

interface MobileDetailPanelProps {
  title: string;
  triggerLabel: string;
  children: ReactNode;
  contentClassName?: string;
  className?: string;
}

export function MobileDetailPanel({ title, triggerLabel, children, contentClassName = '', className = '' }: MobileDetailPanelProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const titleId = `mobile-detail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  function close() {
    if (!open) return;
    setOpen(false);
    const focusTarget = window.matchMedia?.('(min-width: 721px)').matches ? document.getElementById('main-content') : triggerRef.current;
    queueMicrotask(() => focusTarget?.focus());
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const previousInert = new Map<HTMLElement, boolean>();
    let branch: HTMLElement | null = dialogRef.current;
    while (branch && branch !== document.querySelector('.app-shell')) {
      const parent = branch.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.classList.contains('mobile-detail-backdrop')) {
          previousInert.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      branch = parent;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const activeElement = document.activeElement;
        const nestedPopupOpen = activeElement instanceof HTMLElement
          && activeElement.getAttribute('role') === 'combobox'
          && activeElement.getAttribute('aria-expanded') === 'true';
        if (!nestedPopupOpen) close();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element => element.tabIndex >= 0);
      if (focusable.length === 0) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    function containFocus(event: FocusEvent) {
      if (!dialogRef.current?.contains(event.target as Node)) closeRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', containFocus);
      for (const [element, wasInert] of previousInert) element.inert = wasInert;
    };
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia?.('(min-width: 721px)');
    if (!desktop) return;
    const reset = (event: MediaQueryListEvent | MediaQueryList) => { if (event.matches) close(); };
    reset(desktop);
    desktop.addEventListener?.('change', reset);
    return () => desktop.removeEventListener?.('change', reset);
  }, [open]);

  function startTouch(event: React.TouchEvent<HTMLDivElement>) {
    touchStart.current = null;
    if (event.touches.length !== 1 || (window.getSelection()?.toString().length ?? 0) > 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-horizontal-scroll], .animated-list__viewport, [role="listbox"]')) return;
    const touch = event.touches[0];
    if (touch.clientX < window.innerWidth - 96 || touch.clientX > window.innerWidth - 32) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function endTouch(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || event.touches.length > 0 || event.changedTouches.length !== 1 || (window.getSelection()?.toString().length ?? 0) > 0) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx <= -80 && Math.abs(dx) >= Math.abs(dy) * 1.4) setOpen(true);
  }

  return <div className={`mobile-detail-panel ${className}`.trim()} data-open={open} onTouchStart={startTouch} onTouchEnd={endTouch} onTouchCancel={() => { touchStart.current = null; }}>
    <button ref={triggerRef} type="button" className="mobile-detail-trigger" aria-label={triggerLabel} aria-expanded={open} onClick={() => setOpen(true)}>{triggerLabel}</button>
    {open && <div className="mobile-detail-backdrop" aria-hidden="true" onClick={close} />}
    <div ref={dialogRef} className="mobile-detail-dialog" role={open ? 'dialog' : undefined} aria-modal={open ? true : undefined} aria-labelledby={titleId}>
      <header className="mobile-detail-header"><span id={titleId}>{title}</span><button ref={closeRef} type="button" className="mobile-detail-close" tabIndex={open ? 0 : -1} onClick={close} aria-label="Cerrar detalles">×</button></header>
      <div className={`mobile-detail-content ${contentClassName}`.trim()}>{children}</div>
    </div>
  </div>;
}
