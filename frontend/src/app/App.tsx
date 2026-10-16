import { Profiler, lazy, useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { Role } from '../domain/models';
import { useDemo } from '../demo/DemoProvider';
import { MemberSearch } from '../features/members/MemberSearch';
import { GimiChatWidget } from '../features/gimi/GimiChatWidget';
import { Button } from '../shared/ui';
import { PwaInstallPrompt } from '../shared/PwaInstallPrompt';
import { homePath, navigation, rolePath } from './navigation';
import logo from '../assets/evogym-logo-128.webp';

import { RouteBoundary } from './RouteBoundary';

const ComponentCatalog = lazy(() => import('../features/catalog/ComponentCatalog').then(module => ({ default: module.ComponentCatalog })));
const MembershipPayment = lazy(() => import('../features/payments/MembershipPayment').then(module => ({ default: module.MembershipPayment })));
const Sales = lazy(() => import('../features/sales/Sales').then(module => ({ default: module.Sales })));
const Inventory = lazy(() => import('../features/inventory/Inventory').then(module => ({ default: module.Inventory })));
const Shifts = lazy(() => import('../features/shifts/Shifts').then(module => ({ default: module.Shifts })));
const Overview = lazy(() => import('../features/owner/Overview').then(module => ({ default: module.Overview })));
const AlertCenter = lazy(() => import('../features/owner/AlertCenter').then(module => ({ default: module.AlertCenter })));
const AttendanceAnalytics = lazy(() => import('../features/owner/AttendanceAnalytics').then(module => ({ default: module.AttendanceAnalytics })));
const ExpenseReport = lazy(() => import('../features/owner/ExpenseReport').then(module => ({ default: module.ExpenseReport })));
const History = lazy(() => import('../features/owner/History').then(module => ({ default: module.History })));
const PlanCatalog = lazy(() => import('../features/owner/PlanCatalog').then(module => ({ default: module.PlanCatalog })));
const ReceptionHome = lazy(() => import('../features/reception/ReceptionHome').then(module => ({ default: module.ReceptionHome })));
const StaffProfileSelection = lazy(() => import('../features/staff/StaffProfileSelection').then(module => ({ default: module.StaffProfileSelection })));
const StaffManagement = lazy(() => import('../features/owner/StaffManagement').then(module => ({ default: module.StaffManagement })));
const GimiDashboard = lazy(() => import('../features/gimi/GimiDashboard').then(module => ({ default: module.GimiDashboard })));
const Members = lazy(() => import('../features/members/Members').then(module => ({ default: module.Members })));
const MemberDetail = lazy(() => import('../features/members/Members').then(module => ({ default: module.MemberDetail })));
const NewMember = lazy(() => import('../features/members/Members').then(module => ({ default: module.NewMember })));

const navIcons: Record<string, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
  overview: <><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>,
  alerts: <><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></>,
  attendance: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11l-3-3-3 3" /></>,
  expenses: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M14 8H8" /><path d="M16 12H8" /><path d="M13 16H8" /></>,
  members: <><circle cx="9" cy="8" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2zM16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 4 5" /></>,
  sales: <><path d="M3 7h18l-2 13H5zM8 7V5a4 4 0 0 1 8 0v2" /></>,
  shifts: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  inventory: <><path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></>,
  staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  history: <><path d="M3 12a9 9 0 1 1 3 6.7M3 17v-5h5M12 7v5l4 2" /></>,
  plans: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  gimi: <><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-7z" /><circle cx="9" cy="14" r="1" /><circle cx="15" cy="14" r="1" /><path d="M9 18h6" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  components: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
};

function NavIcon({ name }: { name: string }) {
  return <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{navIcons[name]}</svg>;
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function formatCurrentTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} hrs`;
}

function readPerformanceDebugFlag() {
  if (typeof window === 'undefined') return false;
  const queryFlag = new URLSearchParams(window.location.search).get('debugPerf');
  try {
    if (queryFlag === '1') window.sessionStorage.setItem('evogym:debug-performance', '1');
    if (queryFlag === '0') window.sessionStorage.removeItem('evogym:debug-performance');
    return window.sessionStorage.getItem('evogym:debug-performance') === '1';
  } catch {
    return queryFlag === '1';
  }
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { reset, resetVersion } = useDemo();
  const [debugPerformance] = useState(readPerformanceDebugFlag);
  const [catalogRole, setCatalogRole] = useState<Role>(location.pathname.startsWith('/reception/') ? 'RECEPTION' : 'OWNER');
  const [message, setMessage] = useState('');
  const [clockStr, setClockStr] = useState<string>(formatCurrentTime);
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });
  const isPointerRef = useRef(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const sidebarExpanded = sidebarPinned || sidebarHovered || sidebarFocused;
  const role: Role = location.pathname.startsWith('/reception/') ? 'RECEPTION' : location.pathname.startsWith('/owner/') ? 'OWNER' : catalogRole;
  const items = navigation.filter(item => item.roles.includes(role));

  useEffect(() => {
    // Reset transient expansion on route transitions
    setSidebarHovered(false);
    setSidebarFocused(false);
  }, [location.pathname]);

  useEffect(() => {
    function syncTheme() {
      const theme = document.documentElement.dataset.theme;
      if (theme) {
        setDark(theme === 'dark');
      } else {
        setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
      }
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

  useEffect(() => {
    const timer = setInterval(() => {
      const next = formatCurrentTime();
      setClockStr(prev => (prev === next ? prev : next));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!debugPerformance) return;
    if (!('PerformanceObserver' in window) || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      console.info('[evogym:perf] Long Task API is not available; React Profiler measurements remain enabled.');
      return;
    }
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        console.warn('[evogym:perf] Main-thread long task', {
          route: window.location.pathname,
          durationMs: Math.round(entry.duration),
          startTimeMs: Math.round(entry.startTime),
        });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
    return () => observer.disconnect();
  }, [debugPerformance]);

  useEffect(() => {
    if (location.pathname.startsWith('/owner/')) setCatalogRole('OWNER');
    if (location.pathname.startsWith('/reception/')) setCatalogRole('RECEPTION');
  }, [location.pathname]);

  function switchRole(next: Role) {
    setCatalogRole(next);
    const slug = location.pathname.split('/')[2];
    navigate(items.some(item => item.slug === slug) && navigation.find(item => item.slug === slug)?.roles.includes(next)
      ? rolePath(next, slug) : homePath(next));
  }

  if (location.pathname === '/') return <RouteBoundary key="profiles"><StaffProfileSelection /></RouteBoundary>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="sidebar" aria-label="Barra lateral" data-expanded={sidebarExpanded} onClickCapture={event => {
      if (!debugPerformance || !(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (link) console.info('[evogym:perf] Sidebar navigation click', {
        from: location.pathname,
        to: link.pathname,
        label: link.getAttribute('aria-label') ?? link.textContent?.trim(),
      });
    }} onPointerDownCapture={() => {
      isPointerRef.current = true;
      setSidebarFocused(false);
    }} onKeyDownCapture={event => {
      isPointerRef.current = false;
      if (event.currentTarget.contains(document.activeElement)) setSidebarFocused(true);
    }} onMouseEnter={() => setSidebarHovered(true)} onMouseLeave={() => {
      setSidebarHovered(false);
      if (isPointerRef.current) setSidebarFocused(false);
    }} onFocus={event => {
      if (isPointerRef.current) return;
      if ((event.target as HTMLElement)?.matches?.(':focus-visible')) {
        setSidebarFocused(true);
      }
    }} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setSidebarFocused(false);
      }
    }}>
      <div className="sidebar-head"><Link className="brand" to={homePath(role)} title="EvoGym"><img src={logo} alt="EvoGym" width={128} height={124} /><span aria-hidden="true">EvoGym</span></Link>
        <button className="sidebar-toggle" type="button" aria-label={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'} aria-pressed={sidebarPinned} aria-expanded={sidebarExpanded} onClick={() => setSidebarPinned(value => !value)} title={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'}><span aria-hidden="true">{sidebarPinned ? '‹' : '›'}</span></button></div>
      <p className="sidebar-caption">{role === 'OWNER' ? 'Vista de propietario' : 'Vista de recepción'}</p>
      <nav aria-label="Navegación principal">{items.map(item => <NavLink key={item.slug} to={rolePath(role, item.slug)} aria-label={item.label} title={item.label}><NavIcon name={item.slug} /><span className="sidebar-label" aria-hidden="true">{item.label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><Link to="/" aria-label="Cambiar perfil" title="Cambiar perfil"><NavIcon name="profile" /><span className="sidebar-label" aria-hidden="true">Cambiar perfil</span></Link><Link to="/components" aria-label="Sistema de componentes" title="Sistema de componentes"><NavIcon name="components" /><span className="sidebar-label" aria-hidden="true">Sistema de componentes</span></Link></div>
    </aside>
    <div className="workspace">
      <header className="demo-bar">
        <div className="header-left-spacer" aria-hidden="true" />
        <div className="header-search-group">
          <MemberSearch key={`${resetVersion}-${role}`} role={role} />
          <Link
            to={rolePath(role, 'members/new')}
            className="button button-primary header-new-btn"
            aria-label="Agregar socio"
            title="Registrar socio"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Nuevo</span>
          </Link>
        </div>
        <div className="header-actions">
          <div className="header-clock" aria-label="Hora actual" title="Hora actual">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span>{clockStr}</span>
          </div>
          <Button
            variant="secondary"
            className="theme-toggle"
            aria-pressed={dark}
            onClick={toggleTheme}
            aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'}
            title={dark ? 'Usar tema claro' : 'Usar tema oscuro'}
          >
            <span className="theme-toggle-icon" aria-hidden="true">
              {dark ? <SunIcon /> : <MoonIcon />}
            </span>
          </Button>
          <Link to="/" tabIndex={-1} className="button button-secondary header-profile-btn">Perfil</Link>
        </div>
      </header>
      <PwaInstallPrompt />
      <main id="main-content" tabIndex={-1}>
        <Profiler id="route-content" onRender={(id, phase, actualDuration, baseDuration) => {
          if (!debugPerformance) return;
          console.info('[evogym:perf] React route commit', {
            profilerId: id,
            route: location.pathname,
            phase,
            actualDurationMs: Math.round(actualDuration * 100) / 100,
            baseDurationMs: Math.round(baseDuration * 100) / 100,
          });
        }}>
        <RouteBoundary key={location.pathname}>
        <Routes>
          <Route path="/reception/home" element={<ReceptionHome key={resetVersion} />} />
          <Route path="/components" element={<ComponentCatalog />} />
          <Route path={rolePath(role, 'members')} element={<Members key={resetVersion} role={role} />} />
          <Route path={rolePath(role, 'members/new')} element={<NewMember key={resetVersion} role={role} />} />
          <Route path={rolePath(role, 'members/:memberId')} element={<MemberDetail role={role} />} />
          <Route path={rolePath(role, 'members/:memberId/payment')} element={<MembershipPayment key={`${resetVersion}-${location.pathname}`} role={role} />} />
          <Route path={rolePath(role, 'sales')} element={<Sales key={`${resetVersion}-${role}`} role={role} />} />
          <Route path={rolePath(role, 'inventory')} element={<Inventory key={`${resetVersion}-${role}`} role={role} />} />
          <Route path={rolePath(role, 'shifts')} element={<Shifts key={`${resetVersion}-${role}`} role={role} />} />
          {role === 'OWNER' && <>
            <Route path="/owner/overview" element={<Overview key={resetVersion} />} />
            <Route path="/owner/alerts" element={<AlertCenter key={resetVersion} />} />
            <Route path="/owner/attendance" element={<AttendanceAnalytics key={resetVersion} />} />
            <Route path="/owner/expenses" element={<ExpenseReport key={resetVersion} />} />
            <Route path="/owner/staff" element={<StaffManagement key={resetVersion} />} />
            <Route path="/owner/history" element={<History key={resetVersion} />} />
            <Route path="/owner/plans" element={<PlanCatalog />} />
            <Route path="/owner/gimi" element={<GimiDashboard key={resetVersion} />} />
          </>}
          <Route path="*" element={<Navigate to={homePath(role)} replace />} />
        </Routes>
        </RouteBoundary>
        </Profiler>
      </main>
      <GimiChatWidget role={role} />
      <footer className="workspace-footer sr-only">
        <div className="demo-footer-card">
          <div className="demo-bar-info">
          <strong>Datos locales</strong>
            <p>El selector cambia la vista activa; la autenticación y los permisos no están implementados.</p>
          </div>
          <div className="demo-controls">
            <label htmlFor="demo-role">Rol de acceso<select id="demo-role" value={role} onChange={event => switchRole(event.target.value as Role)}><option value="OWNER">OWNER · Propietario</option><option value="RECEPTION">RECEPTION · Recepción</option></select></label>
            <Button variant="secondary" onClick={() => { reset(); setMessage('Datos locales restablecidos.'); }}>Restablecer datos</Button>
          </div>
        </div>
        <p className="reset-status" role="status" aria-label="Resultado local">{message}</p>
        <p className="workspace-footer-note">Datos en memoria · Las fechas registradas no determinan el acceso.</p>
      </footer>
    </div>
  </div>;
}
