import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Button } from '../shared/ui';
import logo from '../assets/evogym-logo-128.webp';

export type ShellIconName = 'home' | 'overview' | 'alerts' | 'attendance' | 'expenses' | 'members' | 'sales' | 'shifts' | 'inventory' | 'staff' | 'history' | 'plans' | 'gimi' | 'profile' | 'components';

export interface ProductNavigationItem {
  label: string;
  to?: string;
  icon?: ShellIconName;
  disabled?: boolean;
  onClick?: () => void;
}

const navIcons: Record<ShellIconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
  overview: <><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>,
  alerts: <><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></>,
  attendance: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11l-3-3-3 3" /></>,
  expenses: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M14 8H8M16 12H8M13 16H8" /></>,
  members: <><circle cx="9" cy="8" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2zM16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 4 5" /></>,
  sales: <><path d="M3 7h18l-2 13H5zM8 7V5a4 4 0 0 1 8 0v2" /></>,
  shifts: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  inventory: <><path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></>,
  staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  history: <><path d="M3 12a9 9 0 1 1 3 6.7M3 17v-5h5M12 7v5l4 2" /></>,
  plans: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  gimi: <><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-7z" /><circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" /><path d="M9 18h6" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  components: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
};

function NavIcon({ name }: { name: ShellIconName }) {
  return <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{navIcons[name]}</svg>;
}

function SunIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41-1.41" /></svg>;
}

function MoonIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>;
}

function initialDarkMode() {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
}

export function ApplicationShell({ items, brandTo = '/', caption = 'Acceso verificado', headerContent, headerActionsBeforeTheme, headerActionsAfterTheme, sidebarBottomItems = [], sidebarBottom, footer, beforeMain, afterMain, children, debugPerformance = false }: {
  items: ProductNavigationItem[];
  brandTo?: string;
  caption?: string;
  headerContent?: ReactNode;
  headerActionsBeforeTheme?: ReactNode;
  headerActionsAfterTheme?: ReactNode;
  sidebarBottomItems?: ProductNavigationItem[];
  sidebarBottom?: ReactNode;
  footer?: ReactNode;
  beforeMain?: ReactNode;
  afterMain?: ReactNode;
  children: ReactNode;
  debugPerformance?: boolean;
}) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const [dark, setDark] = useState(initialDarkMode);
  const isPointerRef = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const mobileNavOpener = useRef<HTMLButtonElement>(null);
  const mobileNavClose = useRef<HTMLButtonElement>(null);
  const sidebarElement = useRef<HTMLElement>(null);
  const sidebarExpanded = sidebarPinned || sidebarHovered || sidebarFocused;

  function closeMobileNav() {
    if (!mobileNavOpen) return;
    setMobileNavOpen(false);
    const focusTarget = window.matchMedia?.('(min-width: 721px)').matches
      ? document.getElementById('main-content')
      : mobileNavOpener.current;
    queueMicrotask(() => focusTarget?.focus());
  }

  useEffect(() => {
    setSidebarHovered(false);
    setSidebarFocused(false);
    closeMobileNav();
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    mobileNavClose.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMobileNav();
    }
    document.addEventListener('keydown', closeOnEscape);
    function containFocus(event: FocusEvent) {
      if (window.matchMedia?.('(min-width: 721px)').matches) return;
      if (!sidebarElement.current?.contains(event.target as Node)) mobileNavClose.current?.focus();
    }
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('focusin', containFocus);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const desktop = window.matchMedia?.('(min-width: 721px)');
    if (!desktop) return;
    function resetForDesktop(event: MediaQueryListEvent | MediaQueryList) {
      if (event.matches) closeMobileNav();
    }
    resetForDesktop(desktop);
    desktop.addEventListener?.('change', resetForDesktop);
    return () => desktop.removeEventListener?.('change', resetForDesktop);
  }, [mobileNavOpen]);

  useEffect(() => {
    function syncTheme() {
      const theme = document.documentElement.dataset.theme;
      setDark(theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  function startTouch(event: TouchEvent<HTMLDivElement>) {
    touchStart.current = null;
    if (event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if ((window.getSelection()?.toString().length ?? 0) > 0 || target.closest('input, textarea, select, button, a, [contenteditable="true"], [data-horizontal-scroll], .animated-list__viewport, [role="listbox"], [role="dialog"]')) return;
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function endTouch(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (event.touches.length > 0 || event.changedTouches.length !== 1 || (window.getSelection()?.toString().length ?? 0) > 0) return;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx > 0 && start.x >= 24 && start.x <= 48) setMobileNavOpen(true);
  }

  return <div className="app-shell" data-testid="application-shell" onTouchStart={startTouch} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={endTouch}>
    <a href="#main-content" className="skip-link" inert={mobileNavOpen}>Ir al contenido</a>
    {mobileNavOpen && <div className="mobile-nav-backdrop" aria-hidden="true" onClick={closeMobileNav} />}
    <aside ref={sidebarElement} className="sidebar" aria-label={mobileNavOpen ? 'Navegación principal' : 'Barra lateral'} role={mobileNavOpen ? 'dialog' : undefined} aria-modal={mobileNavOpen ? true : undefined} data-mobile-open={mobileNavOpen} data-expanded={sidebarExpanded} onClickCapture={event => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (debugPerformance && link) console.info('[evogym:perf] Sidebar navigation click', { from: location.pathname, to: link.pathname, label: link.getAttribute('aria-label') ?? link.textContent?.trim() });
      if (link) closeMobileNav();
    }} onKeyDownCapture={event => {
      if (mobileNavOpen && event.key === 'Tab') {
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element => element.tabIndex >= 0);
        if (focusable.length === 0) event.preventDefault();
        else {
          const first = focusable[0]; const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
      }
      isPointerRef.current = false;
      if (event.currentTarget.contains(document.activeElement)) setSidebarFocused(true);
    }} onPointerDownCapture={() => { isPointerRef.current = true; setSidebarFocused(false); }} onMouseEnter={() => setSidebarHovered(true)} onMouseLeave={() => { setSidebarHovered(false); if (isPointerRef.current) setSidebarFocused(false); }} onFocus={event => {
      if (isPointerRef.current) return;
      if ((event.target as HTMLElement)?.matches?.(':focus-visible')) setSidebarFocused(true);
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSidebarFocused(false); }}>
      <div className="sidebar-head"><Link className="brand" to={brandTo} title="EvoGym"><img src={logo} alt="EvoGym" width={128} height={124} /><span aria-hidden="true">EvoGym</span></Link>
        <button ref={mobileNavClose} className="mobile-nav-close" type="button" tabIndex={mobileNavOpen ? 0 : -1} aria-label="Cerrar navegación" onClick={closeMobileNav}>×</button>
        <button className="sidebar-toggle" type="button" aria-label={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'} aria-pressed={sidebarPinned} aria-expanded={sidebarExpanded} onClick={() => setSidebarPinned(value => !value)} title={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'}><span aria-hidden="true">{sidebarPinned ? '‹' : '›'}</span></button></div>
      <p className="sidebar-caption">{caption}</p>
      <nav aria-label="Navegación principal">{items.map(item => item.to
        ? <NavLink key={item.label} to={item.to} aria-label={item.label} title={item.label} onClick={() => setMobileNavOpen(false)}>{item.icon && <NavIcon name={item.icon} />}<span className="sidebar-label" aria-hidden="true">{item.label}</span></NavLink>
        : <button key={item.label} type="button" disabled aria-label={`${item.label} · No disponible`} title="No disponible en esta sesión">{item.icon && <NavIcon name={item.icon} />}<span className="sidebar-label">{item.label} · No disponible</span></button>)}</nav>
      {(sidebarBottomItems.length > 0 || sidebarBottom) && <div className="sidebar-bottom">
        {sidebarBottomItems.map(item => item.to
          ? <NavLink key={item.label} to={item.to} aria-label={item.label} title={item.label} onClick={() => setMobileNavOpen(false)}>{item.icon && <NavIcon name={item.icon} />}<span className="sidebar-label" aria-hidden="true">{item.label}</span></NavLink>
          : <button key={item.label} type="button" disabled={item.disabled} aria-label={item.label} title={item.label} onClick={item.onClick}>{item.icon && <NavIcon name={item.icon} />}<span className="sidebar-label" aria-hidden="true">{item.label}</span></button>)}
        {sidebarBottom}
      </div>}
    </aside>
    <div className="workspace" inert={mobileNavOpen}>
      <header className="demo-bar">
        <button ref={mobileNavOpener} className="mobile-brand-opener" type="button" aria-label="Abrir navegación" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><img src={logo} alt="" width={32} height={32} /></button>
        <div className="header-left-spacer" aria-hidden="true" />
        <div className="header-search-group">{headerContent}</div>
        <div className="header-actions">{headerActionsBeforeTheme}<Button variant="secondary" className="header-action-control header-icon-control theme-toggle" aria-pressed={dark} onClick={toggleTheme} aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'} title={dark ? 'Usar tema claro' : 'Usar tema oscuro'}><span className="theme-toggle-icon" aria-hidden="true">{dark ? <SunIcon /> : <MoonIcon />}</span></Button>{headerActionsAfterTheme}</div>
      </header>
      {beforeMain}
      <main id="main-content" tabIndex={-1}>{children}</main>
      {afterMain}
      {footer}
    </div>
  </div>;
}
