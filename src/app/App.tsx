import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { Role } from '../domain/models';
import { useDemo } from '../demo/DemoProvider';
import { ComponentCatalog } from '../features/catalog/ComponentCatalog';
import { Members, MemberDetail, NewMember } from '../features/members/Members';
import { MemberSearch } from '../features/members/MemberSearch';
import { MembershipPayment } from '../features/payments/MembershipPayment';
import { Sales } from '../features/sales/Sales';
import { Inventory } from '../features/inventory/Inventory';
import { Shifts } from '../features/shifts/Shifts';
import { Overview } from '../features/owner/Overview';
import { History } from '../features/owner/History';
import { PlanCatalog } from '../features/owner/PlanCatalog';
import { ReceptionHome } from '../features/reception/ReceptionHome';
import { OwnerQuestions } from '../features/demo/OwnerQuestions';
import { Button } from '../shared/ui';
import { homePath, navigation, rolePath } from './navigation';
import logo from '../../Logo_Evo.png';

const navIcons: Record<string, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
  overview: <><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>,
  members: <><circle cx="9" cy="8" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2zM16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 4 5" /></>,
  sales: <><path d="M3 7h18l-2 13H5zM8 7V5a4 4 0 0 1 8 0v2" /></>,
  shifts: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  inventory: <><path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></>,
  history: <><path d="M3 12a9 9 0 1 1 3 6.7M3 17v-5h5M12 7v5l4 2" /></>,
  plans: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  components: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
};

function NavIcon({ name }: { name: string }) {
  return <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{navIcons[name]}</svg>;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { reset, resetVersion } = useDemo();
  const [catalogRole, setCatalogRole] = useState<Role>(location.pathname.startsWith('/reception/') ? 'RECEPTION' : 'OWNER');
  const [message, setMessage] = useState('');
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const sidebarExpanded = sidebarPinned || sidebarHovered || sidebarFocused;
  const role: Role = location.pathname.startsWith('/reception/') ? 'RECEPTION' : location.pathname.startsWith('/owner/') ? 'OWNER' : catalogRole;
  const items = navigation.filter(item => item.roles.includes(role));
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

  if (location.pathname === '/') return <div className="profile-entry">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <main id="main-content" tabIndex={-1}>
      <p className="eyebrow">EVOGYM · PROTOTIPO LOCAL</p>
      <h1>Elige tu perfil</h1>
      <p className="muted">Entra sin contraseña ni PIN. Esta selección no autentica ni autoriza usuarios.</p>
      <div className="profile-grid">
        <Button variant="secondary" className="profile-card" onClick={() => navigate(homePath('OWNER'))}>
          <span className="profile-icon" aria-hidden="true">A</span><strong>Admin</strong><span>Resumen, planes y operación del gimnasio</span>
        </Button>
        <Button variant="secondary" className="profile-card" onClick={() => navigate(homePath('RECEPTION'))}>
          <span className="profile-icon" aria-hidden="true">R</span><strong>Recepción</strong><span>Socios, productos y cierre de turno</span>
        </Button>
      </div>
      <OwnerQuestions ids={['Q-13']} />
      <p className="muted">Datos de demostración en memoria; se pierden al recargar. Cambiar perfil no borra la demo.</p>
    </main>
  </div>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="sidebar" aria-label="Barra lateral" data-expanded={sidebarExpanded} onMouseEnter={() => setSidebarHovered(true)} onMouseLeave={() => setSidebarHovered(false)} onFocus={() => setSidebarFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSidebarFocused(false); }}>
      <div className="sidebar-head"><Link className="brand" to={homePath(role)} title="EvoGym"><img src={logo} alt="EvoGym" /><span aria-hidden="true">OPERACIÓN DEL GIMNASIO</span></Link>
        <button className="sidebar-toggle" type="button" aria-label={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'} aria-pressed={sidebarPinned} aria-expanded={sidebarExpanded} onClick={() => setSidebarPinned(value => !value)} title={sidebarPinned ? 'Liberar barra lateral' : 'Fijar barra lateral'}><span aria-hidden="true">{sidebarPinned ? '‹' : '›'}</span></button></div>
      <p className="sidebar-caption">{role === 'OWNER' ? 'Vista de propietario' : 'Vista de recepción'}</p>
      <nav aria-label="Navegación principal">{items.map(item => <NavLink key={item.slug} to={rolePath(role, item.slug)} aria-label={item.label} title={item.label}><NavIcon name={item.slug} /><span className="sidebar-label" aria-hidden="true">{item.label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><p className="sidebar-note">Prototipo local</p><Link to="/" aria-label="Cambiar perfil" title="Cambiar perfil"><NavIcon name="profile" /><span className="sidebar-label" aria-hidden="true">Cambiar perfil</span></Link><Link to="/components" aria-label="Sistema de componentes" title="Sistema de componentes"><NavIcon name="components" /><span className="sidebar-label" aria-hidden="true">Sistema de componentes</span></Link><p className="sidebar-note muted">Sin conexión a datos reales.</p></div>
    </aside>
    <div className="workspace">
      <header className="demo-bar"><div><strong>Datos de demostración</strong><p>El selector simula vistas; no autentica ni autoriza usuarios.</p></div>
        <MemberSearch key={`${resetVersion}-${role}-${location.pathname}`} role={role} />
        <div className="demo-controls"><label htmlFor="demo-role">Rol de demostración<select id="demo-role" value={role} onChange={event => switchRole(event.target.value as Role)}><option value="OWNER">OWNER · Propietario</option><option value="RECEPTION">RECEPTION · Recepción</option></select></label>
          <Button variant="secondary" onClick={() => { reset(); setMessage('Datos de demostración restablecidos.'); }}>Restablecer demo</Button></div>
      </header>
      <p className="reset-status" role="status" aria-label="Resultado de demostración">{message}</p>
      <main id="main-content" tabIndex={-1}>
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
            <Route path="/owner/history" element={<History key={resetVersion} />} />
            <Route path="/owner/plans" element={<PlanCatalog />} />
          </>}
          <Route path="*" element={<Navigate to={homePath(role)} replace />} />
        </Routes>
      </main>
      <footer className="workspace-footer">Demostración local · Datos en memoria · Las fechas de muestra no determinan acceso real.</footer>
    </div>
  </div>;
}
