import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const PWA_DISMISS_KEY = 'evogym:pwa-dismissed';

export function isIosDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  try {
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/i.test(ua);
    const isIpadOs = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
    return isIos || isIpadOs;
  } catch {
    return false;
  }
}

export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const isMediaStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
    const isNavStandalone = Boolean((navigator as unknown as { standalone?: boolean })?.standalone);
    return isMediaStandalone || isNavStandalone;
  } catch {
    return false;
  }
}

export function isSessionDismissed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.sessionStorage?.getItem(PWA_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export interface UsePwaInstallReturn {
  canInstall: boolean;
  isInstalled: boolean;
  isIos: boolean;
  isDismissed: boolean;
  promptInstall: () => Promise<boolean>;
  dismiss: () => void;
}

export function usePwaInstall(): UsePwaInstallReturn {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isStandaloneMode());
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isSessionDismissed());

  const isIos = isIosDevice();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isStandaloneMode()) {
      setIsInstalled(true);
    }
    if (isSessionDismissed()) {
      setIsDismissed(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    try {
      const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
      const handleMediaChange = (event: MediaQueryListEvent) => {
        if (event.matches) {
          setIsInstalled(true);
        }
      };

      if (mediaQuery?.addEventListener) {
        mediaQuery.addEventListener('change', handleMediaChange);
      } else if (mediaQuery?.addListener) {
        mediaQuery.addListener(handleMediaChange);
      }

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
        if (mediaQuery?.removeEventListener) {
          mediaQuery.removeEventListener('change', handleMediaChange);
        } else if (mediaQuery?.removeListener) {
          mediaQuery.removeListener(handleMediaChange);
        }
      };
    } catch {
      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.removeEventListener('appinstalled', handleAppInstalled);
      };
    }
  }, []);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      window.sessionStorage?.setItem(PWA_DISMISS_KEY, '1');
    } catch {
      // Storage access might fail in restricted sandboxes
    }
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) {
      return false;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[evogym:pwa] Install prompt failed', error);
      return false;
    }
  }, [deferredPrompt]);

  const currentlyInstalled = isInstalled || isStandaloneMode();
  const canInstall = !currentlyInstalled && !isDismissed && (Boolean(deferredPrompt) || isIos);

  return {
    canInstall,
    isInstalled: currentlyInstalled,
    isIos,
    isDismissed,
    promptInstall,
    dismiss,
  };
}
