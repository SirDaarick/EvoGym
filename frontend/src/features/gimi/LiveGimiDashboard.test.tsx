import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LiveGimiDashboard } from './LiveGimiDashboard';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';

// Mock scrollIntoView for jsdom
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const mockOverview = {
  kpis: {
    total_conversations: 42,
    whatsapp_count: 42,
    web_count: 0,
    pending_alerts: 1,
    autonomous_rate: 85,
    knowledge_chunks_count: 3,
  },
  outcomes: {
    answered: 36,
    unverified: 4,
    ignored: 2,
  },
  intents: {
    member_pending_balance: 20,
    member_membership_status: 16,
  },
  outbox: {
    total: 5,
    statuses: {
      sent: 4,
      pending: 1,
    },
  },
  recent_messages: [
    {
      id: 'msg-1',
      provider_message_id: 'wam_001',
      message_type: 'text',
      outcome: 'answered',
      tool: 'member_pending_balance',
      received_at: '2026-11-04T12:00:00Z',
    },
  ],
};

const mockChunks = [
  {
    id: 'chunk-1',
    source_kind: 'rule',
    source_ref: 'regulations/reglamento-toalla',
    title: 'Reglamento de Toalla',
    content: 'Uso obligatorio de toalla en el gimnasio.',
    content_hash: 'abc123456789',
    embedding_model: 'fake-hash-bow-v1',
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  },
];

const mockNotifications = [
  {
    id: 'notif-1',
    idempotency_key: 'key-1',
    channel: 'whatsapp',
    kind: 'welcome',
    recipient: '+525512345678',
    body: 'Bienvenido!',
    status: 'pending',
    attempts: 0,
    max_attempts: 6,
    next_attempt_at: '2026-11-04T12:00:00Z',
    sent_at: null,
    provider_message_id: null,
    last_error: null,
    created_at: '2026-11-04T11:59:00Z',
  },
];

describe('LiveGimiDashboard', () => {
  function createMockApiRequest() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/owner/gimi/overview')) {
        return { ok: true, json: async () => mockOverview } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/chat') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}'));
        if (body.confirmed) {
          return {
            ok: true,
            json: async () => ({
              reply_text: 'Gasto de $350.00 MXN registrado exitosamente en caja.',
              tool_called: 'staff_record_expense',
              status: 'executed',
              confidence: 0.95,
              needs_confirmation: false,
              data: { expense_id: 'exp_01', amount: 35000 },
            }),
          } as Response;
        }
        if (body.message?.includes('gasto')) {
          return {
            ok: true,
            json: async () => ({
              reply_text: 'He preparado el borrador para registrar el gasto de mantenimiento.',
              tool_called: 'staff_record_expense',
              status: 'needs_confirmation',
              confidence: 0.92,
              needs_confirmation: true,
              draft_action: { concept: 'Reparación polea', amount_mxn: 350, category: 'Mantenimiento' },
              data: {},
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            reply_text: 'Los ingresos de este mes son $45,200.00 MXN con 38 transacciones.',
            tool_called: 'owner_financial_overview',
            status: 'executed',
            confidence: 0.94,
            needs_confirmation: false,
            data: { total_income_mxn: 45200 },
          }),
        } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/knowledge') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ inserted: 1, re_embedded: 0, unchanged: 0 }) } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/knowledge') && init?.method === 'DELETE') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/knowledge')) {
        return { ok: true, json: async () => mockChunks } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/notifications/deliver') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ attempted: 1 }) } as Response;
      }
      if (url.includes('/api/v1/owner/gimi/notifications')) {
        return { ok: true, json: async () => mockNotifications } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as unknown as AuthenticatedRequest;
  }

  it('renders live chat tab by default, sends message and displays Gimi reply with Jev tool badge', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    // Default tab is chat
    expect(await screen.findByText(/Gimi Operativo & Financiero/)).toBeVisible();
    expect(screen.getByText(/tu copiloto operativo y financiero en EvoGym/)).toBeVisible();

    const input = screen.getByLabelText('Mensaje para Gimi');
    const sendBtn = screen.getByRole('button', { name: 'Enviar' });

    await userEvent.type(input, '¿Cómo van los ingresos de hoy?');
    await userEvent.click(sendBtn);

    expect(await screen.findByText('¿Cómo van los ingresos de hoy?')).toBeVisible();
    expect(await screen.findByText(/Los ingresos de este mes son \$45,200.00 MXN/)).toBeVisible();
    expect(screen.getByText(/owner_financial_overview/)).toBeVisible();
    expect(screen.getByText(/Confianza Jev: 94%/)).toBeVisible();
  });

  it('handles quick suggestion chip click to send prompt immediately', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    const chip = await screen.findByRole('button', { name: '¿Cómo van los ingresos y el corte de este mes?' });
    await userEvent.click(chip);

    expect(await screen.findByText(/Los ingresos de este mes son \$45,200.00 MXN/)).toBeVisible();
    expect(screen.getAllByText('¿Cómo van los ingresos y el corte de este mes?').length).toBeGreaterThanOrEqual(2);
  });

  it('handles Draft & Confirm gate for mutating actions', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    const input = await screen.findByLabelText('Mensaje para Gimi');
    const sendBtn = screen.getByRole('button', { name: 'Enviar' });

    await userEvent.type(input, 'Registra un gasto de 350 por reparar polea');
    await userEvent.click(sendBtn);

    expect(await screen.findByText(/He preparado el borrador para registrar el gasto/)).toBeVisible();
    expect(screen.getByText(/Autorización Requerida/i)).toBeVisible();
    expect(screen.getByText('Reparación polea')).toBeVisible();

    const confirmBtn = screen.getByRole('button', { name: /Confirmar y Ejecutar/i });
    await userEvent.click(confirmBtn);

    expect(await screen.findByText(/Gasto de \$350\.00 MXN registrado exitosamente en caja/)).toBeVisible();
    expect(screen.getByText(/Operación Ejecutada/i)).toBeVisible();
  });

  it('switches to Monitor tab and displays live KPIs and WhatsApp inbound messages', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    const monitorTab = await screen.findByRole('tab', { name: /Monitor de Operaciones/ });
    await userEvent.click(monitorTab);

    expect(await screen.findByText('42')).toBeVisible();
    expect(screen.getByText('85%')).toBeVisible();
    expect(screen.getByText('36')).toBeVisible();
    expect(screen.getByText('wam_001')).toBeVisible();
  });

  it('switches to Vault tab, displays documents, and opens Add Modal', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    const vaultTab = await screen.findByRole('tab', { name: /Bóveda RAG/ });
    await userEvent.click(vaultTab);

    expect(await screen.findByText('Reglamento de Toalla')).toBeVisible();
    expect(screen.getByText('Uso obligatorio de toalla en el gimnasio.')).toBeVisible();

    const addBtn = screen.getByRole('button', { name: '+ Nuevo Documento' });
    await userEvent.click(addBtn);

    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText(/Identificador \/ Referencia/)).toBeVisible();
    expect(screen.getByLabelText(/Título/)).toBeVisible();
  });

  it('switches to Outbox tab and triggers batch delivery', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

    const outboxTab = await screen.findByRole('tab', { name: /Cola de Notificaciones/ });
    await userEvent.click(outboxTab);

    expect(await screen.findByText('+525512345678')).toBeVisible();
    expect(screen.getByText('Bienvenido!')).toBeVisible();

    const deliverBtn = screen.getByRole('button', { name: 'Despachar Cola Ahora' });
    await userEvent.click(deliverBtn);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v1/owner/gimi/notifications/deliver', expect.objectContaining({
        method: 'POST',
      }));
    });
  });
});
