import { Button } from '@/shared/ui';
import { shortcutIcons } from '../ReceptionHome';
import type { ModalKey } from './useReceptionModals';

type ShortcutKey = Exclude<ModalKey, 'devoluciones' | 'merma'>;
const SHORTCUTS: ReadonlyArray<{ key: ShortcutKey; label: string }> = [
  { key: 'gasto', label: 'Gasto' },
  { key: 'extra', label: 'Extra' },
  { key: 'guantes', label: 'Guantes' },
  { key: 'suplementos', label: 'Suplementos' },
  { key: 'casilleros', label: 'Casilleros' },
];

interface Props {
  /** A register with a known branch is selected. */
  registerReady: boolean;
  /** The checkout is locked (pending sale); supplements cannot open meanwhile. */
  locked: boolean;
  onOpen(key: ShortcutKey): void;
}

export function ReceptionShortcutBar({ registerReady, locked, onOpen }: Props) {
  return <div className="reception-shortcuts-container"><div className="reception-clay-actions" role="group" aria-label="Acciones operativas rápidas">
    {SHORTCUTS.map(({ key, label }) => {
      const isAvailable = registerReady && (key !== 'suplementos' || !locked);
      return (
        <Button
          key={key}
          variant="secondary"
          className="shortcut-clay-btn"
          disabled={!isAvailable}
          title={isAvailable ? `Abrir ${label}` : 'Selecciona una caja primero'}
          onClick={() => onOpen(key)}
        >
          {shortcutIcons[key]}
          <span>{label}</span>
        </Button>
      );
    })}
  </div></div>;
}
