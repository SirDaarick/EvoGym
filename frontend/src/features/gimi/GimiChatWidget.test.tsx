import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { GimiChatWidget } from './GimiChatWidget';

function mount(role: 'OWNER' | 'RECEPTION' = 'OWNER') {
  return render(<DemoProvider><GimiChatWidget role={role} /></DemoProvider>);
}

function openAndSend() {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));
  fireEvent.change(screen.getByPlaceholderText(/Pregúntale a Gimi/), { target: { value: 'precios' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje a Gimi' }));
}

describe('Gimi interaction lifecycle', () => {
  beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('labels a non-modal dialog, input and message log', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: 'Mensaje para Gimi' })).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversación con Gimi' })).toHaveAttribute('aria-live', 'polite');
  });

  it('cancels an old response on reset and allows a new message', () => {
    mount();
    openAndSend();
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar conversación' }));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelectorAll('.gimi-message-wrap')).toHaveLength(1);
    expect(screen.getByPlaceholderText(/Pregúntale a Gimi/)).toBeEnabled();
  });

  it('cancels a pending response when role changes', () => {
    const view = mount();
    openAndSend();
    view.rerender(<DemoProvider><GimiChatWidget role="RECEPTION" /></DemoProvider>);
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelectorAll('.gimi-message-wrap')).toHaveLength(2);
    expect(screen.getByPlaceholderText(/Pregúntale a Gimi/)).toBeEnabled();
  });

  it('closes on Escape, restores launcher focus and preserves history', () => {
    mount();
    openAndSend();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir asistente Gimi' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));
    expect(screen.getByText('precios')).toBeInTheDocument();
  });

  it('preserves scrollback when a pending response arrives', () => {
    mount();
    openAndSend();
    const body = document.querySelector('.gimi-messages-body') as HTMLDivElement;
    Object.defineProperties(body, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 } });
    body.scrollTop = 100;
    fireEvent.scroll(body);
    act(() => { vi.advanceTimersByTime(500); });
    expect(body.scrollTop).toBe(100);
  });

  it('clears pending response and focus timers on unmount', () => {
    const view = mount();
    openAndSend();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports microphone errors inline and disconnects recognition on close', () => {
    const recognition = { start: vi.fn(), abort: vi.fn(), onerror: null as null | (() => void) };
    vi.stubGlobal('SpeechRecognition', class { constructor() { return recognition; } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hablar por micrófono' }));
    expect(recognition.start).toHaveBeenCalledOnce();
    act(() => recognition.onerror?.());
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo usar el micrófono');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar asistente' }));
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.onerror).toBeNull();
  });
});

describe('GimiChatWidget', () => {
  it('renders the floating launcher button and opens the modal on click', async () => {
    render(
      <DemoProvider>
        <GimiChatWidget role="RECEPTION" />
      </DemoProvider>
    );

    const launcher = screen.getByRole('button', { name: 'Abrir asistente Gimi' });
    expect(launcher).toBeVisible();
    expect(screen.getByText('Gimi AI')).toBeVisible();

    await userEvent.click(launcher);

    expect(screen.getByRole('dialog', { name: 'Asistente virtual Gimi' })).toBeVisible();
    expect(screen.getByText('Gimi · Asistente IA')).toBeVisible();
    expect(screen.getByText('Modo Recepción')).toBeVisible();
  });

  it('sends a user message and receives an intelligent assistant reply with suggestions', async () => {
    render(
      <DemoProvider>
        <GimiChatWidget role="OWNER" />
      </DemoProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));

    const input = screen.getByPlaceholderText(/Pregúntale a Gimi/);
    await userEvent.type(input, '¿Cuáles son las tarifas de membresía?{enter}');

    expect(screen.getByText('¿Cuáles son las tarifas de membresía?')).toBeVisible();

    await waitFor(() => {
      expect(screen.getByText(/tarifario oficial de EvoGym/i)).toBeVisible();
    }, { timeout: 3000 });

    expect(screen.getByText(/Gym Mensual:/i)).toBeVisible();
    expect(screen.getAllByText(/500 MXN/i)[0]).toBeVisible();
  });

  it('clicking a suggestion chip sends it as a message', async () => {
    render(
      <DemoProvider>
        <GimiChatWidget role="RECEPTION" />
      </DemoProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));

    const chip = screen.getByRole('button', { name: 'Disponibilidad de guantes y casilleros' });
    expect(chip).toBeVisible();

    await userEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByText(/Rentas y Disponibilidad actual:/i)).toBeVisible();
    }, { timeout: 3000 });
  });

  it('allows restarting the conversation with the reset button', async () => {
    render(
      <DemoProvider>
        <GimiChatWidget role="RECEPTION" />
      </DemoProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Abrir asistente Gimi' }));

    const resetBtn = screen.getByRole('button', { name: 'Reiniciar conversación' });
    await userEvent.click(resetBtn);

    expect(screen.getByText('¡Conversación reiniciada! ¿En qué más puedo orientarte?')).toBeVisible();
  });
});
