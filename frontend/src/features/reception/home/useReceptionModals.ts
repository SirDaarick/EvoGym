import { useState } from 'react';

export type ModalKey = 'devoluciones' | 'merma' | 'guantes' | 'casilleros' | 'extra' | 'gasto' | 'suplementos';

/** At most one reception modal is open at a time. */
export function useReceptionModals() {
  const [active, setActive] = useState<ModalKey | null>(null);
  return {
    isOpen: (key: ModalKey) => active === key,
    open: (key: ModalKey) => setActive(key),
    close: () => setActive(null),
  };
}
