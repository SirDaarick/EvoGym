import { useEffect } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { useAdminSession } from '../features/auth/AdminSessionProvider';
import { OwnerManagementPage } from '../features/auth/OwnerManagementPage';
import { ApiStaffManagement } from '../features/owner/StaffManagement';
import { Button, EmptyState, PageHeader, Panel } from '../shared/ui';
import { ApplicationShell, type ProductNavigationItem, type ShellIconName } from './ApplicationShell';
import { homePath, navigation, rolePath } from './navigation';
import type { Role } from '../domain/models';

function UnavailablePage({ title }: { title: string }) {
  return <>
    <PageHeader eyebrow="API · DISPONIBILIDAD" title={title} description="Esta pantalla conserva su acceso, pero la operación todavía no está conectada a la API." />
    <Panel><EmptyState title="Función no disponible">No se ejecutaron cambios ni se cargaron datos locales. Vuelve a intentarlo cuando la integración esté habilitada.</EmptyState></Panel>
  </>;
}

const pageTitles: Record<string, string> = {
  '/reception/home': 'Inicio de recepción',
  '/reception/staff': 'Personal',
  '/owner/overview': 'Resumen del negocio',
  '/owner/alerts': 'Centro de alertas operativas',
  '/owner/attendance': 'Afluencia y capacidad del gimnasio',
  '/owner/expenses': 'Finanzas del negocio',
  '/owner/members': 'Socios y membresías',
  '/reception/members': 'Socios y membresías',
  '/owner/shifts': 'Turno de trabajo',
  '/reception/shifts': 'Turno de trabajo',
  '/owner/inventory': 'Inventario y conteo físico',
  '/reception/inventory': 'Inventario y conteo físico',
  '/owner/history': 'Historial de movimientos',
  '/owner/plans': 'Catálogo de planes',
  '/owner/gimi': 'Monitor y Conocimiento de Gimi',
  '/components': 'Sistema de componentes',
};

export function ApiProductApp() {
  const access = useProductAccess();
  const admin = useAdminSession();
  const location = useLocation();
  const navigate = useNavigate();
  const principal = access.principal;
  if (!principal) return <Navigate to="/" replace />;

  const isAdmin = principal.kind === 'admin';
  const isPhoneEmployee = principal.kind === 'employee' && principal.session.purpose === 'phone';
  const role: Role = isAdmin ? 'OWNER' : 'RECEPTION';
  const canManageEmployees = isAdmin && principal.identity.can_manage_employees;
  const isOwner = isAdmin && principal.identity.is_owner;

  const items: ProductNavigationItem[] = navigation
    .filter(item => item.roles.includes(role))
    .filter(item => !isAdmin || canManageEmployees || !['staff', 'alerts'].includes(item.slug))
    .map(item => ({
      label: isAdmin && item.slug === 'staff' ? 'Personal' : item.roleLabels?.[role] ?? item.label,
      to: rolePath(role, item.slug),
      icon: item.slug as ShellIconName,
    }));
  if (isOwner) items.push({ label: 'Permisos', to: '/owner/permissions', icon: 'components' });

  const shellItems: ProductNavigationItem[] = items.map(item => item);
  const sidebarBottomItems: ProductNavigationItem[] = [
    { label: 'Sistema de componentes', to: '/components', icon: 'components' },
  ];

  async function signOut() {
    try {
      await access.leaveProfile();
    } finally {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem('evogym:demo-mode');
      navigate('/profiles');
    }
  }
  async function switchProfile() {
    await access.leaveProfile();
    navigate('/profiles');
  }
  async function unlinkDevice() {
    if (!isPhoneEmployee || access.loading) return;
    const confirmed = window.confirm('Desvincular este dispositivo cerrará esta sesión del teléfono. Para volver a usarlo, un administrador deberá generar un nuevo código de vinculación. ¿Continuar?');
    if (!confirmed) return;
    try {
      await access.unlinkPairedDevice();
      navigate('/profiles');
    } catch {
      // The provider keeps the current session and exposes the failure for retry.
    }
  }
  const appSidebarItems = [
    { label: 'Cambiar perfil', icon: 'profile' as const, onClick: () => void switchProfile() },
    { label: 'Cerrar sesión', icon: 'profile' as const, onClick: () => void signOut() },
    sidebarBottomItems[0],
  ];

  const pathname = location.pathname;
  const requestedRole = pathname.startsWith('/owner/') ? 'OWNER' : pathname.startsWith('/reception/') ? 'RECEPTION' : role;
  if (requestedRole !== role) return <Navigate to={homePath(role)} replace />;

  let content = <UnavailablePage title={pageTitles[pathname] ?? 'Función no disponible'} />;
  if (pathname === '/owner/staff' && canManageEmployees && admin.status === 'authenticated') {
    content = <ApiStaffManagement />;
  } else if (pathname === '/owner/permissions' && isOwner && admin.status === 'authenticated') {
    content = <OwnerManagementPage request={admin.request} />;
  } else if (pathname === '/owner/staff' && !canManageEmployees) {
    content = <UnavailablePage title="Personal" />;
  }

  return <ApplicationShell
    items={shellItems}
    brandTo={homePath(role)}
    caption={principal.identity.display_name}
    headerContent={<span className="muted">Sesión verificada por la API</span>}
    headerActionsBeforeTheme={<Button variant="secondary" disabled title="La operación de turnos todavía no está conectada a la API.">Turno no disponible</Button>}
    headerActionsAfterTheme={isPhoneEmployee ? <>
      <Button variant="secondary" disabled={access.loading} onClick={() => void unlinkDevice()}>Desvincular este dispositivo</Button>
      {access.error && <span role="alert">{access.error}</span>}
    </> : undefined}
    sidebarBottomItems={appSidebarItems}
  >{content}</ApplicationShell>;
}
