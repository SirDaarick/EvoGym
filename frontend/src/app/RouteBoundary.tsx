import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../shared/ui';

/** Keep route failures inside the content area, not the persistent app shell. */
export class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div className="panel" role="alert">
        <p>No se pudo cargar esta pantalla. Revisa tu conexión y vuelve a cargar la aplicación.</p>
        <Button onClick={() => window.location.reload()}>Recargar aplicación</Button>
      </div>;
    }

    return <Suspense fallback={<div className="panel route-loading" role="status" aria-label="Cargando pantalla" aria-live="polite">Cargando pantalla…</div>}>
      {this.props.children}
    </Suspense>;
  }
}
