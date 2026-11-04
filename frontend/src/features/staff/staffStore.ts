import { useEffect, useState } from 'react';
import { INITIAL_STAFF, type StaffProfile } from '../../domain/staff';
import { setDefaultStaffSource } from '../../demo/expenseReportSelector';

export { INITIAL_STAFF };
export type { StaffProfile };
import { isDemoDataDisabled } from '../../demo/adapter';


let selectedStaff: Pick<StaffProfile, 'id' | 'name'> | null = null;
export function setSelectedStaff(profile: Pick<StaffProfile, 'id' | 'name'> | null) { selectedStaff = profile; }
export function getSelectedStaff() { return selectedStaff; }


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

setDefaultStaffSource(getStaffList);

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
