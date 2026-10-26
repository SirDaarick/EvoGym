import { Profiler, lazy, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { Role } from '../domain/models';
import { useDemo } from '../demo/DemoProvider';
import { MemberSearch } from '../features/members/MemberSearch';
import { GimiChatWidget } from '../features/gimi/GimiChatWidget';
import { Button } from '../shared/ui';
import { PwaInstallPrompt } from '../shared/PwaInstallPrompt';
import { homePath, navigation, rolePath } from './navigation';
import { activeShift } from '../demo/inventoryOperations';
import { openShift, shiftSummary } from '../demo/shiftOperations';
import { ShiftOpenModal } from '../features/shifts/ShiftOpenModal';
import { ShiftCloseDialog } from '../features/shifts/ShiftCloseDialog';

import { RouteBoundary } from './RouteBoundary';
import { ApplicationShell, type ShellIconName } from './ApplicationShell';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { useAdminSession } from '../features/auth/AdminSessionProvider';

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
const StaffProfileSelection = lazy(() => import('../features/staff/StaffProfileSelection').then(module => ({ default: module.LegacyDemoStaffProfileSelection })));
const Login = lazy(() => import('../features/auth/Login').then(module => ({ default: module.Login })));
const OperationalLogin = lazy(() => import('../features/reception/LiveMemberLookup').then(module => ({ default: module.LiveMemberLookup })));
const DevicePairingView = lazy(() => import('../features/staff/DevicePairingView').then(module => ({ default: module.DevicePairingView })));
const StaffManagement = lazy(() => import('../features/owner/StaffManagement').then(module => ({ default: module.StaffManagement })));
const LiveStaffManagement = lazy(() => import('../features/owner/StaffManagement').then(module => ({ default: module.LiveStaffManagement })));
const AdminSecurityAlerts = lazy(() => import('../features/auth/AdminSecurityAlerts').then(module => ({ default: module.AdminSecurityAlerts })));
const OwnerManagementPage = lazy(() => import('../features/auth/OwnerManagementPage').then(module => ({ default: module.OwnerManagementPage })));
const StaffAttendanceView = lazy(() => import('../features/reception/StaffAttendanceView').then(module => ({ default: module.StaffAttendanceView })));
const GimiDashboard = lazy(() => import('../features/gimi/GimiDashboard').then(module => ({ default: module.GimiDashboard })));
const Members = lazy(() => import('../features/members/Members').then(module => ({ default: module.Members })));
const MemberDetail = lazy(() => import('../features/members/Members').then(module => ({ default: module.MemberDetail })));
const NewMember = lazy(() => import('../features/members/Members').then(module => ({ default: module.NewMember })));

function useOptionalProductAccess() {
  try {
    return useProductAccess();
  } catch {
    return null;
  }
}

function useOptionalAdminSession() {
  try {
    return useAdminSession();
  } catch {
    return null;
  }
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
  const access = useOptionalProductAccess();
  const adminSession = useOptionalAdminSession();
  const principal = access?.principal ?? null;

  const { reset, resetVersion, state, transact } = useDemo();
  const [globalOpeningOpen, setGlobalOpeningOpen] = useState(false);
  const [globalClosingOpen, setGlobalClosingOpen] = useState(false);
  const currentActiveShift = activeShift(state);
  const hasActiveShift = Boolean(currentActiveShift);
  const activeShiftName = currentActiveShift?.window.startsWith('06:00') ? 'Matutino' : 'Vespertino';
  const shiftSummaryData = currentActiveShift ? shiftSummary(state, currentActiveShift.id) : null;
  const globalExpectedCashBreakdown = currentActiveShift ? {
    openingMinor: currentActiveShift.openingCashMinor ?? 0,
    receiptsMinor: state.ledger.filter(item => item.shiftId === currentActiveShift.id && item.method === 'cash').reduce((total, item) => total + item.amountMinor, 0),
    extrasMinor: (state.extras ?? []).filter(item => item.shiftId === currentActiveShift.id).reduce((total, item) => total + item.amountMinor, 0),
    expensesMinor: (state.expenses ?? []).filter(item => item.shiftId === currentActiveShift.id).reduce((total, item) => total + item.amountMinor, 0),
  } : undefined;
  const [debugPerformance] = useState(readPerformanceDebugFlag);
  const [catalogRole, setCatalogRole] = useState<Role>(location.pathname.startsWith('/reception/') ? 'RECEPTION' : 'OWNER');
  const [message, setMessage] = useState('');

  const role: Role = principal
    ? (principal.kind === 'admin' ? 'OWNER' : 'RECEPTION')
    : (location.pathname.startsWith('/reception/') ? 'RECEPTION' : location.pathname.startsWith('/owner/') ? 'OWNER' : catalogRole);

  const isAdmin = principal?.kind === 'admin';
  const canManageEmployees = !isAdmin || Boolean(principal?.identity.can_manage_employees);
  const isOwner = !isAdmin || Boolean(principal?.identity.is_owner);

  let navItems = navigation
    .filter(item => item.roles.includes(role))
    .filter(item => {
      if (isAdmin && !canManageEmployees && (item.slug === 'staff' || item.slug === 'alerts')) {
        return false;
      }
      return true;
    })
    .map(item => {
      let label = item.roleLabels?.[role] ?? item.label;
      if (isAdmin && item.slug === 'staff') {
        label = 'Personal';
      }
      return {
        ...item,
        label,
        to: rolePath(role, item.slug),
        icon: item.slug as ShellIconName,
      };
    });

  if (isAdmin && isOwner) {
    navItems = [
      ...navItems,
      {
        slug: 'permissions',
        label: 'Permisos',
        title: 'Gestión de permisos y roles',
        to: '/owner/permissions',
        icon: 'components' as ShellIconName,
        roles: ['OWNER'],
      },
    ];
  }

  const items = navItems;

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
    if (principal) return;
    setCatalogRole(next);
    const slug = location.pathname.split('/')[2];
    navigate(items.some(item => item.slug === slug) && navigation.find(item => item.slug === slug)?.roles.includes(next)
      ? rolePath(next, slug) : homePath(next));
  }

  const handleSignOut = async () => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('evogym:demo-mode');
      }
      if (access) {
        await access.exit();
      }
    } catch {
      // safe fallback
    } finally {
      navigate('/profiles');
    }
  };

  if (principal && (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/profiles')) {
    return <Navigate to={homePath(role)} replace />;
  }

  if (location.pathname === '/' || location.pathname === '/login') return <RouteBoundary key="login"><Login /></RouteBoundary>;
  if (location.pathname === '/reception/live') return <RouteBoundary key="operational-reception"><OperationalLogin /></RouteBoundary>;
  if (location.pathname === '/profiles') return <RouteBoundary key="profiles"><StaffProfileSelection /></RouteBoundary>;
  if (location.pathname === '/pair') return <RouteBoundary key="pair"><DevicePairingView /></RouteBoundary>;

  const shellItems = items.map(item => ({ label: item.label, to: item.to ?? rolePath(role, item.slug), icon: item.icon ?? item.slug as ShellIconName }));
  const sidebarBottomItems = [
    { label: 'Cambiar perfil', to: '/profiles', icon: 'profile' as const },
    ...(principal ? [{ label: 'Cerrar sesión', icon: 'profile' as const, onClick: () => void handleSignOut() }] : []),
    { label: 'Sistema de componentes', to: '/components', icon: 'components' as const },
  ];
  const headerContent = <>
    <MemberSearch key={`${resetVersion}-${role}`} role={role} />
    <Link to={rolePath(role, 'members/new')} className="button button-primary header-new-btn" aria-label="Agregar socio" title="Registrar socio">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      <span>Nuevo</span>
    </Link>
  </>;
  const headerActionsBeforeTheme = <>
    <Button id="global-shift-button" variant="secondary" className={`header-action-control header-shift-control ${hasActiveShift ? 'is-shift-open' : 'is-shift-closed'}`}
      onClick={() => hasActiveShift ? setGlobalClosingOpen(true) : setGlobalOpeningOpen(true)} title={hasActiveShift ? 'Cerrar turno activo' : 'Abrir nuevo turno'}>
      <span className="header-shift-dot" aria-hidden="true" /><span>{hasActiveShift ? 'Cerrar' : 'Abrir'}</span>
    </Button>
    <div className="header-action-control header-clock-control" aria-label="Hora actual" title="Hora actual">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      <span>{new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())} hrs</span>
    </div>
  </>;
  const headerActionsAfterTheme = <>
    {principal ? (
      <div className="header-action-control header-user-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        <strong>{principal.identity.display_name}</strong>
        {principal.kind === 'employee' && <span className="muted">{principal.branch.branch_name}</span>}
      </div>
    ) : (
      <Link to="/profiles" tabIndex={-1} className="header-action-control header-profile-btn" title="Cambiar perfil">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg><span>Perfil</span>
      </Link>
    )}
    <Button variant="secondary" className="header-action-control header-signout-btn" onClick={() => void handleSignOut()}>
      Cerrar sesión
    </Button>
  </>;
  const beforeMain = <>
    {globalOpeningOpen && <ShiftOpenModal isOpen={globalOpeningOpen} state={state} onClose={() => setGlobalOpeningOpen(false)} onConfirm={data => {
      const id = `shift-${crypto.randomUUID()}`;
      transact(currentState => openShift(currentState, { id, window: data.window, openingCashMinor: data.openingCashMinor, cashDenominations: data.cashDenominations,
        openingCashDenominations: data.cashDenominations, responsibleStaffId: data.responsibleStaffId, responsibleStaffName: data.responsibleStaffName,
        stockAdjustments: data.stockAdjustments, counts: data.counts }));
      setGlobalOpeningOpen(false);
    }} />}
    {globalClosingOpen && currentActiveShift && shiftSummaryData && <ShiftCloseDialog key={currentActiveShift.id} isOpen={globalClosingOpen} shiftId={currentActiveShift.id}
      shiftName={activeShiftName} expectedCashMinor={shiftSummaryData.expectedCashMinor} expectedCashBreakdown={globalExpectedCashBreakdown}
      onClose={() => setGlobalClosingOpen(false)} onSuccess={() => setGlobalClosingOpen(false)} />}
    <PwaInstallPrompt />
  </>;
  const footer = !principal ? <footer className="workspace-footer sr-only">
    <div className="demo-footer-card"><div className="demo-bar-info"><strong>Datos locales</strong><p>El selector cambia la vista activa; la autenticación y los permisos no están implementados.</p></div>
      <div className="demo-controls"><label htmlFor="demo-role">Rol de acceso<select id="demo-role" value={role} onChange={event => switchRole(event.target.value as Role)}><option value="OWNER">OWNER · Propietario</option><option value="RECEPTION">RECEPTION · Recepción</option></select></label>
        <Button variant="secondary" onClick={() => { reset(); setMessage('Datos locales restablecidos.'); }}>Restablecer datos</Button>
      </div>
    </div>
    <p className="reset-status" role="status" aria-label="Resultado local">{message}</p>
    <p className="workspace-footer-note">Datos en memoria · Las fechas registradas no determinan el acceso.</p>
  </footer> : null;

  return <ApplicationShell items={shellItems} brandTo={homePath(role)} caption={principal ? 'Acceso verificado' : (role === 'OWNER' ? 'Vista de propietario' : 'Vista de recepción')}
    headerContent={headerContent} headerActionsBeforeTheme={headerActionsBeforeTheme} headerActionsAfterTheme={headerActionsAfterTheme}
    sidebarBottomItems={sidebarBottomItems} beforeMain={beforeMain} afterMain={<GimiChatWidget role={role} />} footer={footer} debugPerformance={debugPerformance}>
    <Profiler id="route-content" onRender={(id, phase, actualDuration, baseDuration) => {
      if (!debugPerformance) return;
      console.info('[evogym:perf] React route commit', { profilerId: id, route: location.pathname, phase,
        actualDurationMs: Math.round(actualDuration * 100) / 100, baseDurationMs: Math.round(baseDuration * 100) / 100 });
    }}>
      <RouteBoundary key={location.pathname}>
        <Routes>
          <Route path="/reception/home" element={<ReceptionHome key={resetVersion} />} />
          <Route path="/reception/staff" element={<StaffAttendanceView key={resetVersion} />} />
          <Route path="/pair" element={<DevicePairingView />} />
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
            <Route path="/owner/permissions" element={<OwnerManagementPage request={adminSession?.request ?? (async () => new Response('{}'))} />} />
            <Route path="/owner/history" element={<History key={resetVersion} />} />
            <Route path="/owner/plans" element={<PlanCatalog />} />
            <Route path="/owner/gimi" element={<GimiDashboard key={resetVersion} />} />
          </>}
          <Route path="*" element={<Navigate to={homePath(role)} replace />} />
        </Routes>
      </RouteBoundary>
    </Profiler>
  </ApplicationShell>;
}
