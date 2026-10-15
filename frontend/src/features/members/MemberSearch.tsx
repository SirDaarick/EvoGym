import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Member, Role } from '../../domain/models';
import { useDemo } from '../../demo/DemoProvider';
import { memberSearchGroups, memberStatus, memberStatusLabels } from '../../demo/memberStatus';
import { rolePath } from '../../app/navigation';
import AnimatedList from '../catalog/react-bits/AnimatedList';
import JellyRadio, { type JellyRadioItem } from '../catalog/react-bits/JellyRadio';

type CategoryFilter = 'all' | 'active' | 'expired' | 'inactive';

export function MemberSearch({ role }: { role: Role }) {
  const { state } = useDemo();
  const navigate = useNavigate();
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
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
      if (currentTheme) {
        setDark(currentTheme === 'dark');
      } else {
        setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
      }
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Categorize members; include all on empty query
  const allGroups = memberSearchGroups(state.members, query, undefined, true);

  // Counts for filter pills
  const countActive = allGroups.find(g => g.status === 'active')?.members.length ?? 0;
  const countExpired = allGroups.find(g => g.status === 'expired')?.members.length ?? 0;
  const countInactive = allGroups.find(g => g.status === 'inactive')?.members.length ?? 0;
  const countUnknown = allGroups.find(g => g.status === 'unknown')?.members.length ?? 0;
  const countTotal = countActive + countExpired + countInactive + countUnknown;

  const filterItems: JellyRadioItem[] = [
    { value: 'all', label: `Todos (${countTotal})` },
    { value: 'active', label: `Activos (${countActive})` },
    { value: 'expired', label: `Vencidos (${countExpired})` },
    { value: 'inactive', label: `Inactivos (${countInactive})` },
  ];

  // Filter groups according to pill selection
  const filteredGroups = allGroups.filter(group => {
    if (categoryFilter === 'all') return true;
    return group.status === categoryFilter;
  });

  const displayGroups = filteredGroups
    .filter(group => group.members.length > 0)
    .map(group => ({
      label: memberStatusLabels[group.status],
      items: group.members.map(member => ({
        id: member.id,
        title: member.name,
        description: memberStatus(member).label,
        member,
      })),
    }));

  const flatResults = displayGroups.flatMap(group => group.items.map(item => item.member));
  const isWhitespace = query.length > 0 && query.trim() === '';
  const visible = open && !isWhitespace;

  function select(member: Member) {
    setOpen(false);
    setQuery('');
    setSelectedIndex(-1);
    navigate(rolePath(role, `members/${member.id}`));
  }

  // Global Type-to-Search: listen for printable character keydown on window
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setSelectedIndex(-1);
        return;
      }

      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const active = document.activeElement;
      if (active) {
        const tagName = active.tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tagName)) return;
        if ((active as HTMLElement).isContentEditable) return;
        if (active.closest('dialog, [role="dialog"]')) return;
      }

      event.preventDefault();
      inputRef.current?.focus();
      setQuery(prev => prev + event.key);
      setOpen(true);
      setSelectedIndex(-1);
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  // Clicking outside closes the suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, []);

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
          placeholder="Barra de búsqueda de socios o inventario"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={event => {
            if (!containerRef.current?.contains(event.relatedTarget as Node)) {
              setOpen(false);
            }
          }}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
            setSelectedIndex(-1);
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setSelectedIndex(-1);
              return;
            }

            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && flatResults.length) {
              event.preventDefault();
              setOpen(true);
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
                const member = flatResults[index];
                if (member) select(member);
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
            <p role="status">Sin coincidencias de socios.</p>
          )}

          <p className="muted suggestion-note">La membresía debe estar vigente para autorizar el acceso.</p>
        </div>
      )}
    </div>
  );
}

