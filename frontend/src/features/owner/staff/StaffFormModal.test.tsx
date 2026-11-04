import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StaffFormModal } from './StaffFormModal';

describe('StaffFormModal inline validation', () => {
  it('shows inline errors on an empty submit instead of native validation', async () => {
    const onSave = vi.fn();
    render(<StaffFormModal staff={null} onSave={onSave} onClose={() => undefined} />);
    await userEvent.clear(screen.getByLabelText(/Sueldo mensual/));
    await userEvent.click(screen.getByRole('button', { name: 'Crear perfil' }));
    const name = screen.getByLabelText(/Nombre completo/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Ingresa el nombre completo.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Sueldo mensual/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Ingresa un sueldo mensual válido.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
