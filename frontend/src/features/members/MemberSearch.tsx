import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { Role } from '../../domain/models';
import { listMembers, type AuthenticatedRequest, type MemberListItemDTO } from '../../api/membersApi';
import { useDemo } from '../../demo/DemoProvider';
import { memberSearchGroups, memberStatus, memberStatusLabels, type MemberStatus } from '../../demo/memberStatus';
import { rolePath } from '../../app/navigation';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import JellyRadio, { type JellyRadioItem } from '../catalog/react-bits/JellyRadio';

type CategoryFilter = 'all' | 'active' | 'expired' | 'inactive';

interface SearchEntry {
  id: string;
  title: string;
  description: string;
}

interface SearchGroup {
  status: MemberStatus;
  items: SearchEntry[];
}

export function MemberSearch({ role, request }: { role: Role; request?: AuthenticatedRequest }) {
  if (request) return <LiveMemberSearch role={role} request={request} />;
  return <DemoMemberSearch role={role} />;
}

function DemoMemberSearch({ role }: { role: Role }) {
  const { state } = useDemo();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const groups: SearchGroup[] = useMemo(
    () =>
      memberSearchGroups(state.members, query, undefined, true).map(group => ({
        status: group.status,
        items: group.members.map(member => ({
          id: member.id,
          title: member.name,
          description: memberStatus(member).label,
        })),
      })),
    [state.members, query],
  );

  return (
    <MemberSearchCombobox
      role={role}
      query={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      groups={groups}
    />
  );
}

function resolveLiveStatus(item: MemberListItemDTO): 'active' | 'expired' | 'inactive' {
  const raw = item.membership_status ?? item.status;
  if (raw === 'active') return 'active';
  if (raw === 'expired') return 'expired';
  return 'inactive';
}

function formatLiveDescription(item: MemberListItemDTO, status: 'active' | 'expired' | 'inactive'): string {
  const statusLabel = status === 'active' ? 'Activa' : status === 'expired' ? 'Vencida' : 'Inactiva';
  return item.member_number ? `${item.member_number} · ${statusLabel}` : statusLabel;
}

function LiveMemberSearch({ role, request }: { role: Role; request: AuthenticatedRequest }) {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [baseItems, setBaseItems] = useState<MemberListItemDTO[]>([]);
  const [remoteItems, setRemoteItems] = useState<MemberListItemDTO[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const loadedBaseRef = useRef(false);
  const generationRef = useRef(0);

  // Invalidate cached directory when route changes (e.g. after registering or editing a member)
  useEffect(() => {
    loadedBaseRef.current = false;
    setRemoteItems(null);
  }, [location.pathname, request]);

  // Lazy load first page when the user opens the search bar
  useEffect(() => {
    if (!open || loadedBaseRef.current) return;
    const generation = ++generationRef.current;
    setLoading(true);
    void listMembers(request, { page: 1, limit: 100 })
      .then(res => {
        if (generation !== generationRef.current) return;
        const items = Array.isArray(res.items) ? res.items : [];
        loadedBaseRef.current = true;
        setBaseItems(items);
        setTotalCount(typeof res.total === 'number' ? res.total : items.length);
      })
      .catch(() => {
        if (generation !== generationRef.current) return;
        setBaseItems([]);
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false);
      });
  }, [open, request]);

  // If the gym has more than 100 members, debounce server-side search for non-empty queries
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed || totalCount <= baseItems.length) {
      setRemoteItems(null);
      return;
    }
    const generation = ++generationRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void listMembers(request, { page: 1, limit: 100, search: trimmed })
        .then(res => {
          if (generation !== generationRef.current) return;
          setRemoteItems(Array.isArray(res.items) ? res.items : []);
        })
        .catch(() => {
          if (generation !== generationRef.current) return;
          setRemoteItems([]);
        })
        .finally(() => {
          if (generation === generationRef.current) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, query, totalCount, baseItems.length, request]);

  const groups: SearchGroup[] = useMemo(() => {
    const isWhitespace = query.length > 0 && query.trim() === '';
    if (isWhitespace) {
      return (['active', 'expired', 'inactive'] as const).map(status => ({ status, items: [] }));
    }
    const normalized = query.trim().toLocaleLowerCase('es-MX');
    const source = remoteItems ?? baseItems;
    const matched = normalized
      ? source.filter(item =>
          `${item.preferred_name ?? ''} ${item.full_name} ${item.phone} ${item.member_number}`
            .toLocaleLowerCase('es-MX')
            .includes(normalized),
        )
      : source;

    const buckets: Record<'active' | 'expired' | 'inactive', SearchEntry[]> = {
      active: [],
      expired: [],
      inactive: [],
    };
    for (const item of matched) {
      const status = resolveLiveStatus(item);
      buckets[status].push({
        id: item.id,
        title: item.preferred_name || item.full_name,
        description: formatLiveDescription(item, status),
      });
    }
    return (['active', 'expired', 'inactive'] as const).map(status => ({
      status,
      items: buckets[status],
    }));
  }, [baseItems, remoteItems, query]);

  return (
    <MemberSearchCombobox
      role={role}
      query={query}
      onQueryChange={setQuery}
      open={open}
      onOpenChange={setOpen}
      groups={groups}
      loading={loading}
    />
  );
}

function MemberSearchCombobox({
  role,
  query,
  onQueryChange,
  open,
  onOpenChange,
  groups,
  loading = false,
}: {
  role: Role;
  query: string;
  onQueryChange: (value: string | ((prev: string) => string)) => void;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  groups: SearchGroup[];
  loading?: boolean;
}) {
  const navigate = useNavigate();
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  useEffect(() => {
    function syncTheme() {
      const currentTheme = document.documentElement.dataset.theme;
      setDark(currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const countActive = groups.find(g => g.status === 'active')?.items.length ?? 0;
  const countExpired = groups.find(g => g.status === 'expired')?.items.length ?? 0;
  const countInactive = groups.find(g => g.status === 'inactive')?.items.length ?? 0;
  const countUnknown = groups.find(g => g.status === 'unknown')?.items.length ?? 0;
  const countTotal = countActive + countExpired + countInactive + countUnknown;

  const filterItems: JellyRadioItem[] = [
    { value: 'all', label: `Todos (${countTotal})` },
    { value: 'active', label: `Activos (${countActive})` },
    { value: 'expired', label: `Vencidos (${countExpired})` },
    { value: 'inactive', label: `Inactivos (${countInactive})` },
  ];

  const displayGroups = groups
    .filter(group => (categoryFilter === 'all' ? true : group.status === categoryFilter))
    .filter(group => group.items.length > 0)
    .map(group => ({
      label: memberStatusLabels[group.status],
      items: group.items,
    }));

  const flatResults = displayGroups.flatMap(group => group.items);
  const isWhitespace = query.length > 0 && query.trim() === '';
  const visible = open && !isWhitespace;

  function select(entry: SearchEntry) {
    onOpenChange(false);
    onQueryChange('');
    setSelectedIndex(-1);
    navigate(rolePath(role, `members/${entry.id}`));
  }

  // Global Type-to-Search: listen for printable character keydown on window
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
        setSelectedIndex(-1);
        return;
      }

      if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) {
        if ((active as HTMLElement).isContentEditable) return;
        if (
          active.closest(
            'input, textarea, select, button, a, summary, [role="button"], [role="tab"], [role="combobox"], [role="listbox"], [role="menuitem"], dialog, [role="dialog"]',
          )
        ) {
          return;
        }
      }

      event.preventDefault();
      inputRef.current?.focus();
      onQueryChange(prev => prev + event.key);
      onOpenChange(true);
      setSelectedIndex(-1);
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [onOpenChange, onQueryChange]);

  // Clicking outside closes the suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [onOpenChange]);

  return (
    <div className="global-member-search" ref={containerRef}>
      <label htmlFor={id} className="sr-only">Búsqueda global de socios</label>
      <div className="global-search-input-wrap">
        <svg
          className="global-search-input-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label="Búsqueda global de socios"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? `${id}-results` : undefined}
          aria-activedescendant={
            visible && selectedIndex >= 0 && selectedIndex < flatResults.length
              ? `${id}-item-${selectedIndex}`
              : undefined
          }
          autoComplete="off"
          placeholder="Buscar socio por nombre, teléfono o número"
          value={query}
          onFocus={() => onOpenChange(true)}
          onBlur={event => {
            if (!containerRef.current?.contains(event.relatedTarget as Node)) {
              onOpenChange(false);
            }
          }}
          onChange={event => {
            onQueryChange(event.target.value);
            onOpenChange(true);
            setSelectedIndex(-1);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onOpenChange(false);
              setSelectedIndex(-1);
              return;
            }

            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && flatResults.length) {
              event.preventDefault();
              onOpenChange(true);
              const next =
                selectedIndex < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : flatResults.length - 1
                  : (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + flatResults.length) %
                    flatResults.length;
              setSelectedIndex(next);
              return;
            }

            if (
              event.key === 'Enter' &&
              visible &&
              selectedIndex >= 0 &&
              selectedIndex < flatResults.length
            ) {
              event.preventDefault();
              select(flatResults[selectedIndex]);
            }
          }}
        />
      </div>
      {visible && (
        <div className="member-suggestions">
          <div className="search-filter-jelly-wrap search-filter-pills" onMouseDown={e => e.preventDefault()}>
            <JellyRadio
              items={filterItems}
              value={categoryFilter}
              onChange={val => {
                setCategoryFilter(val as CategoryFilter);
                setSelectedIndex(-1);
              }}
              ariaLabel="Filtrar socios por categoría"
              size="sm"
              radius={999}
              chipColor="var(--color-canvas)"
              activeColor="var(--color-primary)"
              textColor="var(--color-muted)"
              activeTextColor="var(--color-primary-text, #080808)"
            />
          </div>

          {flatResults.length > 0 ? (
            <AnimatedList
              id={`${id}-item`}
              listboxId={`${id}-results`}
              tabIndex={-1}
              groups={displayGroups}
              selectedIndex={selectedIndex}
              onSelectedIndexChange={setSelectedIndex}
              onItemSelect={(_item, index) => {
                const entry = flatResults[index];
                if (entry) select(entry);
              }}
              theme={dark ? 'dark' : 'light'}
              accentColor="#FC6C06"
              frame={false}
              loop={false}
              animation="pop"
              width="100%"
              maxHeight={320}
            />
          ) : (
            <p role="status">{loading ? 'Buscando socios…' : 'Sin coincidencias de socios.'}</p>
          )}

          <p className="muted suggestion-note">La membresía debe estar vigente para autorizar el acceso.</p>
        </div>
      )}
    </div>
  );
}
