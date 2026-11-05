import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LiveGimiDashboard } from './LiveGimiDashboard';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';

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

  it('renders live KPIs and WhatsApp inbound messages', async () => {
    const apiRequest = createMockApiRequest();
    render(<LiveGimiDashboard apiRequest={apiRequest} />);

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
