import type { AuthenticatedRequest } from './membershipCheckoutApi';

export interface GimiKpis {
  total_conversations: number;
  whatsapp_count: number;
  web_count: number;
  pending_alerts: number;
  autonomous_rate: number;
  knowledge_chunks_count: number;
}

export interface GimiRecentMessage {
  id: string;
  provider_message_id: string;
  message_type: string;
  outcome: 'answered' | 'unverified' | 'ignored' | string;
  tool: string | null;
  received_at: string | null;
}

export interface GimiOverviewResponse {
  kpis: GimiKpis;
  outcomes: Record<string, number>;
  intents: Record<string, number>;
  outbox: {
    total: number;
    statuses: Record<string, number>;
  };
  recent_messages: GimiRecentMessage[];
}

export interface KnowledgeChunk {
  id: string;
  source_kind: 'rule' | 'plan' | string;
  source_ref: string;
  title: string;
  content: string;
  content_hash: string;
  embedding_model: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateRulePayload {
  ref: string;
  category: 'tariffs_promos' | 'schedules_classes' | 'regulations' | 'supplements_store';
  title: string;
  content: string;
}

export interface NotificationOutboxItem {
  id: string;
  idempotency_key: string;
  channel: string;
  kind: string;
  recipient: string;
  body: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'dead' | string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string | null;
}

export async function getGimiOverview(request: AuthenticatedRequest): Promise<GimiOverviewResponse> {
  const response = await request('/api/v1/owner/gimi/overview');
  if (!response.ok) throw new Error('No se pudo cargar el resumen de Gimi.');
  return response.json();
}

export async function listKnowledgeChunks(
  request: AuthenticatedRequest,
  sourceKind?: string
): Promise<KnowledgeChunk[]> {
  const query = sourceKind ? `?source_kind=${encodeURIComponent(sourceKind)}` : '';
  const response = await request(`/api/v1/owner/gimi/knowledge${query}`);
  if (!response.ok) throw new Error('No se pudo listar la bóveda de conocimiento.');
  return response.json();
}

export async function createKnowledgeRule(
  request: AuthenticatedRequest,
  payload: CreateRulePayload
): Promise<{ inserted: number; re_embedded: number; unchanged: number }> {
  const response = await request('/api/v1/owner/gimi/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('No se pudo crear la regla de conocimiento.');
  return response.json();
}

export async function deleteKnowledgeChunk(
  request: AuthenticatedRequest,
  chunkId: string
): Promise<{ ok: boolean }> {
  const response = await request(`/api/v1/owner/gimi/knowledge/${encodeURIComponent(chunkId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('No se pudo eliminar el documento de conocimiento.');
  return response.json();
}

export async function listNotificationsOutbox(
  request: AuthenticatedRequest,
  status?: string
): Promise<NotificationOutboxItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await request(`/api/v1/owner/gimi/notifications${query}`);
  if (!response.ok) throw new Error('No se pudo cargar la cola de notificaciones.');
  return response.json();
}

export async function deliverOutboxBatch(
  request: AuthenticatedRequest,
  batchSize: number = 10
): Promise<{ attempted: number }> {
  const response = await request('/api/v1/owner/gimi/notifications/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: batchSize }),
  });
  if (!response.ok) throw new Error('No se pudo ejecutar el despacho de notificaciones.');
  return response.json();
}
