import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function Harness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Editar" dismissible={dismissible}
        footer={<button onClick={() => setOpen(false)}>Guardar</button>}>
        <input aria-label="Nombre" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders with an accessible name and description', () => {
    render(<Dialog open onClose={() => {}} title="Titulo" description="Detalle"><p>x</p></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Titulo' });
    expect(dialog).toHaveAccessibleDescription('Detalle');
  });

  it('renders nothing visible when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="Titulo"><p>x</p></Dialog>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose on cancel event and prevents default', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T"><p>x</p></Dialog>);
    const ev = new Event('cancel', { cancelable: true });
    screen.getByRole('dialog').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape keydown only when dismissible', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open onClose={onClose} title="T"><p>x</p></Dialog>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Dialog open onClose={onClose} title="T" dismissible={false}><p>x</p></Dialog>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when dismissible is false', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T" dismissible={false}><p>x</p></Dialog>);
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled();
  });

  it('closes on backdrop click but not on panel click', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="T"><p>contenido</p></Dialog>);
    fireEvent.click(screen.getByText('contenido'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps focus with Tab and Shift+Tab', () => {
    render(<Dialog open onClose={() => {}} title="T" footer={<button>Fin</button>}><input aria-label="Uno" /></Dialog>);
    const close = screen.getByRole('button', { name: 'Cerrar' });
    const last = screen.getByRole('button', { name: 'Fin' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('focuses first tabbable in body and restores focus to trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(trigger).toHaveFocus();
  });

  it('honors initialFocusRef', () => {
    function WithRef() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Dialog open onClose={() => {}} title="T" initialFocusRef={ref}>
          <input aria-label="Uno" />
          <button ref={ref}>Destino</button>
        </Dialog>
      );
    }
    render(<WithRef />);
    expect(screen.getByRole('button', { name: 'Destino' })).toHaveFocus();
  });
});
