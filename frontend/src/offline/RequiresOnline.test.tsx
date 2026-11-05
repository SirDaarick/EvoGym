import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequiresOnline } from './RequiresOnline';
import { useCapability } from './useCapability';
import * as syncProvider from './SyncProvider';

function CapabilityConsumer({ cmd }: { cmd: any }) {
  const cap = useCapability(cmd);
  return (
    <div>
      <span data-testid="allowed">{String(cap.allowed)}</span>
      <span data-testid="reason">{cap.reason || 'none'}</span>
    </div>
  );
}

describe('RequiresOnline and useCapability', () => {
  it('renders children when online regardless of command', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'synced',
      isOnline: true,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(
      <RequiresOnline cmd="point.card_payment">
        <button>Cobrar con terminal</button>
      </RequiresOnline>
    );

    expect(screen.getByText('Cobrar con terminal')).toBeDefined();
    expect(screen.queryByText('Requiere internet')).toBeNull();
  });

  it('renders children when offline for allowed offline commands', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'offline',
      isOnline: false,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(
      <RequiresOnline cmd="pos.cash_sale">
        <button>Cobro en efectivo</button>
      </RequiresOnline>
    );

    expect(screen.getByText('Cobro en efectivo')).toBeDefined();
    expect(screen.queryByText('Requiere internet')).toBeNull();
  });

  it('renders "Requiere internet" badge when offline for online-only commands', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'offline',
      isOnline: false,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(
      <RequiresOnline cmd="point.card_payment">
        <button>Cobrar con terminal</button>
      </RequiresOnline>
    );

    expect(screen.getByText('Requiere internet')).toBeDefined();
    expect(screen.getByText('Cobrar con terminal')).toBeDefined();
  });

  it('renders custom fallback when provided and offline for online-only command', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'offline',
      isOnline: false,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(
      <RequiresOnline cmd="membership.sale" fallback={<span>No disponible sin conexión</span>}>
        <button>Venta de membresía</button>
      </RequiresOnline>
    );

    expect(screen.getByText('No disponible sin conexión')).toBeDefined();
    expect(screen.queryByText('Venta de membresía')).toBeNull();
  });

  it('useCapability reports allowed when online and disallowed with reason when offline', () => {
    const mock = vi.spyOn(syncProvider, 'useSync');

    // Online
    mock.mockReturnValue({
      status: 'synced',
      isOnline: true,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });
    const { rerender } = render(<CapabilityConsumer cmd="catalog.edit" />);
    expect(screen.getByTestId('allowed').textContent).toBe('true');
    expect(screen.getByTestId('reason').textContent).toBe('none');

    // Offline
    mock.mockReturnValue({
      status: 'offline',
      isOnline: false,
      pendingCount: 0,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });
    rerender(<CapabilityConsumer cmd="catalog.edit" />);
    expect(screen.getByTestId('allowed').textContent).toBe('false');
    expect(screen.getByTestId('reason').textContent).toBe('Requiere internet');
  });
});
