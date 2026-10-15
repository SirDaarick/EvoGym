import React, { useState, useMemo } from 'react';
import type {
  KnowledgeItem,
  KnowledgeCategory,
  KnowledgeStatus,
  ContactType,
  GimiConversation,
  GimiAlert,
} from '../../domain/gimi';
import {
  getStoredKnowledgeVault,
  saveStoredKnowledgeVault,
  getStoredAlerts,
  saveStoredAlerts,
  getStoredConversations,
  checkKnowledgeExpiry,
} from './gimiStore';
import { useDemo } from '../../demo/DemoProvider';
import { Badge, Button, EmptyState, Field, PageHeader, Panel } from '../../shared/ui';
import './GimiDashboard.css';

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  tariffs_promos: 'Tarifas y Promociones',
  schedules_classes: 'Horarios y Clases',
  regulations: 'Normativa y Políticas',
  supplements_store: 'Suplementos y Tienda',
};

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  inquiry: 'Dudas y Horarios',
  sales: 'Ventas y Membresías',
  customer_support: 'Atención y Quejas',
  internal_ops: 'Operaciones Internas',
};

export function GimiDashboard() {
  const { state } = useDemo();
  const [activeTab, setActiveTab] = useState<'monitor' | 'vault'>('monitor');

  // Vault state
  const [vaultItems, setVaultItems] = useState<KnowledgeItem[]>(() => getStoredKnowledgeVault());
  const [vaultFilter, setVaultFilter] = useState<'all' | 'active' | 'expiring' | 'expired'>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Vault Item Form
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<KnowledgeCategory>('tariffs_promos');
  const [newContent, setNewContent] = useState('');
  const [newExpiresAt, setNewExpiresAt] = useState('');
  const [newTags, setNewTags] = useState('');

  // Alerts state
  const [alerts, setAlerts] = useState<GimiAlert[]>(() => getStoredAlerts());
  const [conversations] = useState<GimiConversation[]>(() => getStoredConversations());
  const [conversationSearch, setConversationSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'web'>('all');

  const now = state.demoClock;

  // KPIs
  const totalConversations = conversations.length;
  const whatsappCount = conversations.filter(c => c.channel === 'whatsapp').length;
  const webCount = conversations.filter(c => c.channel === 'web').length;
  const pendingAlerts = alerts.filter(a => a.status === 'pending');
  const autonomousRate = Math.round(
    ((conversations.filter(c => c.status === 'resolved').length) / totalConversations) * 100
  );

  // Intent breakdown counts
  const intentCounts = useMemo(() => {
    const counts: Record<ContactType, number> = {
      inquiry: 0,
      sales: 0,
      customer_support: 0,
      internal_ops: 0,
    };
    for (const c of conversations) {
      counts[c.contactType] = (counts[c.contactType] || 0) + 1;
    }
    return counts;
  }, [conversations]);

  // Filtered Conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      const matchesSearch =
        c.clientName.toLowerCase().includes(conversationSearch.toLowerCase()) ||
        c.summary.toLowerCase().includes(conversationSearch.toLowerCase());
      const matchesChannel = channelFilter === 'all' || c.channel === channelFilter;
      return matchesSearch && matchesChannel;
    });
  }, [conversations, conversationSearch, channelFilter]);

  // Filtered Vault Items
  const filteredVault = useMemo(() => {
    return vaultItems.filter(item => {
      const expiry = checkKnowledgeExpiry(item, now);
      if (vaultFilter === 'active') return expiry.status === 'active';
      if (vaultFilter === 'expiring') return expiry.status === 'expiring_soon';
      if (vaultFilter === 'expired') return expiry.status === 'expired';
      return true;
    });
  }, [vaultItems, vaultFilter, now]);

  const handleResolveAlert = (alertId: string) => {
    const updated = alerts.map(a => (a.id === alertId ? { ...a, status: 'resolved' as const } : a));
    setAlerts(updated);
    saveStoredAlerts(updated);
  };

  const handleDeleteVaultItem = (id: string) => {
    const updated = vaultItems.filter(i => i.id !== id);
    setVaultItems(updated);
    saveStoredKnowledgeVault(updated);
  };

  const handleCreateVaultItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const newItem: KnowledgeItem = {
      id: `vault-${crypto.randomUUID().slice(0, 8)}`,
      title: newTitle.trim(),
      category: newCategory,
      content: newContent.trim(),
      createdAt: now,
      expiresAt: newExpiresAt ? `${newExpiresAt}T23:59:59-06:00` : null,
      tags: newTags
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean),
      authorName: 'Erick R. (Dueño)',
    };

    const updated = [newItem, ...vaultItems];
    setVaultItems(updated);
    saveStoredKnowledgeVault(updated);

    // Reset Form
    setNewTitle('');
    setNewCategory('tariffs_promos');
    setNewContent('');
    setNewExpiresAt('');
    setNewTags('');
    setIsAddModalOpen(false);
  };

  return (
    <div className="gimi-dashboard-root">
      <PageHeader
        eyebrow="PROPIETARIO · INTELIGENCIA ARTIFICIAL & RAG"
        title="Monitor y Base de Conocimiento de Gimi"
        description="Supervisa las conversaciones del agente, gestiona alertas en tiempo real y administra el Vault de documentos con vigencia para el RAG."
        action={
          <div className="gimi-header-nav-tabs">
            <button
              type="button"
              className={`gimi-tab-btn ${activeTab === 'monitor' ? 'active' : ''}`}
              onClick={() => setActiveTab('monitor')}
            >
              Monitor & Alertas
            </button>
            <button
              type="button"
              className={`gimi-tab-btn ${activeTab === 'vault' ? 'active' : ''}`}
              onClick={() => setActiveTab('vault')}
            >
              Vault de Conocimiento (RAG)
            </button>
          </div>
        }
      />

      {/* TAB 1: MONITOR & ALERTAS */}
      {activeTab === 'monitor' && (
        <section className="gimi-tab-content">
          {/* Bento KPI Grid */}
          <div className="gimi-kpi-grid">
            <div className="gimi-kpi-card">
              <span className="gimi-kpi-label">Conversaciones Atendidas</span>
              <div className="gimi-kpi-val-row">
                <span className="gimi-kpi-val">{totalConversations}</span>
                <Badge tone="neutral">{whatsappCount} WhatsApp · {webCount} Web</Badge>
              </div>
              <span className="gimi-kpi-desc">Total de clientes y personal orientados por Gimi.</span>
            </div>

            <div className="gimi-kpi-card">
              <span className="gimi-kpi-label">Resolución Autónoma</span>
              <div className="gimi-kpi-val-row">
                <span className="gimi-kpi-val">{autonomousRate}%</span>
                <Badge tone="success">Alta eficiencia</Badge>
              </div>
              <span className="gimi-kpi-desc">Dudas resueltas sin necesidad de intervención humana.</span>
            </div>

            <div className="gimi-kpi-card">
              <span className="gimi-kpi-label">Alertas Pendientes</span>
              <div className="gimi-kpi-val-row">
                <span className="gimi-kpi-val">{pendingAlerts.length}</span>
                <Badge tone={pendingAlerts.length > 0 ? 'warning' : 'neutral'}>
                  {pendingAlerts.length > 0 ? 'Requieren acción' : 'Sin pendientes'}
                </Badge>
              </div>
              <span className="gimi-kpi-desc">Casos escalados (ventas grupales, incidencias o quejas).</span>
            </div>

            <div className="gimi-kpi-card">
              <span className="gimi-kpi-label">Consultas de Venta</span>
              <div className="gimi-kpi-val-row">
                <span className="gimi-kpi-val">{intentCounts.sales}</span>
                <Badge tone="warning">Leads comerciales</Badge>
              </div>
              <span className="gimi-kpi-desc">Prospectos preguntando por planes y precios.</span>
            </div>
          </div>

          {/* Intenciones Bento & Live Alerts Grid */}
          <div className="gimi-monitor-columns">
            {/* Left: Contact Type Intent Breakdown */}
            <Panel className="gimi-intents-panel">
              <div className="gimi-panel-head">
                <h2>Desglose por Intención</h2>
                <span className="muted gimi-subhead">Clasificación de motivos de contacto</span>
              </div>

              <div className="gimi-intent-bars">
                {(Object.entries(CONTACT_TYPE_LABELS) as [ContactType, string][]).map(([type, label]) => {
                  const count = intentCounts[type] || 0;
                  const pct = Math.round((count / totalConversations) * 100) || 0;
                  return (
                    <div key={type} className="gimi-intent-item">
                      <div className="gimi-intent-meta">
                        <span className="gimi-intent-name">{label}</span>
                        <span className="gimi-intent-stats">{count} ({pct}%)</span>
                      </div>
                      <div className="gimi-bar-track" aria-hidden="true">
                        <div className={`gimi-bar-fill type-${type}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="gimi-rag-cost-note">
                💡 <strong>Ahorro en API Meta:</strong> Las consultas internas de recepción y dueños corren directamente en la web de EvoGym, evitando costos por mensaje de WhatsApp.
              </div>
            </Panel>

            {/* Right: Live Alerts Panel */}
            <Panel className="gimi-alerts-panel">
              <div className="gimi-panel-head">
                <h2>Alertas en Tiempo Real</h2>
                <span className="muted gimi-subhead">Atención humana sugerida</span>
              </div>

              <div className="gimi-alerts-list">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    className={`gimi-alert-card ${alert.status === 'resolved' ? 'resolved' : `severity-${alert.severity}`}`}
                  >
                    <div className="gimi-alert-header">
                      <div className="gimi-alert-client-meta">
                        <Badge tone={alert.channel === 'whatsapp' ? 'success' : 'neutral'}>
                          {alert.channel === 'whatsapp' ? 'WhatsApp' : 'Web'}
                        </Badge>
                        <strong>{alert.clientName}</strong>
                      </div>
                      <Badge tone={alert.severity === 'high' ? 'error' : alert.severity === 'medium' ? 'warning' : 'neutral'}>
                        {alert.status === 'resolved' ? 'Resuelta' : alert.severity === 'high' ? 'Prioridad Alta' : 'Atención'}
                      </Badge>
                    </div>

                    <p className="gimi-alert-message">{alert.message}</p>

                    <div className="gimi-alert-footer">
                      <time className="muted">{alert.timestamp.slice(11, 16)} hrs</time>
                      {alert.status === 'pending' ? (
                        <Button
                          variant="secondary"
                          className="gimi-resolve-btn"
                          onClick={() => handleResolveAlert(alert.id)}
                        >
                          Marcar como atendida
                        </Button>
                      ) : (
                        <span className="muted gimi-resolved-tag">✓ Atendida</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Conversations Table */}
          <Panel>
            <div className="gimi-conversations-head">
              <h2>Registro de Conversaciones Recientes</h2>
              <div className="gimi-filter-controls">
                <Field
                  id="search-conversations"
                  label="Buscar conversación"
                  placeholder="Nombre de cliente o palabra clave..."
                  value={conversationSearch}
                  onChange={e => setConversationSearch(e.target.value)}
                />
                <div className="gimi-channel-toggle" role="group" aria-label="Filtrar por canal">
                  <button
                    type="button"
                    className={`gimi-filter-pill ${channelFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setChannelFilter('all')}
                  >
                    Todos ({conversations.length})
                  </button>
                  <button
                    type="button"
                    className={`gimi-filter-pill ${channelFilter === 'whatsapp' ? 'active' : ''}`}
                    onClick={() => setChannelFilter('whatsapp')}
                  >
                    WhatsApp ({whatsappCount})
                  </button>
                  <button
                    type="button"
                    className={`gimi-filter-pill ${channelFilter === 'web' ? 'active' : ''}`}
                    onClick={() => setChannelFilter('web')}
                  >
                    Web ({webCount})
                  </button>
                </div>
              </div>
            </div>

            {filteredConversations.length > 0 ? (
              <div className="gimi-table-wrap">
                <table className="gimi-table" aria-label="Historial de conversaciones con Gimi">
                  <thead>
                    <tr>
                      <th scope="col">Contacto / Cliente</th>
                      <th scope="col">Canal</th>
                      <th scope="col">Tipo de consulta</th>
                      <th scope="col">Mensajes</th>
                      <th scope="col">Resumen</th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredConversations.map(conv => (
                      <tr key={conv.id}>
                        <td>
                          <strong>{conv.clientName}</strong>
                          {conv.clientPhone && <span className="muted gimi-cell-sub">{conv.clientPhone}</span>}
                        </td>
                        <td>
                          <Badge tone={conv.channel === 'whatsapp' ? 'success' : 'neutral'}>
                            {conv.channel === 'whatsapp' ? 'WhatsApp' : 'Web App'}
                          </Badge>
                        </td>
                        <td>{CONTACT_TYPE_LABELS[conv.contactType]}</td>
                        <td>{conv.messagesCount} msgs</td>
                        <td className="gimi-summary-cell">{conv.summary}</td>
                        <td>
                          <Badge
                            tone={
                              conv.status === 'resolved'
                                ? 'success'
                                : conv.status === 'escalated'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {conv.status === 'resolved' ? 'Resuelta' : conv.status === 'escalated' ? 'Escalada' : 'Activa'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Sin conversaciones">
                No hay conversaciones que coincidan con el filtro seleccionado.
              </EmptyState>
            )}
          </Panel>
        </section>
      )}

      {/* TAB 2: VAULT DE CONOCIMIENTO (RAG) */}
      {activeTab === 'vault' && (
        <section className="gimi-tab-content">
          <Panel>
            <div className="gimi-vault-head-row">
              <div>
                <h2>Vault de Documentos y Conocimiento</h2>
                <p className="muted gimi-vault-desc">
                  Información oficial que Gimi utiliza para responder con RAG. Los recursos con fecha de expiración se excluyen automáticamente al vencer para evitar ofrecer promociones o políticas caducadas.
                </p>
              </div>
              <Button
                className="gimi-add-vault-btn"
                onClick={() => setIsAddModalOpen(true)}
              >
                + Agregar documento al Vault
              </Button>
            </div>

            {/* Filter Pills */}
            <div className="gimi-vault-filters" role="group" aria-label="Filtrar recursos por estado">
              <button
                type="button"
                className={`gimi-filter-pill ${vaultFilter === 'all' ? 'active' : ''}`}
                onClick={() => setVaultFilter('all')}
              >
                Todos ({vaultItems.length})
              </button>
              <button
                type="button"
                className={`gimi-filter-pill ${vaultFilter === 'active' ? 'active' : ''}`}
                onClick={() => setVaultFilter('active')}
              >
                Vigentes ({vaultItems.filter(i => checkKnowledgeExpiry(i, now).status === 'active').length})
              </button>
              <button
                type="button"
                className={`gimi-filter-pill ${vaultFilter === 'expiring' ? 'active' : ''}`}
                onClick={() => setVaultFilter('expiring')}
              >
                Por vencer ≤7d ({vaultItems.filter(i => checkKnowledgeExpiry(i, now).status === 'expiring_soon').length})
              </button>
              <button
                type="button"
                className={`gimi-filter-pill ${vaultFilter === 'expired' ? 'active' : ''}`}
                onClick={() => setVaultFilter('expired')}
              >
                Expirados ({vaultItems.filter(i => checkKnowledgeExpiry(i, now).status === 'expired').length})
              </button>
            </div>

            {/* Vault Bento Cards Grid */}
            <div className="gimi-vault-grid">
              {filteredVault.map(item => {
                const expiry = checkKnowledgeExpiry(item, now);
                return (
                  <article key={item.id} className={`gimi-vault-card status-${expiry.status}`}>
                    <div className="gimi-vault-card-header">
                      <span className="gimi-vault-cat-tag">{CATEGORY_LABELS[item.category]}</span>
                      <div className="gimi-vault-expiry-badge">
                        {expiry.status === 'active' && !item.expiresAt && (
                          <Badge tone="neutral">Permanente</Badge>
                        )}
                        {expiry.status === 'active' && item.expiresAt && (
                          <Badge tone="success">Vigente ({expiry.daysRemaining}d)</Badge>
                        )}
                        {expiry.status === 'expiring_soon' && (
                          <Badge tone="warning">Vence en {expiry.daysRemaining} días</Badge>
                        )}
                        {expiry.status === 'expired' && (
                          <Badge tone="error">Expirado · Excluido de RAG</Badge>
                        )}
                      </div>
                    </div>

                    <h3 className="gimi-vault-card-title">{item.title}</h3>
                    <p className="gimi-vault-card-content">{item.content}</p>

                    <div className="gimi-vault-card-footer">
                      <div className="gimi-vault-author-info">
                        <span className="muted">{item.authorName}</span>
                        {item.expiresAt && (
                          <span className="gimi-expiry-date-label">
                            Vence: {item.expiresAt.slice(0, 10)}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="gimi-delete-btn"
                        onClick={() => handleDeleteVaultItem(item.id)}
                        title="Eliminar recurso del Vault"
                        aria-label={`Eliminar ${item.title}`}
                      >
                        Eliminar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>

          {/* Modal / Dialog for New Knowledge Item */}
          {isAddModalOpen && (
            <div className="gimi-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-add-vault-title">
              <div className="gimi-form-modal">
                <div className="gimi-modal-head">
                  <h3 id="modal-add-vault-title">Nuevo Recurso de Conocimiento</h3>
                  <button
                    type="button"
                    className="gimi-modal-close"
                    onClick={() => setIsAddModalOpen(false)}
                    aria-label="Cerrar modal"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateVaultItem} className="gimi-vault-form">
                  <Field
                    id="vault-title"
                    label="Título del documento / política"
                    placeholder="Ej. Promoción de Buen Fin 2026, Horario Semana Santa..."
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    required
                  />

                  <div className="gimi-form-row">
                    <label htmlFor="vault-category" className="gimi-field-label">
                      <span>Categoría</span>
                      <select
                        id="vault-category"
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value as KnowledgeCategory)}
                        className="gimi-select"
                      >
                        <option value="tariffs_promos">Tarifas y Promociones</option>
                        <option value="schedules_classes">Horarios y Clases</option>
                        <option value="regulations">Normativa y Políticas</option>
                        <option value="supplements_store">Suplementos y Tienda</option>
                      </select>
                    </label>

                    <label htmlFor="vault-expiry" className="gimi-field-label">
                      <span>Fecha de expiración (opcional para ofertas temporales)</span>
                      <input
                        id="vault-expiry"
                        type="date"
                        value={newExpiresAt}
                        onChange={e => setNewExpiresAt(e.target.value)}
                        className="gimi-date-input"
                      />
                    </label>
                  </div>

                  <label htmlFor="vault-content" className="gimi-field-label">
                    <span>Contenido del recurso (contexto para Gimi)</span>
                    <textarea
                      id="vault-content"
                      className="gimi-textarea"
                      rows={5}
                      placeholder="Escribe las condiciones, horarios o reglas exactas para que el asistente las explique a los clientes..."
                      value={newContent}
                      onChange={e => setNewContent(e.target.value)}
                      required
                    />
                  </label>

                  <Field
                    id="vault-tags"
                    label="Etiquetas clave (separadas por coma)"
                    placeholder="ej. promo, boxeo, estudiantes, descuento"
                    value={newTags}
                    onChange={e => setNewTags(e.target.value)}
                  />

                  <div className="gimi-modal-actions">
                    <Button type="submit" disabled={!newTitle.trim() || !newContent.trim()}>
                      Guardar en Vault
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
