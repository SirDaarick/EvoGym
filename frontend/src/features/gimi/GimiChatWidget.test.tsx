import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GimiChatWidget } from './GimiChatWidget';
import { DemoProvider } from '../../demo/DemoProvider';

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
