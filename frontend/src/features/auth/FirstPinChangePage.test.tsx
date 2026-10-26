import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { FirstPinChangePage } from './FirstPinChangePage';

const branchId = '123e4567-e89b-42d3-a456-426614174000';
const otherBranchId = '123e4567-e89b-42d3-a456-426614174010';
function response(status: number) { return new Response(null, { status }); }

function BranchContextSwitcher() {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate(`/staff/first-pin-change?branch_id=${otherBranchId}`)}>Switch branch context</button>
    <button type="button" onClick={() => navigate(`/staff/first-pin-change?branch_id=${branchId}`)}>Return branch context</button>
  </>;
}

describe('FirstPinChangePage', () => {
  it('fails closed without valid branch context and never calls the public API', async () => {
    const fetchImpl = vi.fn();
    render(<MemoryRouter initialEntries={['/staff/first-pin-change?branch_id=bad']}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
    </MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('missing valid branch context');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the same existing profile-entry card and brand presentation as profile selection', async () => {
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={vi.fn()} />
    </MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Change your initial PIN' })).toBeInTheDocument();
    expect(document.querySelector('.staff-selection-page')).toBeInTheDocument();
    expect(document.querySelector('.staff-selection-container')).toBeInTheDocument();
    expect(document.querySelector('.staff-logo-mark img')).toHaveAttribute('alt', 'EvoGym');
  });

  it.each([401, 204])('clears PINs and discards a pending old-branch HTTP %i result after context changes and returns', async status => {
    let resolveRequest!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveRequest = resolve; });
    const fetchImpl = vi.fn().mockReturnValue(pending);
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <BranchContextSwitcher />
      <Routes><Route path="/staff/first-pin-change" element={
        <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
      } /></Routes>
    </MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Login identifier'), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText('Temporary current PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Switch branch context' }));
    expect(screen.getByLabelText('Temporary current PIN')).toHaveValue('');
    expect(screen.getByLabelText('New six-digit PIN')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new PIN')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Changing PIN…' })).toBeDisabled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Return branch context' }));
    resolveRequest(response(status));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('validates matching six-digit PINs and clears secrets after a successful 204', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(204));
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
    </MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Login identifier'), { target: { value: 'employee@example.test' } });
    fireEvent.change(screen.getByLabelText('Temporary current PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(screen.getByRole('alert')).toHaveTextContent('different from your current PIN');
    expect(fetchImpl).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Your PIN was changed');
    expect(screen.getByLabelText('Temporary current PIN')).toHaveValue('');
    expect(screen.getByLabelText('New six-digit PIN')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new PIN')).toHaveValue('');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/api/v1/staff/credentials/first-change');
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', method: 'POST' });
    expect(init.headers).not.toHaveProperty('Authorization');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ login_identifier: 'employee@example.test', branch_id: branchId, current_pin: '123456', new_pin: '654321' });
    expect(window.location.href).not.toContain('123456');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('clears PINs after a safe authentication error without exposing backend detail', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'private backend diagnostic' }), { status: 401 }));
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
    </MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Login identifier'), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText('Temporary current PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be verified');
    expect(document.body).not.toHaveTextContent('private backend diagnostic');
    expect(screen.getByLabelText('Temporary current PIN')).toHaveValue('');
    expect(screen.getByLabelText('New six-digit PIN')).toHaveValue('');
  });

  it.each([
    [413, 'submitted information is too large'],
    [503, 'could not be changed. Check your connection'],
  ])('shows a safe message and clears secrets after HTTP %i', async (status, expectedMessage) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'secret server diagnostics' }), { status }));
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
    </MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Login identifier'), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText('Temporary current PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(expectedMessage);
    expect(document.body).not.toHaveTextContent('secret server diagnostics');
    expect(screen.getByLabelText('Temporary current PIN')).toHaveValue('');
    expect(screen.getByLabelText('New six-digit PIN')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new PIN')).toHaveValue('');
  });

  it('maps a network failure without showing request or credential details', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('internal fetch diagnostic'));
    render(<MemoryRouter initialEntries={[`/staff/first-pin-change?branch_id=${branchId}`]}>
      <FirstPinChangePage apiOrigin="https://api.example.test" fetchImpl={fetchImpl} />
    </MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Login identifier'), { target: { value: 'employee' } });
    fireEvent.change(screen.getByLabelText('Temporary current PIN'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('New six-digit PIN'), { target: { value: '654321' } });
    fireEvent.change(screen.getByLabelText('Confirm new PIN'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be changed. Check your connection');
    expect(document.body).not.toHaveTextContent('internal fetch diagnostic');
    expect(screen.getByLabelText('Temporary current PIN')).toHaveValue('');
    expect(screen.getByLabelText('New six-digit PIN')).toHaveValue('');
  });
});
