import type { Role } from '../domain/models';

export interface NavigationItem {
  slug: string;
  label: string;
  title: string;
  roles: Role[];
  roleLabels?: Partial<Record<Role, string>>;
}

export const navigation: NavigationItem[] = [
  { slug: 'home', label: 'Inicio', title: 'Inicio de recepción', roles: ['RECEPTION'] },
  { slug: 'overview', label: 'Resumen', title: 'Resumen del negocio', roles: ['OWNER'] },
  { slug: 'alerts', label: 'Alertas', title: 'Centro de alertas operativas', roles: ['OWNER'] },
  { slug: 'attendance', label: 'Afluencia', title: 'Afluencia y capacidad del gimnasio', roles: ['OWNER'] },
  { slug: 'expenses', label: 'Finanzas', title: 'Finanzas del negocio', roles: ['OWNER'] },
  { slug: 'members', label: 'Socios', title: 'Socios y membresías', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'shifts', label: 'Turno', title: 'Turno de trabajo', roles: ['OWNER', 'RECEPTION'] },
  { slug: 'inventory', label: 'Inventario', title: 'Inventario y conteo físico', roles: ['OWNER', 'RECEPTION'] },
  {
    slug: 'staff',
    label: 'Equipo',
    title: 'Gestión y pase de lista del personal',
    roles: ['OWNER', 'RECEPTION'],
    roleLabels: {
      OWNER: 'Equipo',
      RECEPTION: 'Personal',
    },
  },
  { slug: 'history', label: 'Historial', title: 'Historial de movimientos', roles: ['OWNER'] },
  { slug: 'plans', label: 'Planes', title: 'Catálogo de planes', roles: ['OWNER'] },
  { slug: 'gimi', label: 'Gimi AI', title: 'Monitor y Conocimiento de Gimi', roles: ['OWNER'] },
];
export function rolePath(role: Role, slug: string) { return `/${role.toLowerCase()}/${slug}`; }
export function homePath(role: Role) { return rolePath(role, role === 'OWNER' ? 'overview' : 'home'); }
