import React, { useState, useEffect, useCallback } from 'react';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import {
  getGimiOverview,
  listKnowledgeChunks,
  createKnowledgeRule,
  deleteKnowledgeChunk,
  listNotificationsOutbox,
  deliverOutboxBatch,
  type GimiOverviewResponse,
  type KnowledgeChunk,
  type NotificationOutboxItem,
  type CreateRulePayload,
} from '../../api/ownerGimiApi';
import { Badge, Button, EmptyState, Notice, PageHeader, Panel } from '../../shared/ui';
import { Dialog } from '../../shared/components/ui/Dialog';
import { LiveGimiChatPane } from './LiveGimiChatPane';
import './GimiDashboard.css';

const CATEGORY_LABELS: Record<string, string> = {
  tariffs_promos: 'Tarifas y Promociones',
  schedules_classes: 'Horarios y Clases',
  regulations: 'Normativa y Políticas',
  supplements_store: 'Suplementos y Tienda',
};

export function LiveGimiDashboard({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const [activeTab, setActiveTab] = useState<'chat' | 'monitor' | 'vault' | 'outbox'>('chat');
  const [overview, setOverview] = useState<GimiOverviewResponse | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [notifications, setNotifications] = useState<NotificationOutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formRef, setFormRef] = useState('');
  const [formCategory, setFormCategory] = useState<CreateRulePayload['category']>('regulations');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filter State
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [delivering, setDelivering] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ovData, chData, notifData] = await Promise.all([
        getGimiOverview(apiRequest),
        listKnowledgeChunks(apiRequest),
        listNotificationsOutbox(apiRequest),
      ]);
      setOverview(ovData);
      setChunks(chData);
      setNotifications(notifData);
    } catch {
      setError('No se pudo conectar con el servicio en vivo de Gimi y Notificaciones.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.trim() || !formTitle.trim() || !formContent.trim()) return;

    setSubmitting(true);
    try {
      await createKnowledgeRule(apiRequest, {
        ref: formRef.trim(),
        category: formCategory,
        title: formTitle.trim(),
        content: formContent.trim(),
      });
      setIsModalOpen(false);
      setFormRef('');
      setFormTitle('');
      setFormContent('');
      setActionNotice({ message: 'Documento indexado con éxito en la bóveda RAG.', tone: 'success' });
      await loadAll();
    } catch {
      setActionNotice({ message: 'Error al indexar el documento en la base de datos.', tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteChunk = async (id: string, title: string) => {
    if (!window.confirm(`¿Confirmas eliminar el documento "${title}"?`)) return;
    try {
      await deleteKnowledgeChunk(apiRequest, id);
      setActionNotice({ message: 'Documento eliminado de la bóveda.', tone: 'success' });
      await loadAll();
    } catch {
      setActionNotice({ message: 'No se pudo eliminar el documento.', tone: 'error' });
    }
  };

  const handleDeliverOutbox = async () => {
    setDelivering(true);
    try {
      const result = await deliverOutboxBatch(apiRequest, 10);
      setActionNotice({
        message: `Despacho ejecutado: ${result.attempted} notificaciones procesadas.`,
        tone: 'success',
      });
      await loadAll();
    } catch {
      setActionNotice({ message: 'Fallo al procesar el lote de outbox.', tone: 'error' });
    } finally {
      setDelivering(false);
    }
  };

  const filteredChunks = chunks.filter(c => sourceFilter === 'all' || c.source_kind === sourceFilter);

  return (
    <div className="gimi-dashboard">
      <PageHeader
        eyebrow="PROPIETARIO · ASISTENTE Y NOTIFICACIONES"
        title="Monitor y Conocimiento de Gimi"
        description="Supervisión en tiempo real de conversaciones de WhatsApp, motor de outbox y bóveda vectorial RAG."
      />

      {error && <Notice tone="error">{error}</Notice>}
      {actionNotice && (
        <Notice tone={actionNotice.tone}>
          {actionNotice.message}
        </Notice>
      )}

      {/* Tabs */}
      <div className="gimi-header-nav-tabs tab-buttons mb-4" role="tablist" aria-label="Secciones de Gimi">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          className={`gimi-tab-btn tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          💬 Chat con Gimi
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'monitor'}
          className={`gimi-tab-btn tab-btn ${activeTab === 'monitor' ? 'active' : ''}`}
          onClick={() => setActiveTab('monitor')}
        >
          Monitor de Operaciones
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'vault'}
          className={`gimi-tab-btn tab-btn ${activeTab === 'vault' ? 'active' : ''}`}
          onClick={() => setActiveTab('vault')}
        >
          Bóveda RAG ({chunks.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'outbox'}
          className={`gimi-tab-btn tab-btn ${activeTab === 'outbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('outbox')}
        >
          Cola de Notificaciones ({notifications.length})
        </button>
      </div>

      {activeTab === 'chat' ? (
        <LiveGimiChatPane apiRequest={apiRequest} />
      ) : loading && !overview ? (
        <Panel>
          <div className="p-8 text-center text-muted">Cargando datos de Gimi y notificaciones...</div>
        </Panel>
      ) : (
        <>
          {activeTab === 'monitor' && overview && (
            <div className="space-y-6">
              {/* KPI Grid */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Panel className="kpi-card">
                  <div className="text-sm font-medium text-muted">Total Conversaciones</div>
                  <div className="text-3xl font-bold">{overview.kpis.total_conversations}</div>
                  <div className="text-xs text-muted">Entrantes en WhatsApp</div>
                </Panel>
                <Panel className="kpi-card">
                  <div className="text-sm font-medium text-muted">Autonomía</div>
                  <div className="text-3xl font-bold text-success">{overview.kpis.autonomous_rate}%</div>
                  <div className="text-xs text-muted">Respuestas sin escalación</div>
                </Panel>
                <Panel className="kpi-card">
                  <div className="text-sm font-medium text-muted">Documentos RAG</div>
                  <div className="text-3xl font-bold">{overview.kpis.knowledge_chunks_count}</div>
                  <div className="text-xs text-muted">Indexados con embeddings</div>
                </Panel>
                <Panel className="kpi-card">
                  <div className="text-sm font-medium text-muted">Cola de Notificaciones</div>
                  <div className="text-3xl font-bold">{overview.outbox.total}</div>
                  <div className="text-xs text-muted">Mensajes en outbox</div>
                </Panel>
              </div>

              {/* Outcomes Breakdown */}
              <Panel>
                <h3 className="font-bold text-base mb-4">Desglose por Resultado de Mensajes</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 rounded bg-surface">
                    <div className="text-2xl font-bold text-success">{overview.outcomes.answered || 0}</div>
                    <div className="text-sm text-muted">Atendidos por IA</div>
                  </div>
                  <div className="p-4 rounded bg-surface">
                    <div className="text-2xl font-bold text-warning">{overview.outcomes.unverified || 0}</div>
                    <div className="text-sm text-muted">Números No Registrados</div>
                  </div>
                  <div className="p-4 rounded bg-surface">
                    <div className="text-2xl font-bold text-muted">{overview.outcomes.ignored || 0}</div>
                    <div className="text-sm text-muted">Duplicados / Ignorados</div>
                  </div>
                </div>
              </Panel>

              {/* Recent WhatsApp Messages */}
              <Panel>
                <h3 className="font-bold text-base mb-4">Actividad Reciente de WhatsApp</h3>
                {overview.recent_messages.length === 0 ? (
                  <EmptyState title="Sin mensajes registrados">
                    No se han registrado mensajes entrantes de WhatsApp todavía.
                  </EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>ID Mensaje</th>
                          <th>Tipo</th>
                          <th>Resultado</th>
                          <th>Herramienta</th>
                          <th>Fecha y Hora</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.recent_messages.map(msg => (
                          <tr key={msg.id}>
                            <td className="font-mono text-xs">{msg.provider_message_id}</td>
                            <td>{msg.message_type}</td>
                            <td>
                              <Badge tone={msg.outcome === 'answered' ? 'success' : msg.outcome === 'unverified' ? 'warning' : 'neutral'}>
                                {msg.outcome}
                              </Badge>
                            </td>
                            <td><span className="font-mono text-xs">{msg.tool || '—'}</span></td>
                            <td className="text-sm text-muted">{msg.received_at ? new Date(msg.received_at).toLocaleString('es-MX') : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          )}

          {activeTab === 'vault' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn-filter ${sourceFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSourceFilter('all')}
                  >
                    Todos ({chunks.length})
                  </button>
                  <button
                    type="button"
                    className={`btn-filter ${sourceFilter === 'rule' ? 'active' : ''}`}
                    onClick={() => setSourceFilter('rule')}
                  >
                    Reglas y Políticas ({chunks.filter(c => c.source_kind === 'rule').length})
                  </button>
                  <button
                    type="button"
                    className={`btn-filter ${sourceFilter === 'plan' ? 'active' : ''}`}
                    onClick={() => setSourceFilter('plan')}
                  >
                    Planes del Catálogo ({chunks.filter(c => c.source_kind === 'plan').length})
                  </button>
                </div>
                <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                  + Nuevo Documento
                </Button>
              </div>

              {filteredChunks.length === 0 ? (
                <Panel>
                  <EmptyState title="Bóveda vacía">
                    No se encontraron documentos en la bóveda con el filtro seleccionado.
                  </EmptyState>
                </Panel>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredChunks.map(chunk => (
                    <Panel key={chunk.id} className="relative flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                            {chunk.source_kind === 'plan' ? 'Plan Publicado' : (CATEGORY_LABELS[chunk.source_ref.split('/')[0]] || chunk.source_ref)}
                          </span>
                          <span className="text-xs text-muted">Bóveda activa</span>
                        </div>
                        <h3 className="text-lg font-bold mb-2">{chunk.title}</h3>
                        <p className="text-sm text-muted whitespace-pre-line line-clamp-4">{chunk.content}</p>
                      </div>
                      <div className="mt-4 pt-3 border-t flex items-center justify-between">
                        <span className="text-xs text-muted">Disponible para respuestas</span>
                        {chunk.source_kind === 'rule' && (
                          <button
                            type="button"
                            className="text-xs text-danger hover:underline"
                            onClick={() => handleDeleteChunk(chunk.id, chunk.title)}
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'outbox' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold">Cola de Salida de Notificaciones</h3>
                  <p className="text-sm text-muted">Garantía transaccional de entrega con reintentos exponenciales.</p>
                </div>
                <Button
                  variant="primary"
                  onClick={handleDeliverOutbox}
                  disabled={delivering}
                >
                  {delivering ? 'Despachando...' : 'Despachar Cola Ahora'}
                </Button>
              </div>

              {notifications.length === 0 ? (
                <Panel>
                  <EmptyState title="Cola limpia">
                    La cola de notificaciones se encuentra vacía.
                  </EmptyState>
                </Panel>
              ) : (
                <Panel>
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>Destino</th>
                          <th>Canal</th>
                          <th>Tipo</th>
                          <th>Estatus</th>
                          <th>Intentos</th>
                          <th>Mensaje</th>
                          <th>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {notifications.map(item => (
                          <tr key={item.id}>
                            <td className="font-mono text-sm">{item.recipient}</td>
                            <td><Badge tone="neutral">{item.channel}</Badge></td>
                            <td>{item.kind}</td>
                            <td>
                              <Badge
                                tone={
                                  item.status === 'sent'
                                    ? 'success'
                                    : item.status === 'pending'
                                    ? 'warning'
                                    : 'error'
                                }
                              >
                                {item.status}
                              </Badge>
                            </td>
                            <td>{item.attempts} / {item.max_attempts}</td>
                            <td className="text-xs text-muted max-w-xs truncate" title={item.body}>
                              {item.body}
                            </td>
                            <td className="text-xs text-muted">
                              {item.created_at ? new Date(item.created_at).toLocaleString('es-MX') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>
          )}
        </>
      )}

      {/* Add Document Modal */}
      <Dialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Nuevo Documento de Conocimiento"
      >
        <form onSubmit={handleAddRule} className="space-y-4">
          <div className="field">
            <label htmlFor="rule-ref">Identificador / Referencia</label>
            <input
              id="rule-ref"
              type="text"
              required
              placeholder="ej. reglamento-toalla"
              value={formRef}
              onChange={e => setFormRef(e.target.value)}
              className="input w-full"
            />
          </div>
          <div className="field">
            <label htmlFor="rule-category">Categoría de Contenido</label>
            <select
              id="rule-category"
              value={formCategory}
              onChange={e => setFormCategory(e.target.value as CreateRulePayload['category'])}
              className="select w-full"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rule-title">Título</label>
            <input
              id="rule-title"
              type="text"
              required
              placeholder="Título descriptivo del documento"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              className="input w-full"
            />
          </div>
          <div className="field">
            <label htmlFor="rule-content">Contenido del Documento</label>
            <textarea
              id="rule-content"
              required
              rows={5}
              placeholder="Redacta la política o instrucción detallada para la IA..."
              value={formContent}
              onChange={e => setFormContent(e.target.value)}
              className="textarea w-full"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Indexando...' : 'Guardar e Indexar'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
