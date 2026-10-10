import { useState } from 'react';
import { Button } from '../../shared/ui';

export function ThemeControl() {
  const [dark, setDark] = useState(() => {
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  return <Button variant="secondary" className="theme-toggle" aria-pressed={dark} onClick={toggleTheme}>
    {dark ? 'Usar tema claro' : 'Usar tema oscuro'}
  </Button>;
}
