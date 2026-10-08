import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { Role } from '../domain/models';
import { useDemo } from '../demo/DemoProvider';
import { ComponentCatalog } from '../features/catalog/ComponentCatalog';
import { Members, MemberDetail, NewMember } from '../features/members/Members';
import { MembershipPayment } from '../features/payments/MembershipPayment';
import { Button, EmptyState, Notice, PageHeader, Panel } from '../shared/ui';
import { homePath, navigation, rolePath } from './navigation';

function Placeholder({ title }: { title: string }) {
  return <><PageHeader eyebrow="PROTOTIPO OPERATIVO" title={title} description="Esta sección forma parte del mapa aprobado y está en preparación." />
    <Panel><EmptyState title="Flujo en preparación">Todavía no se pueden registrar operaciones en esta sección. No se procesan pagos ni se modifican datos reales.</EmptyState></Panel>
    <Notice tone="warning">La libreta física es obligatoria. Excel continúa como registro maestro; la comparación es manual.</Notice></>;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { reset, resetVersion } = useDemo();
  const [catalogRole, setCatalogRole] = useState<Role>(location.pathname.startsWith('/reception/') ? 'RECEPTION' : 'OWNER');
  const [message, setMessage] = useState('');
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

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="sidebar">
      <Link className="brand" to={homePath(role)}>EvoGym<span>OPERACIÓN DEL GIMNASIO</span></Link>
      <p className="sidebar-caption">{role === 'OWNER' ? 'Vista de propietario' : 'Vista de recepción'}</p>
      <nav aria-label="Navegación principal">{items.map(item => <NavLink key={item.slug} to={rolePath(role, item.slug)}>{item.label}<span aria-hidden="true">↗</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><p>Prototipo local</p><Link to="/components">Sistema de componentes</Link><p className="muted">Sin conexión a datos reales.</p></div>
    </aside>
    <div className="workspace">
      <header className="demo-bar"><div><strong>Datos de demostración</strong><p>El selector simula vistas; no autentica ni autoriza usuarios.</p></div>
        <div className="demo-controls"><label htmlFor="demo-role">Rol de demostración<select id="demo-role" value={role} onChange={event => switchRole(event.target.value as Role)}><option value="OWNER">OWNER · Propietario</option><option value="RECEPTION">RECEPTION · Recepción</option></select></label>
          <Button variant="secondary" onClick={() => { reset(); setMessage('Datos de demostración restablecidos.'); }}>Restablecer demo</Button></div>
      </header>
      <p className="reset-status" role="status" aria-label="Resultado de demostración">{message}</p>
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/components" element={<ComponentCatalog />} />
          <Route path={rolePath(role, 'members')} element={<Members key={resetVersion} role={role} />} />
          <Route path={rolePath(role, 'members/new')} element={<NewMember key={resetVersion} role={role} />} />
          <Route path={rolePath(role, 'members/:memberId')} element={<MemberDetail role={role} />} />
          <Route path={rolePath(role, 'members/:memberId/payment')} element={<MembershipPayment key={`${resetVersion}-${location.pathname}`} role={role} />} />
          {items.filter(item => item.slug !== 'members').map(item => <Route key={item.slug} path={rolePath(role, item.slug)} element={<Placeholder title={item.title} />} />)}
          <Route path="*" element={<Navigate to={homePath(role)} replace />} />
        </Routes>
      </main>
      <footer className="workspace-footer">Demostración local · Datos en memoria · Las fechas de muestra no determinan acceso real.</footer>
    </div>
  </div>;
}
