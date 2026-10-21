import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMemberLookup } from './LiveMemberLookup';

const search = vi.fn();
const detail = vi.fn();
const tokenRead = vi.fn();
const clear = vi.fn();
vi.mock('../../api/receptionApi', () => ({
  getReceptionConfig: () => ({ apiOrigin: 'https://gym.example', branchId: '00000000-0000-4000-8000-000000000001' }),
  readOperationalToken: () => tokenRead(), clearOperationalToken: () => clear(),
  signInReception: vi.fn().mockResolvedValue(undefined),
  searchReceptionMembers: (...args: unknown[]) => search(...args), getReceptionMember: (...args: unknown[]) => detail(...args),
}));

const member = { id: 'a7f91bba-5722-4ed7-8bed-10d7f3f6c351', member_number: 'M-10', full_name: 'Socio Real', preferred_name: null, phone: '5551234567', status: 'active' };
beforeEach(() => { vi.clearAllMocks(); tokenRead.mockReturnValue('live-token'); search.mockResolvedValue([member]); detail.mockResolvedValue({ ...member, pending_balance_minor: 3250, has_pending_balance: true }); });

describe('LiveMemberLookup', () => {
  it('uses only live API results and displays then clears positive balance warning after refresh', async () => {
    render(<LiveMemberLookup />);
    fireEvent.change(screen.getByLabelText('Buscar por número, nombre o teléfono'), { target: { value: 'M-10' } });
    const result = await screen.findByRole('button', { name: /M-10/ });
    fireEvent.click(result);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Saldo pendiente de pago parcial/);
    expect(search).toHaveBeenCalledWith('M-10', 'live-token');
    expect(detail).toHaveBeenCalledWith(member.id, 'live-token');
    detail.mockResolvedValueOnce({ ...member, pending_balance_minor: 0, has_pending_balance: false });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar saldo' }));
    expect(await screen.findByText('Sin saldo pendiente de pagos parciales.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a search response after the query changes', async () => {
    let finishFirst!: (rows: typeof member[]) => void;
    search.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce([{ ...member, id: 'new-uuid', member_number: 'M-20', full_name: 'Newest Result' }]);
    render(<LiveMemberLookup />);
    const input = screen.getByLabelText('Buscar por número, nombre o teléfono');
    fireEvent.change(input, { target: { value: 'first' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'second' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    finishFirst([member]);
    expect(await screen.findByRole('button', { name: /M-20.*Newest Result/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /M-10/ })).not.toBeInTheDocument();
  });

  it('keeps the newest selected member when an older detail request resolves later', async () => {
    const other = { ...member, id: 'other-live-uuid', member_number: 'M-11', full_name: 'Socio B' };
    let finishFirst!: (value: typeof member & { pending_balance_minor: number; has_pending_balance: boolean }) => void;
    search.mockResolvedValueOnce([member, other]);
    detail.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce({ ...other, pending_balance_minor: 1200, has_pending_balance: true });
    render(<LiveMemberLookup />);
    fireEvent.change(screen.getByLabelText('Buscar por número, nombre o teléfono'), { target: { value: 'M-1' } });
    fireEvent.click(await screen.findByRole('button', { name: /M-10/ }));
    fireEvent.click(screen.getByRole('button', { name: /M-11/ }));
    expect(await screen.findByRole('heading', { name: 'Socio B' })).toBeInTheDocument();
    finishFirst({ ...member, pending_balance_minor: 3250, has_pending_balance: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.getByRole('heading', { name: 'Socio B' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Socio Real' })).not.toBeInTheDocument();
  });

  it('ignores member detail responses that complete after logout', async () => {
    let finishDetail!: (value: typeof member & { pending_balance_minor: number; has_pending_balance: boolean }) => void;
    detail.mockImplementationOnce(() => new Promise(resolve => { finishDetail = resolve; }));
    render(<LiveMemberLookup />);
    fireEvent.change(screen.getByLabelText('Buscar por número, nombre o teléfono'), { target: { value: 'M-10' } });
    fireEvent.click(await screen.findByRole('button', { name: /M-10/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'reception' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByLabelText('Buscar por número, nombre o teléfono')).toBeInTheDocument();
    finishDetail({ ...member, pending_balance_minor: 3250, has_pending_balance: true });
    expect(await screen.findByRole('heading', { name: 'Recepción operativa' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

});
