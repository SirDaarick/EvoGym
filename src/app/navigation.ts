import type { Role } from '../domain/models';

export const navigation = [
  { slug: 'overview', label: 'Resumen', title: 'Resumen del negocio', roles: ['OWNER'] },
  { slug: 'members', label: 'Socios', title: 'Socios y membresías', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'sales', label: 'Ventas', title: 'Venta de productos y visitas', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'shifts', label: 'Turno', title: 'Turno de trabajo', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'inventory', label: 'Inventario', title: 'Inventario y conteo físico', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'history', label: 'Historial', title: 'Historial de movimientos', roles: ['OWNER'] },
  { slug: 'plans', label: 'Planes', title: 'Catálogo de planes', roles: ['OWNER'] },
];
export function rolePath(role: Role, slug: string) { return `/${role.toLowerCase()}/${slug}`; }
export function homePath(role: Role) { return rolePath(role, role === 'OWNER' ? 'overview' : 'members'); }
