import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GimiDashboard } from './GimiDashboard';
import { DemoProvider } from '../../demo/DemoProvider';

describe('GimiDashboard', () => {
  it('renders the header and switches between Monitor and Vault tabs', async () => {
    render(
      <DemoProvider>
        <GimiDashboard />
      </DemoProvider>
    );

    expect(screen.getByText('Monitor y Base de Conocimiento de Gimi')).toBeVisible();

    const monitorTab = screen.getByRole('button', { name: 'Monitor & Alertas' });
    const vaultTab = screen.getByRole('button', { name: 'Vault de Conocimiento (RAG)' });

    expect(monitorTab).toHaveClass('active');

    // Switch to Vault tab
    await userEvent.click(vaultTab);
    expect(vaultTab).toHaveClass('active');
    expect(screen.getByText('Vault de Documentos y Conocimiento')).toBeVisible();
    expect(screen.getByRole('button', { name: '+ Agregar documento al Vault' })).toBeVisible();

    // Switch back to Monitor tab
    await userEvent.click(monitorTab);
    expect(screen.getByText('Conversaciones Atendidas')).toBeVisible();
    expect(screen.getByText('Alertas en Tiempo Real')).toBeVisible();
  });

  it('renders the 4 Bento KPIs, intent bars, and allows resolving an alert in Monitor tab', async () => {
    render(
      <DemoProvider>
        <GimiDashboard />
      </DemoProvider>
    );

    // KPIs
    expect(screen.getByText('Conversaciones Atendidas')).toBeVisible();
    expect(screen.getByText('Resolución Autónoma')).toBeVisible();
    expect(screen.getByText('Alertas Pendientes')).toBeVisible();
    expect(screen.getByText('Consultas de Venta')).toBeVisible();

    // Intent bars
    expect(screen.getByText('Desglose por Intención')).toBeVisible();
    expect(screen.getAllByText('Dudas y Horarios')[0]).toBeVisible();
    expect(screen.getAllByText('Ventas y Membresías')[0]).toBeVisible();

    // Alerts
    const resolveBtns = screen.getAllByRole('button', { name: 'Marcar como atendida' });
    expect(resolveBtns.length).toBeGreaterThanOrEqual(1);

    await userEvent.click(resolveBtns[0]);
    expect(screen.getAllByText('✓ Atendida').length).toBeGreaterThanOrEqual(1);
  });

  it('filters conversations by channel in Monitor tab', async () => {
    render(
      <DemoProvider>
        <GimiDashboard />
      </DemoProvider>
    );

    expect(screen.getByRole('table', { name: 'Historial de conversaciones con Gimi' })).toBeVisible();

    // Filter by WhatsApp
    const whatsappBtn = screen.getByRole('button', { name: /WhatsApp/i });
    await userEvent.click(whatsappBtn);
    expect(whatsappBtn).toHaveClass('active');

    // Filter by Web
    const webBtn = screen.getByRole('button', { name: /Web/i });
    await userEvent.click(webBtn);
    expect(webBtn).toHaveClass('active');
  });

  it('displays Vault resources with expiry badges and allows adding a new document', async () => {
    render(
      <DemoProvider>
        <GimiDashboard />
      </DemoProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Vault de Conocimiento (RAG)' }));

    // Pre-existing vault cards
    expect(screen.getByText('Promoción de Otoño: 2x1 en inscripción trimestral Gym')).toBeVisible();
    expect(screen.getByText('Horario especial de fin de año 2025')).toBeVisible();
    expect(screen.getByText('Expirado · Excluido de RAG')).toBeVisible();

    // Open Add Document Modal
    await userEvent.click(screen.getByRole('button', { name: '+ Agregar documento al Vault' }));

    expect(screen.getByRole('dialog', { name: 'Nuevo Recurso de Conocimiento' })).toBeVisible();

    // Fill Form
    await userEvent.type(screen.getByLabelText(/Título del documento/), 'Promo Navideña 2026');
    await userEvent.type(screen.getByLabelText(/Contenido del recurso/), '50% en inscripción anual de boxeo.');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar en Vault' }));

    // Verify it was added to the grid
    expect(screen.getByText('Promo Navideña 2026')).toBeVisible();
  });
});
