import type { Role } from './models';

export interface StaffProfile {
  id: string;
  name: string;
  role: Role;
  shift: string;
  salaryMinor: number;
  hasPin: boolean;
  pin?: string;
  active: boolean;
  avatarInitials: string;
  department?: 'Entrenador' | 'Mantenimiento' | 'Staff' | 'Recepción' | string;
}

export const INITIAL_STAFF: StaffProfile[] = [
  {
    id: 'admin-1',
    name: 'Admin',
    role: 'OWNER',
    shift: 'General',
    salaryMinor: 0,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'A',
    department: 'Staff',
  },
  {
    id: 'staff-emigdio',
    name: 'Emigdio',
    role: 'RECEPTION',
    shift: 'Matutino',
    salaryMinor: 1400000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'E',
    department: 'Entrenador',
  },
  {
    id: 'staff-sheila',
    name: 'Sheila',
    role: 'RECEPTION',
    shift: 'Matutino',
    salaryMinor: 1000000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'S',
    department: 'Staff',
  },
  {
    id: 'staff-mikel',
    name: 'Mikel',
    role: 'RECEPTION',
    shift: 'Vespertino',
    salaryMinor: 1000000,
    hasPin: false,
    active: true,
    avatarInitials: 'M',
    department: 'Entrenador',
  },
  {
    id: 'staff-charly',
    name: 'Charly',
    role: 'RECEPTION',
    shift: 'Vespertino',
    salaryMinor: 1000000,
    hasPin: false,
    active: true,
    avatarInitials: 'C',
    department: 'Entrenador',
  },
  {
    id: 'staff-tadeo',
    name: 'Tadeo',
    role: 'RECEPTION',
    shift: 'Mixto',
    salaryMinor: 1000000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'T',
    department: 'Entrenador',
  },
  {
    id: 'staff-silvia',
    name: 'Silvia',
    role: 'RECEPTION',
    shift: 'Matutino',
    salaryMinor: 800000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'S',
    department: 'Mantenimiento',
  },
  {
    id: 'staff-alan',
    name: 'Alan',
    role: 'RECEPTION',
    shift: 'Matutino',
    salaryMinor: 800000,
    hasPin: false,
    active: true,
    avatarInitials: 'A',
    department: 'Mantenimiento',
  },
  {
    id: 'staff-maho',
    name: 'Maho',
    role: 'RECEPTION',
    shift: 'Vespertino',
    salaryMinor: 600000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'M',
    department: 'Staff',
  },
  {
    id: 'staff-inaky',
    name: 'Iñaky',
    role: 'RECEPTION',
    shift: 'Fin de semana',
    salaryMinor: 400000,
    hasPin: false,
    active: true,
    avatarInitials: 'I',
    department: 'Entrenador',
  },
];
