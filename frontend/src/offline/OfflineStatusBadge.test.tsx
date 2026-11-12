import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfflineStatusBadge } from './OfflineStatusBadge';
import * as syncProvider from './SyncProvider';

describe('OfflineStatusBadge', () => {
  it('renders Modo Contingencia badge when status is offline', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'offline',
      isOnline: false,
      pendingCount: 5,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(<OfflineStatusBadge />);
    expect(screen.getByText('Modo Contingencia')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });

  it('renders Sincronizando badge when status is syncing', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'syncing',
      isOnline: true,
      pendingCount: 3,
      lastSyncAt: null,
      error: null,
      flushNow: vi.fn(),
    });

    render(<OfflineStatusBadge />);
    expect(screen.getByText('Sincronizando (3)')).toBeDefined();
  });

  it('renders Reintentar button when status is error and calls flushNow on click', () => {
    const flushNow = vi.fn();
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'error',
      isOnline: true,
      pendingCount: 2,
      lastSyncAt: null,
      error: 'Sync failed',
      flushNow,
    });

    render(<OfflineStatusBadge />);
    const button = screen.getByText('Reintentar sync (2)');
    expect(button).toBeDefined();

    fireEvent.click(button);
    expect(flushNow).toHaveBeenCalledTimes(1);
  });

  it('renders Sincronizado badge when status is synced', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'synced',
      isOnline: true,
      pendingCount: 0,
      lastSyncAt: new Date(),
      error: null,
      flushNow: vi.fn(),
    });

    render(<OfflineStatusBadge />);
    expect(screen.getByText('Sincronizado')).toBeDefined();
  });

  it('does not claim synchronization while queued events remain', () => {
    vi.spyOn(syncProvider, 'useSync').mockReturnValue({
      status: 'synced', isOnline: true, pendingCount: 2, lastSyncAt: null, error: null, flushNow: vi.fn(),
    });
    render(<OfflineStatusBadge />);
    expect(screen.getByText('Pending sync (2)')).toBeInTheDocument();
    expect(screen.queryByText('Sincronizado')).not.toBeInTheDocument();
  });
});
