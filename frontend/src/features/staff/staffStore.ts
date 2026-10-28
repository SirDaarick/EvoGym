import { useEffect, useState } from 'react';
import type { Role } from '../../domain/models';
import { isDemoDataDisabled } from '../../demo/adapter';

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

let selectedStaff: Pick<StaffProfile, 'id' | 'name'> | null = null;
export function setSelectedStaff(profile: Pick<StaffProfile, 'id' | 'name'> | null) { selectedStaff = profile; }
export function getSelectedStaff() { return selectedStaff; }

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

export const EXTENDED_DEMO_STAFF: StaffProfile[] = [
  ...INITIAL_STAFF.map(s => {
    if (s.id === 'staff-sheila') return { ...s, shift: 'Descanso (Mar/Jue/Sáb)' };
    if (s.id === 'staff-maho') return { ...s, shift: 'Descanso (Jue a Dom)' };
    return s;
  }),
  {
    id: 'staff-valeria',
    name: 'Valeria',
    role: 'RECEPTION',
    shift: 'Matutino (Lun/Mié/Vie)',
    salaryMinor: 950000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'V',
    department: 'Staff',
  },
  {
    id: 'staff-rodrigo',
    name: 'Rodrigo',
    role: 'RECEPTION',
    shift: 'Vespertino (Lun/Mié/Vie)',
    salaryMinor: 950000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'R',
    department: 'Staff',
  },
  {
    id: 'staff-camila',
    name: 'Camila',
    role: 'RECEPTION',
    shift: 'Descanso (Mar/Jue)',
    salaryMinor: 1000000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'C',
    department: 'Staff',
  },
  {
    id: 'staff-diego',
    name: 'Diego',
    role: 'RECEPTION',
    shift: 'Sin turno (Sáb/Dom)',
    salaryMinor: 800000,
    hasPin: true,
    pin: '1234',
    active: true,
    avatarInitials: 'D',
    department: 'Staff',
  },
];

const defaultStaffList = () => (import.meta.env.MODE === 'test' ? INITIAL_STAFF : EXTENDED_DEMO_STAFF);

let currentStaff: StaffProfile[] = isDemoDataDisabled() && import.meta.env.MODE !== 'test' ? [] : [...defaultStaffList()];
const listeners = new Set<(staff: StaffProfile[]) => void>();

export function getStaffList(): StaffProfile[] {
  if (isDemoDataDisabled() && import.meta.env.MODE !== 'test' && currentStaff.length === defaultStaffList().length && currentStaff[0]?.id === 'admin-1') {
    return [];
  }
  return currentStaff;
}

export function subscribeStaff(listener: (staff: StaffProfile[]) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  const snapshot = [...currentStaff];
  listeners.forEach((fn) => fn(snapshot));
}

export function saveStaffProfile(profile: Omit<StaffProfile, 'avatarInitials'>): StaffProfile {
  const initials =
    profile.name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'R';

  const fullProfile: StaffProfile = { ...profile, avatarInitials: initials };
  const index = currentStaff.findIndex((s) => s.id === profile.id);
  if (index >= 0) {
    currentStaff[index] = fullProfile;
  } else {
    currentStaff = [...currentStaff, fullProfile];
  }
  notify();
  return fullProfile;
}

export function toggleStaffActive(id: string): StaffProfile | undefined {
  const index = currentStaff.findIndex((s) => s.id === id);
  if (index >= 0) {
    const updated = { ...currentStaff[index], active: !currentStaff[index].active };
    currentStaff = [
      ...currentStaff.slice(0, index),
      updated,
      ...currentStaff.slice(index + 1),
    ];
    notify();
    return updated;
  }
  return undefined;
}

export function resetStaff() {
  currentStaff = isDemoDataDisabled() && import.meta.env.MODE !== 'test' ? [] : defaultStaffList().map((s) => ({ ...s }));
  notify();
}

export function useStaff() {
  const [staff, setStaff] = useState(getStaffList);
  useEffect(() => {
    return subscribeStaff(setStaff);
  }, []);
  return staff;
}
