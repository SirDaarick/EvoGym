import { Button } from '@/shared/ui';
import type { SearchMember } from './useMemberSearch';

interface Props {
  member: SearchMember | null;
  query: string;
  results: SearchMember[];
  locked: boolean;
  onQueryChange(query: string): void;
  onSelect(member: SearchMember): void;
  onClear(): void;
}

export function MemberAssignmentField({ member, query, results, locked, onQueryChange, onSelect, onClear }: Props) {
  return <div className="cart-member-section"><div className="field"><label htmlFor="product-sale-member">Asignar socio</label>
    <input id="product-sale-member" value={member?.full_name ?? query} disabled={locked || !!member} onChange={event => onQueryChange(event.target.value)} />
    {member && <Button variant="secondary" disabled={locked} onClick={onClear}>Desasignar</Button>}
    {results.map(item => <button type="button" key={item.id} onClick={() => onSelect(item)}>{item.full_name}</button>)}
  </div></div>;
}
