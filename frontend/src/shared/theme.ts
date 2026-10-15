import { useEffect, useState } from 'react';

export function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    const currentTheme = document.documentElement.dataset.theme;
    return currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    function syncTheme() {
      const currentTheme = document.documentElement.dataset.theme;
      const next = currentTheme ? currentTheme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
      setDark(prev => (prev === next ? prev : next));
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    mql?.addEventListener?.('change', syncTheme);
    return () => {
      observer.disconnect();
      mql?.removeEventListener?.('change', syncTheme);
    };
  }, []);

  return dark;
}
