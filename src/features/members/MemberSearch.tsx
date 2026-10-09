import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Member, Role } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { memberSearchGroups, memberStatus, memberStatusLabels } from '../../demo/memberStatus';
import { rolePath } from '../../app/navigation';

export function MemberSearch({ role }: { role: Role }) {
  const { state } = useDemo();
  const navigate = useNavigate();
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const groups = memberSearchGroups(state.members, query).filter(group => group.members.length);
  const results = groups.flatMap(group => group.members);
  const highlighted = results.find(member => member.id === activeId);
  const visible = open && Boolean(query.trim());
  const optionId = (memberId: string) => `${id}-${memberId}`;
  function select(member: Member) {
    setOpen(false); setQuery(''); setActiveId(null);
    navigate(rolePath(role, `members/${member.id}`));
  }

  return <div className="global-member-search">
    <label htmlFor={id}>Búsqueda global de socios</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? `${id}-results` : undefined}
      aria-activedescendant={visible && highlighted ? optionId(highlighted.id) : undefined}
      autoComplete="off" placeholder="Nombre, teléfono o referencia" value={query}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActiveId(null); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); setActiveId(null); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
          event.preventDefault(); setOpen(true);
          const index = results.findIndex(member => member.id === activeId);
          const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : results.length - 1)
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
          setActiveId(results[next].id);
        }
        if (event.key === 'Enter' && visible && highlighted) { event.preventDefault(); select(highlighted); }
      }} />
    {visible && <div className="member-suggestions" id={`${id}-results`} role="listbox" aria-label="Sugerencias de socios">
      {groups.map(group => <div key={group.status} role="group" aria-label={memberStatusLabels[group.status]}>
        <p className="suggestion-group-title" aria-hidden="true">{memberStatusLabels[group.status]}</p>
        {group.members.map(member => <div key={member.id} id={optionId(member.id)} role="option" aria-selected={highlighted?.id === member.id}
          className="member-option" onMouseDown={event => event.preventDefault()} onClick={() => select(member)}>
          <strong>{member.name}</strong><span>{memberStatus(member).label}</span>
        </div>)}
      </div>)}
      {!results.length && <p role="status">Sin coincidencias de socios.</p>}
      <p className="muted suggestion-note">Escenarios de demostración; no autorizan acceso real.</p>
    </div>}
  </div>;
}
