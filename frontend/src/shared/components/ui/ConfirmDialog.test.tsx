import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('shows title, message and default labels', () => {
    render(<ConfirmDialog open title="Eliminar" message="Seguro?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Eliminar' })).toHaveAccessibleDescription('Seguro?');
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('invokes onConfirm and onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="T" message="M" confirmLabel="Si" cancelLabel="No" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Si' }));
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('blocks dismissal and actions while busy', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open busy title="T" message="M" onConfirm={() => {}} onCancel={onCancel} />);
    screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });
});
