import type { ReactNode } from 'react';
import JellyRadio from '@/features/catalog/react-bits/JellyRadio';
import type { StatusFilter } from './utils';

interface Props {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  placeholder: string;
  /** Extra controls rendered before the search box (e.g. the branch selector). */
  leading?: ReactNode;
}

export function StaffFilters({ searchQuery, onSearchChange, statusFilter, onStatusChange, placeholder, leading }: Props) {
  return (
    <div className="staff-mgmt-toolbar">
      {leading}
      <div className="field staff-mgmt-search">
        <label htmlFor="staff-search-input" className="sr-only">Buscar recepcionista</label>
        <input id="staff-search-input" type="text" placeholder={placeholder} value={searchQuery}
          onChange={event => onSearchChange(event.target.value)} />
      </div>
      <div className="staff-mgmt-filters">
        <JellyRadio
          items={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Activos' }, { value: 'inactive', label: 'Inactivos' }]}
          value={statusFilter}
          onChange={value => onStatusChange(value as StatusFilter)}
          size="sm"
          chipColor="var(--color-surface-soft, #242424)"
          activeColor="var(--color-primary, #FC6C06)"
          textColor="var(--color-muted, #a3a3a3)"
          activeTextColor="#080808"
          ariaLabel="Filtrar por estado"
        />
      </div>
    </div>
  );
}
