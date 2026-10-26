import { useEffect, useState, type ReactNode } from 'react';
import { Button, Panel } from '../../shared/ui';
import { PwaInstallPrompt } from '../../shared/PwaInstallPrompt';
import logo from '../../assets/evogym-logo-128.webp';

function SunIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41-1.41M19.07 4.93l-1.41-1.41" /></svg>;
}

function MoonIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>;
}

function readDarkMode() {
  if (typeof document === 'undefined') return false;
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === 'dark' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
}

function currentClock() {
  const now = new Date();
  return {
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} hrs`,
    date: now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, first => first.toUpperCase()),
  };
}

export function ProfileEntryLayout({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(readDarkMode);
  const [clock, setClock] = useState(currentClock);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(currentClock()), 20000);
    return () => window.clearInterval(interval);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  return <div className="staff-selection-page">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <Panel className="staff-selection-container">
      <PwaInstallPrompt />
      <header className="staff-header">
        <div className="staff-brand"><div className="staff-logo-mark" aria-hidden="true"><img src={logo} alt="EvoGym" width={128} height={124} /></div><span className="staff-brand-name">EvoGym</span></div>
        <div className="staff-shift-info" aria-label="Hora y turno actual"><span className="staff-clock">{clock.time}</span><span className="staff-shift-pill">Turno actual</span></div>
        <div className="staff-header-actions"><span className="staff-date-text">{clock.date}</span><Button variant="secondary" className="theme-toggle" aria-pressed={dark} onClick={toggleTheme} aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'} title={dark ? 'Usar tema claro' : 'Usar tema oscuro'}><span className="theme-toggle-icon" aria-hidden="true">{dark ? <SunIcon /> : <MoonIcon />}</span></Button></div>
      </header>
      {children}
      <footer className="staff-footer"><span>EvoGym · Operación de Gimnasio</span></footer>
    </Panel>
  </div>;
}
