import type { Role } from '../domain/models';

export const navigation = [
  { slug: 'home', label: 'Inicio', title: 'Inicio de recepción', roles: ['RECEPTION'] },
  { slug: 'overview', label: 'Resumen', title: 'Resumen del negocio', roles: ['OWNER'] },
  { slug: 'alerts', label: 'Alertas', title: 'Centro de alertas operativas', roles: ['OWNER'] },
  { slug: 'expenses', label: 'Gastos', title: 'Reporte de gastos', roles: ['OWNER'] },
  { slug: 'members', label: 'Socios', title: 'Socios y membresías', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'shifts', label: 'Turno', title: 'Turno de trabajo', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'inventory', label: 'Inventario', title: 'Inventario y conteo físico', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'staff', label: 'Equipo', title: 'Gestión del personal', roles: ['OWNER'] },
  { slug: 'history', label: 'Historial', title: 'Historial de movimientos', roles: ['OWNER'] },
  { slug: 'plans', label: 'Planes', title: 'Catálogo de planes', roles: ['OWNER'] },
];
export function rolePath(role: Role, slug: string) { return `/${role.toLowerCase()}/${slug}`; }
export function homePath(role: Role) { return rolePath(role, role === 'OWNER' ? 'overview' : 'home'); }
