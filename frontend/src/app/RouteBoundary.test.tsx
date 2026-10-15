import { act, render, screen } from '@testing-library/react';
import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RouteBoundary } from './RouteBoundary';

describe('route loading boundary', () => {
  it('announces loading until the requested screen is ready', async () => {
    let resolve!: (module: { default: () => React.ReactNode }) => void;
    const Screen = lazy(() => new Promise<{ default: () => React.ReactNode }>(done => { resolve = done; }));
    render(<RouteBoundary><Screen /></RouteBoundary>);
    expect(screen.getByRole('status', { name: 'Cargando pantalla' })).toHaveTextContent('Cargando');
    expect(screen.getByRole('status', { name: 'Cargando pantalla' })).toHaveClass('route-loading');
    await act(async () => { resolve({ default: () => <h1>Pantalla lista</h1> }); });
    expect(screen.getByRole('heading', { name: 'Pantalla lista' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a full reload on rejected imports and recovers on another route', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Screen = lazy(() => Promise.reject(new Error('offline')));
    const view = render(<RouteBoundary key="failed"><Screen /></RouteBoundary>);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar esta pantalla');
    expect(screen.getByRole('button', { name: 'Recargar aplicación' })).toBeInTheDocument();
    view.rerender(<RouteBoundary key="next"><h1>Otra pantalla</h1></RouteBoundary>);
    expect(screen.getByRole('heading', { name: 'Otra pantalla' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    error.mockRestore();
  });
});
