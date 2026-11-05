import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { AuthenticatedRequest } from '../../api/membershipCheckoutApi';
import { chatWithGimi, type GimiChatResponsePayload } from '../../api/ownerGimiApi';
import { Badge, Button } from '../../shared/ui';

export interface ChatMessageItem {
  id: string;
  sender: 'user' | 'gimi';
  text: string;
  timestamp: string;
  tool?: string;
  confidence?: number;
  needsConfirmation?: boolean;
  draftAction?: Record<string, unknown> | null;
  data?: Record<string, unknown>;
  resolvedConfirmation?: 'confirmed' | 'cancelled' | null;
}

const DEFAULT_WELCOME_MESSAGE: ChatMessageItem = {
  id: 'welcome-0',
  sender: 'gimi',
  text: '¡Hola! Soy **Gimi**, tu copiloto operativo y financiero en EvoGym.\n\nEstoy conectado a Jev para clasificación instantánea y al modelo Gemini 2.0 Flash. Puedo consultar ingresos, aforo, alertas de clientes, inventario o redactar acciones sensibles para que las apruebes antes de ejecutarse.\n\n¿En qué puedo apoyarte hoy?',
  timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
};

const QUICK_PROMPTS = [
  '¿Cómo van los ingresos y el corte de este mes?',
  '¿Cuál es el aforo en sala y las horas pico?',
  '¿Cuáles son las alertas operativas activas?',
  '¿Cuál es el reglamento de uso de toalla?',
];

function renderFormattedText(content: string) {
  return content.split('\n').map((line, idx) => {
    if (!line.trim()) return <div key={idx} className="h-2" />;

    const boldParts = line.split(/(\*\*.*?\*\*)/g);
    const processed = boldParts.length > 1
      ? boldParts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={pIdx} className="font-semibold">{part.slice(2, -2)}</strong>;
          }
          return part;
        })
      : line;

    return (
      <p key={idx} className="my-0.5 leading-relaxed">
        {processed}
      </p>
    );
  });
}

export function LiveGimiChatPane({ apiRequest }: { apiRequest: AuthenticatedRequest }) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([DEFAULT_WELCOME_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  const handleSend = async (customText?: string) => {
    const text = (customText ?? inputValue).trim();
    if (!text || sending) return;

    setErrorNotice(null);
    const userMsg: ChatMessageItem = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
    };

    setMessages(prev => [...prev, userMsg]);
    if (!customText) {
      setInputValue('');
    }
    setSending(true);

    try {
      const response: GimiChatResponsePayload = await chatWithGimi(apiRequest, {
        message: text,
      });

      const gimiMsg: ChatMessageItem = {
        id: `gimi-${Date.now()}`,
        sender: 'gimi',
        text: response.reply_text,
        timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
        tool: response.tool_called,
        confidence: response.confidence,
        needsConfirmation: response.needs_confirmation,
        draftAction: response.draft_action,
        data: response.data,
      };

      setMessages(prev => [...prev, gimiMsg]);
    } catch {
      setErrorNotice('No se pudo comunicar con Gimi. Verifica la conexión o el servidor.');
      const errorMsg: ChatMessageItem = {
        id: `err-${Date.now()}`,
        sender: 'gimi',
        text: 'Lo siento, ocurrió un error temporal al procesar tu solicitud con el orquestador. Por favor intenta nuevamente.',
        timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleConfirmDraft = async (msg: ChatMessageItem) => {
    if (!msg.draftAction || !msg.tool || sending) return;

    setErrorNotice(null);
    setSending(true);

    // Mark current message draft as resolved
    setMessages(prev =>
      prev.map(m => (m.id === msg.id ? { ...m, resolvedConfirmation: 'confirmed' } : m))
    );

    const userConfirmationMsg: ChatMessageItem = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: '✓ Confirmar y ejecutar acción',
      timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
    };
    setMessages(prev => [...prev, userConfirmationMsg]);

    try {
      const response = await chatWithGimi(apiRequest, {
        message: 'Sí, confirmo la acción.',
        confirmed: true,
        cached_draft: msg.draftAction,
        cached_tool: msg.tool,
      });

      const gimiExecutedMsg: ChatMessageItem = {
        id: `gimi-${Date.now()}`,
        sender: 'gimi',
        text: response.reply_text,
        timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
        tool: response.tool_called,
        confidence: response.confidence,
        needsConfirmation: false,
        data: response.data,
      };
      setMessages(prev => [...prev, gimiExecutedMsg]);
    } catch {
      setErrorNotice('Ocurrió un error al ejecutar la acción confirmada.');
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleCancelDraft = (msgId: string) => {
    setMessages(prev =>
      prev.map(m => (m.id === msgId ? { ...m, resolvedConfirmation: 'cancelled' } : m))
    );

    const cancelNoticeMsg: ChatMessageItem = {
      id: `cancel-${Date.now()}`,
      sender: 'gimi',
      text: 'Acción cancelada. No se aplicó ningún cambio en el inventario o la caja.',
      timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
    };
    setMessages(prev => [...prev, cancelNoticeMsg]);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleResetChat = () => {
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setErrorNotice(null);
    setInputValue('');
  };

  return (
    <div className="gimi-chat-pane">
      {/* Header bar */}
      <div className="gimi-chat-header">
        <div className="flex items-center gap-3">
          <div className="gimi-avatar-pill">🤖</div>
          <div>
            <h3 className="text-base font-bold text-ink">Gimi Operativo & Financiero</h3>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="inline-block w-2 h-2 rounded-full bg-success animate-pulse" />
              <span>Asistente en vivo</span>
            </div>
          </div>
        </div>
        <Button variant="secondary" onClick={handleResetChat} className="text-xs px-3 py-1">
          Reiniciar Chat
        </Button>
      </div>

      {/* Quick Prompts */}
      <div className="gimi-quick-prompts-bar">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider mr-1">Sugerencias:</span>
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            type="button"
            className="gimi-quick-chip"
            disabled={sending}
            onClick={() => handleSend(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div className="gimi-chat-messages-area" role="log" aria-label="Historial de mensajes con Gimi">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`gimi-chat-row ${msg.sender === 'user' ? 'user-row' : 'gimi-row'}`}
          >
            <div className={`gimi-chat-bubble ${msg.sender === 'user' ? 'user-bubble' : 'gimi-bubble'}`}>
              <div className="gimi-bubble-content">
                {renderFormattedText(msg.text)}
              </div>

              {/* Message Timestamp */}
              {msg.sender === 'gimi' && (
                <div className="gimi-bubble-meta">
                  <span className="text-xs text-muted ml-auto">{msg.timestamp}</span>
                </div>
              )}

              {msg.sender === 'user' && (
                <div className="text-right text-xs opacity-75 mt-1">{msg.timestamp}</div>
              )}

              {/* Draft & Confirm Card */}
              {msg.sender === 'gimi' && msg.needsConfirmation && msg.draftAction && (
                <div className="gimi-draft-card">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-warning">
                      ⚠️ Autorización Requerida
                    </span>
                    <Badge tone="warning">Mutación de Estado</Badge>
                  </div>
                  <p className="text-xs text-muted mb-2">
                    Gimi redactó la siguiente operación. Revisa los datos antes de aplicar los cambios:
                  </p>
                  <div className="gimi-draft-payload">
                    {Object.entries(msg.draftAction).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs py-0.5 border-b border-divider/50 last:border-0">
                        <span className="text-muted font-mono">{k}:</span>
                        <span className="font-semibold text-ink">{String(v)}</span>
                      </div>
                    ))}
                  </div>

                  {!msg.resolvedConfirmation ? (
                    <div className="flex gap-2 mt-3 justify-end">
                      <Button
                        variant="secondary"
                        disabled={sending}
                        onClick={() => handleCancelDraft(msg.id)}
                        className="text-xs px-3 py-1.5"
                      >
                        ✕ Cancelar
                      </Button>
                      <Button
                        variant="primary"
                        disabled={sending}
                        onClick={() => handleConfirmDraft(msg)}
                        className="text-xs px-3 py-1.5 font-bold"
                      >
                        ✓ Confirmar y Ejecutar
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 text-right">
                      <Badge tone={msg.resolvedConfirmation === 'confirmed' ? 'success' : 'neutral'}>
                        {msg.resolvedConfirmation === 'confirmed' ? '✓ Operación Ejecutada' : '✕ Operación Cancelada'}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="gimi-chat-row gimi-row">
            <div className="gimi-chat-bubble gimi-bubble gimi-typing-bubble" role="status">
              <span className="text-xs text-muted font-medium">Gimi está consultando y analizando...</span>
              <span className="gimi-typing-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        )}

        {errorNotice && (
          <div className="p-3 text-xs rounded bg-danger/10 text-danger border border-danger/20 text-center">
            {errorNotice}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={e => {
          e.preventDefault();
          handleSend();
        }}
        className="gimi-chat-input-bar"
      >
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Escribe tu consulta o instrucción para Gimi (ej. '¿Cuál es el aforo hoy?')..."
          disabled={sending}
          className="gimi-chat-input"
          aria-label="Mensaje para Gimi"
        />
        <Button
          variant="primary"
          type="submit"
          disabled={sending || !inputValue.trim()}
          className="gimi-chat-send-btn"
        >
          {sending ? 'Procesando...' : 'Enviar'}
        </Button>
      </form>
    </div>
  );
}
