import type { ReactNode } from 'react';

interface AssignedMemberSummaryProps {
  name: string;
  phone?: string;
  label?: string;
  children?: ReactNode;
}

export function AssignedMemberSummary({ name, phone, label = 'Socio asignado:', children }: AssignedMemberSummaryProps) {
  return <div className="assigned-member-info">
    <span className="assigned-member-tag">{label}</span>
    <strong>{name}</strong>
    {phone && <span className="muted">Tel: {phone}</span>}
    {children}
  </div>;
}
