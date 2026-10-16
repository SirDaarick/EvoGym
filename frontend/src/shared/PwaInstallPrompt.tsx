import { usePwaInstall } from './usePwaInstall';
import { Button } from './ui';

export function PwaInstallPrompt() {
  const { canInstall, isInstalled, isIos, promptInstall, dismiss } = usePwaInstall();

  if (!canInstall || isInstalled) {
    return null;
  }

  if (isIos) {
    return (
      <aside
        className="pwa-install-banner pwa-install-ios"
        role="region"
        aria-label="Instalación de la aplicación para iOS"
      >
        <div className="pwa-banner-main">
          <div className="pwa-banner-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="3" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <div className="pwa-banner-text">
            <strong className="pwa-banner-title">Instala EvoGym en tu inicio</strong>
            <div className="pwa-ios-tip" role="note" aria-label="Instrucciones para iOS">
              <p className="pwa-ios-instruction">
                Toca Compartir en Safari y selecciona &apos;Añadir a pantalla de inicio&apos;
              </p>
              <ol className="pwa-ios-steps">
                <li>
                  Toca el botón <strong>Compartir</strong>{' '}
                  <svg className="pwa-ios-share-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>{' '}
                  en la barra inferior de Safari.
                </li>
                <li>Desplázate y selecciona <strong>Añadir a pantalla de inicio</strong>.</li>
              </ol>
            </div>
          </div>
        </div>
        <div className="pwa-banner-actions">
          <Button
            variant="secondary"
            className="pwa-dismiss-btn"
            onClick={dismiss}
            aria-label="Descartar aviso de instalación"
          >
            Entendido
          </Button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="pwa-install-banner"
      role="region"
      aria-label="Instalación de la aplicación"
    >
      <div className="pwa-banner-main">
        <div className="pwa-banner-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <div className="pwa-banner-text">
          <strong className="pwa-banner-title">Instala EvoGym en tu dispositivo</strong>
          <p className="pwa-banner-desc">
            Instala la aplicación para un acceso rápido y experiencia fluida en pantalla completa.
          </p>
        </div>
      </div>
      <div className="pwa-banner-actions">
        <Button
          variant="primary"
          className="pwa-install-btn"
          onClick={promptInstall}
        >
          Instalar App
        </Button>
        <Button
          variant="secondary"
          className="pwa-dismiss-btn"
          onClick={dismiss}
          aria-label="Descartar aviso de instalación"
        >
          Descartar
        </Button>
      </div>
    </aside>
  );
}
