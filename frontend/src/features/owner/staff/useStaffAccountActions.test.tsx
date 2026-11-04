import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '@/test/renderWithQuery';
import type { AdminRosterProfileChoice } from '@/api/staffCredentialsApi';

const lookup = vi.hoisted(() => ({ resolve: null as null | ((value: null) => void) }));
vi.mock('./utils', () => ({ useAdminRequest: () => vi.fn() }));
vi.mock('@/api/staffCredentialsApi', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/staffCredentialsApi')>()),
  getStaffPendingSale: vi.fn(() => new Promise<null>(resolve => { lookup.resolve = resolve; })),
}));

import { useStaffAccountActions } from './useStaffAccountActions';

const profile = { id: 'p1', staff_user_id: '123e4567-e89b-42d3-a456-426614174000', full_name: 'Ana' } as unknown as AdminRosterProfileChoice;

describe('useStaffAccountActions deactivation branch guard', () => {
  it('ignores a pending-sale lookup that resolves after the branch changed', async () => {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const callbacks = { onError: vi.fn(), onNotice: vi.fn() };
    const { result, rerender } = renderHook(({ branch }) => useStaffAccountActions(branch, callbacks), { wrapper, initialProps: { branch: 'b1' } });
    act(() => { result.current.openDeactivation({ profile, active: true }); });
    await waitFor(() => expect(lookup.resolve).not.toBeNull());
    rerender({ branch: 'b2' });
    await act(async () => { lookup.resolve!(null); await Promise.resolve(); });
    await waitFor(() => expect(result.current.deactivationBusy).toBe(false));
    expect(result.current.deactivation).toBeNull();
  });

  it('opens the deactivation state when the branch is unchanged', async () => {
    lookup.resolve = null;
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useStaffAccountActions('b1', { onError: vi.fn(), onNotice: vi.fn() }), { wrapper });
    act(() => { result.current.openDeactivation({ profile, active: true }); });
    await waitFor(() => expect(lookup.resolve).not.toBeNull());
    await act(async () => { lookup.resolve!(null); });
    await waitFor(() => expect(result.current.deactivation?.profile).toBe(profile));
  });
});
