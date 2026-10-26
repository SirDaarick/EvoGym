import { useEffect, useState } from 'react';
import { getReceptionConfig } from '../api/receptionApi';
import { useAdminSession } from '../features/auth/AdminSessionProvider';
import { useProductAccess } from '../features/auth/ProductAccessProvider';
import { StaffAttendanceView } from '../features/reception/StaffAttendanceView';
import type { StaffProfile } from '../features/staff/staffStore';
import { EmptyState, Panel } from '../shared/ui';

interface RosterItem {
  id: string;
  full_name: string;
  position: string;
  is_active: boolean;
}

export function ApiStaffAttendance() {
  const access = useProductAccess();
  const admin = useAdminSession();
  const principal = access.principal;
  const request = principal?.kind === 'admin' ? admin.request : access.request;
  const branchId = principal?.kind === 'employee' ? principal.branch.branch_id : getReceptionConfig().branchId;
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void request(`/api/v1/staff-roster?branch_id=${encodeURIComponent(branchId)}`).then(async response => {
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no tiene permiso para consultar el roster.' : 'No se pudo cargar el personal desde la API.');
      const roster = (await response.json() as { items: RosterItem[] }).items;
      if (!cancelled) setStaff(roster.map(item => ({
        id: item.id, name: item.full_name, role: 'RECEPTION', shift: '', salaryMinor: 0,
        hasPin: false, active: item.is_active, avatarInitials: item.full_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(),
        department: item.position,
      })));
    }).catch(reason => {
      if (!cancelled) {
        setStaff([]);
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el personal desde la API.');
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, request]);

  if (loading) return <Panel><div role="status">Cargando personal…</div></Panel>;
  if (error) return <Panel><EmptyState title="Asistencia no disponible">{error}</EmptyState></Panel>;
  return <StaffAttendanceView liveRequest={request} liveStaff={staff} branchId={branchId} />;
}
