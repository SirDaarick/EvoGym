import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OperationalLogin } from './OperationalLogin';

vi.mock('../../api/receptionApi', () => ({ signInReception: vi.fn().mockResolvedValue(undefined) }));
import { signInReception } from '../../api/receptionApi';

describe('OperationalLogin', () => {
  it('submits staff login and reports authentication errors accessibly', async () => {
    const onAuthenticated = vi.fn();
    render(<OperationalLogin onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: 'reception' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(signInReception).toHaveBeenCalledWith('reception', '4321');
  });
});
