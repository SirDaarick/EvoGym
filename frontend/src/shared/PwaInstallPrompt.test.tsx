import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaInstallPrompt } from './PwaInstallPrompt';
import { PWA_DISMISS_KEY } from './usePwaInstall';

describe('PwaInstallPrompt', () => {
  const originalUserAgent = navigator.userAgent;

  function setUserAgent(ua: string) {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: ua,
      configurable: true,
      writable: true,
    });
  }

  function mockMatchMedia(isStandalone = false) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('standalone') ? isStandalone : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  function createBeforeInstallPromptEvent() {
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const userChoiceMock = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' });
    const event = new Event('beforeinstallprompt', { bubbles: true, cancelable: true });
    Object.assign(event, {
      prompt: promptMock,
      userChoice: userChoiceMock,
      platforms: ['web'],
    });
    return { event, promptMock };
  }

  beforeEach(() => {
    sessionStorage.clear();
    mockMatchMedia(false);
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0');
    // Ensure navigator.standalone is false
    Object.defineProperty(window.navigator, 'standalone', {
      value: false,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    setUserAgent(originalUserAgent);
    vi.restoreAllMocks();
  });

  it('renders nothing initially when beforeinstallprompt has not fired and not on iOS', () => {
    const { container } = render(<PwaInstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when already running in standalone mode via matchMedia', () => {
    mockMatchMedia(true);
    const { container } = render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when already running in standalone mode via navigator.standalone', () => {
    Object.defineProperty(window.navigator, 'standalone', {
      value: true,
      configurable: true,
      writable: true,
    });
    const { container } = render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders banner when beforeinstallprompt is received on desktop/Android', () => {
    render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(screen.getByRole('region', { name: /instalación de la aplicación/i })).toBeInTheDocument();
    expect(screen.getByText('Instala EvoGym en tu dispositivo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar App' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar/i })).toBeInTheDocument();
  });

  it('triggers promptInstall and dismisses when user clicks "Instalar App"', async () => {
    const user = userEvent.setup();
    render(<PwaInstallPrompt />);

    const { event, promptMock } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    const installButton = screen.getByRole('button', { name: 'Instalar App' });
    await user.click(installButton);

    expect(promptMock).toHaveBeenCalledTimes(1);
    // After prompt is accepted, banner unmounts
    expect(screen.queryByRole('region', { name: /instalación de la aplicación/i })).not.toBeInTheDocument();
  });

  it('dismisses banner and records session dismissal when clicking "Descartar"', async () => {
    const user = userEvent.setup();
    render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    const dismissButton = screen.getByRole('button', { name: /descartar/i });
    await user.click(dismissButton);

    expect(screen.queryByRole('region', { name: /instalación de la aplicación/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PWA_DISMISS_KEY)).toBe('1');
  });

  it('does not show banner if previously dismissed in session', () => {
    sessionStorage.setItem(PWA_DISMISS_KEY, '1');
    const { container } = render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('displays iOS specific instructions when visiting on iOS', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    render(<PwaInstallPrompt />);

    expect(screen.getByRole('region', { name: /instalación de la aplicación para ios/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Toca Compartir en Safari y selecciona 'Añadir a pantalla de inicio'/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instalar App' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar|entendido/i })).toBeInTheDocument();
  });

  it('allows dismissing iOS instructions gracefully', async () => {
    const user = userEvent.setup();
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    render(<PwaInstallPrompt />);

    const dismissBtn = screen.getByRole('button', { name: /descartar|entendido/i });
    await user.click(dismissBtn);

    expect(screen.queryByRole('region', { name: /instalación de la aplicación para ios/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PWA_DISMISS_KEY)).toBe('1');
  });

  it('does not display iOS banner if already running in standalone mode', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    mockMatchMedia(true);

    const { container } = render(<PwaInstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('displays Android manual guidance on Android when beforeinstallprompt has not fired', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 12; ELS-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    render(<PwaInstallPrompt />);

    expect(screen.getByRole('region', { name: /instalación de la aplicación para android/i })).toBeInTheDocument();
    expect(screen.getByText('Instala EvoGym en tu dispositivo')).toBeInTheDocument();
    expect(
      screen.getByText(/Añade la app a tu pantalla de inicio desde el menú de tu navegador/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent(/Toca el menú de tres puntos \(⋮\) en la esquina superior de tu navegador/i);
    expect(screen.getByRole('list')).toHaveTextContent(/Selecciona 'Instalar aplicación' o 'Añadir a la pantalla principal'/i);
    expect(screen.queryByRole('button', { name: 'Instalar App' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entendido/i })).toBeInTheDocument();
  });

  it('renders 1-click install button on Android when beforeinstallprompt is received', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 12; ELS-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    render(<PwaInstallPrompt />);

    const { event } = createBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    expect(screen.getByRole('region', { name: 'Instalación de la aplicación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar App' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /descartar/i })).toBeInTheDocument();
    expect(screen.queryByText(/Añade la app a tu pantalla de inicio desde el menú de tu navegador/i)).not.toBeInTheDocument();
  });

  it('allows dismissing Android manual instructions gracefully', async () => {
    const user = userEvent.setup();
    setUserAgent('Mozilla/5.0 (Linux; Android 12; ELS-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    render(<PwaInstallPrompt />);

    const dismissBtn = screen.getByRole('button', { name: /entendido/i });
    await user.click(dismissBtn);

    expect(screen.queryByRole('region', { name: /instalación de la aplicación/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PWA_DISMISS_KEY)).toBe('1');
  });

  it('does not display Android banner if already running in standalone mode', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 12; ELS-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    mockMatchMedia(true);

    const { container } = render(<PwaInstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not display Android banner if navigator.standalone is true', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 12; ELS-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36');
    Object.defineProperty(window.navigator, 'standalone', {
      value: true,
      configurable: true,
      writable: true,
    });

    const { container } = render(<PwaInstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });
});
