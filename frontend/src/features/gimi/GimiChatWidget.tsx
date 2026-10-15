import React, { useState, useEffect, useRef } from 'react';
import type { Role } from '../../domain/models';
import type { GimiChatMessage } from '../../domain/gimi';
import { useDemo } from '../../demo/DemoProvider';
import {
  answerGimiQuery,
  getStoredChatHistory,
  saveStoredChatHistory,
} from './gimiStore';
import { Badge, Button } from '../../shared/ui';
import './GimiChatWidget.css';

interface GimiChatWidgetProps {
  role: Role;
}

const INITIAL_SUGGESTIONS_BY_ROLE: Record<Role, string[]> = {
  OWNER: [
    '¿Cómo van las métricas de socios y retención?',
    '¿Cuáles son las promociones vigentes?',
    '¿Qué suplementos son los más vendidos?',
    'Disponibilidad de guantes y casilleros',
  ],
  RECEPTION: [
    '¿Cuáles son los precios de membresías?',
    '¿Hay promociones activas hoy?',
    'Disponibilidad de guantes y casilleros',
    '¿Cómo registro un gasto en caja?',
  ],
};

export function GimiChatWidget({ role }: GimiChatWidgetProps) {
  const { state } = useDemo();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState('');

  const [messages, setMessages] = useState<GimiChatMessage[]>(() => {
    const cached = getStoredChatHistory();
    if (cached.length > 0) return cached;
    return [
      {
        id: 'welcome-1',
        role: 'assistant',
        content:
          `¡Hola! Soy **Gimi**, el asistente inteligente de EvoGym. 🤖✨\n\n` +
          (role === 'OWNER'
            ? 'Estoy conectado a los datos de EvoGym para darte métricas en tiempo real, ayudarte con el inventario y consultar las políticas de tu Knowledge Vault.'
            : 'Estoy aquí para resolver tus dudas de mostrador: tarifas vigentes, disponibilidad de casilleros, horarios de clases y normativas de caja.'),
        timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
        suggestions: INITIAL_SUGGESTIONS_BY_ROLE[role],
      },
    ];
  });

  const chatBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const responseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearBottomRef = useRef(true);
  const scrollPositionRef = useRef(0);
  const returnFocusRef = useRef(false);

  const cancelPending = () => {
    if (responseTimerRef.current !== null) clearTimeout(responseTimerRef.current);
    if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
    responseTimerRef.current = null;
    focusTimerRef.current = null;
  };

  // A new role must never receive a response scheduled for the previous role.
  useEffect(() => {
    setIsTyping(false);
    return cancelPending;
  }, [role]);

  const closeChat = () => {
    returnFocusRef.current = true;
    setIsOpen(false);
  };

  // Sync to session storage
  useEffect(() => {
    saveStoredChatHistory(messages);
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatBodyRef.current && nearBottomRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isTyping, isOpen]);

  useEffect(() => {
    if (isOpen && chatBodyRef.current && !nearBottomRef.current) {
      chatBodyRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 150);
    } else if (returnFocusRef.current) {
      launcherRef.current?.focus();
      returnFocusRef.current = false;
    }
    return () => {
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    };
  }, [isOpen, role]);

  // Recognition belongs to the open panel; detach callbacks before stopping it.
  useEffect(() => {
    if (!isOpen) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    setSpeechSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'es-MX';
    recognition.onstart = () => { setSpeechError(''); setIsListening(true); };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      if (transcript) setInputValue(prev => prev ? `${prev} ${transcript}` : transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setSpeechError('No se pudo usar el micrófono. Revisa los permisos o escribe tu mensaje.');
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => {
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      recognition.abort ? recognition.abort() : recognition.stop();
      recognitionRef.current = null;
      setIsListening(false);
    };
  }, [isOpen, role]);

  const handleToggleVoice = () => {
    if (!speechSupported || !recognitionRef.current) {
      setSpeechError('Tu navegador no tiene activado el soporte para entrada de voz.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (err) {
        setSpeechError('No se pudo iniciar el micrófono. Revisa los permisos o escribe tu mensaje.');
      }
    }
  };

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isTyping) return;

    const userMsg: GimiChatMessage = {
      id: `user-${crypto.randomUUID()}`,
      role: 'user',
      content: text,
      timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    // Simulate intelligent thinking delay
    responseTimerRef.current = setTimeout(() => {
      responseTimerRef.current = null;
      const response = answerGimiQuery(text, role, state);
      const assistantMsg: GimiChatMessage = {
        id: `gimi-${crypto.randomUUID()}`,
        role: 'assistant',
        content: response.content,
        timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
        suggestions: response.suggestions,
      };
      setMessages(prev => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 450);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    cancelPending();
    setIsTyping(false);
    setInputValue('');
    nearBottomRef.current = true;
    inputRef.current?.focus();
    const resetMsg: GimiChatMessage = {
      id: 'welcome-reset',
      role: 'assistant',
      content: '¡Conversación reiniciada! ¿En qué más puedo orientarte?',
      timestamp: new Intl.DateTimeFormat('es-MX', { timeStyle: 'short' }).format(new Date()),
      suggestions: INITIAL_SUGGESTIONS_BY_ROLE[role],
    };
    setMessages([resetMsg]);
  };

  // Render markdown-like text with bold, bullets and linebreaks
  const renderFormattedText = (content: string) => {
    return content.split('\n').map((line, idx) => {
      if (!line.trim()) return <div key={idx} className="gimi-msg-spacer" />;

      let processed: React.ReactNode = line;
      // Bold **text**
      const boldParts = line.split(/(\*\*.*?\*\*)/g);
      if (boldParts.length > 1) {
        processed = boldParts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
          }
          return part;
        });
      }

      return (
        <p key={idx} className="gimi-msg-line">
          {processed}
        </p>
      );
    });
  };

  return (
    <div className="gimi-widget-root">
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          type="button"
          ref={launcherRef}
          className="gimi-launcher-btn"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir asistente Gimi"
          title="Abrir asistente Gimi"
        >
          <div className="gimi-launcher-icon-wrap" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-7z" />
              <circle cx="9" cy="14" r="1" />
              <circle cx="15" cy="14" r="1" />
              <path d="M9 18h6" />
            </svg>
          </div>
          <span className="gimi-launcher-label">Gimi AI</span>
          <span className="gimi-launcher-pulse" aria-hidden="true" />
        </button>
      )}

      {/* Floating Chat Modal */}
      {isOpen && (
        <div className="gimi-modal-container" role="dialog" aria-label="Asistente virtual Gimi"
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeChat(); } }}>
          {/* Header */}
          <div className="gimi-modal-header">
            <div className="gimi-header-meta">
              <div className="gimi-avatar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM4 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-7z" />
                  <circle cx="9" cy="14" r="1" />
                  <circle cx="15" cy="14" r="1" />
                  <path d="M9 18h6" />
                </svg>
              </div>
              <div>
                <h3 className="gimi-title">Gimi · Asistente IA</h3>
                <Badge tone="neutral">
                  {role === 'OWNER' ? 'Modo Propietario' : 'Modo Recepción'}
                </Badge>
              </div>
            </div>

            <div className="gimi-header-actions">
              <button
                type="button"
                className="gimi-btn-icon"
                onClick={handleClearChat}
                title="Reiniciar conversación"
                aria-label="Reiniciar conversación"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
              <button
                type="button"
                className="gimi-btn-icon gimi-close-btn"
                onClick={closeChat}
                title="Cerrar asistente"
                aria-label="Cerrar asistente"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat Stream */}
          <div className="gimi-messages-body" ref={chatBodyRef}
            role="log" aria-label="Conversación con Gimi" aria-live="polite" aria-relevant="additions text"
            onScroll={event => {
              const body = event.currentTarget;
              scrollPositionRef.current = body.scrollTop;
              nearBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 64;
            }}>
            {messages.map(msg => (
              <div key={msg.id} className={`gimi-message-wrap ${msg.role === 'user' ? 'user-side' : 'bot-side'}`}>
                <div className={`gimi-message-bubble ${msg.role === 'user' ? 'user-bubble' : 'bot-bubble'}`}>
                  {renderFormattedText(msg.content)}
                  <span className="gimi-message-time">{msg.timestamp}</span>
                </div>

                {/* Suggestion Chips */}
                {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="gimi-suggestions-row">
                    {msg.suggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        className="gimi-chip"
                        onClick={() => handleSendMessage(sug)}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isTyping && (
              <div className="gimi-message-wrap bot-side">
                <div className="gimi-message-bubble bot-bubble gimi-typing-indicator" role="status" aria-label="Gimi está escribiendo">
                  <span className="sr-only">Gimi está escribiendo</span>
                  <span className="gimi-dot" aria-hidden="true" />
                  <span className="gimi-dot" aria-hidden="true" />
                  <span className="gimi-dot" aria-hidden="true" />
                </div>
              </div>
            )}
          </div>

          {speechError && <p className="gimi-speech-error" role="alert">{speechError}</p>}
          {/* Input & Action Bar */}
          <div className="gimi-input-container">
            {speechSupported && (
              <button
                type="button"
                className={`gimi-mic-btn ${isListening ? 'listening' : ''}`}
                onClick={handleToggleVoice}
                title={isListening ? 'Detener micrófono' : 'Hablar por micrófono'}
                aria-label={isListening ? 'Detener micrófono' : 'Hablar por micrófono'}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </button>
            )}

            <input
              ref={inputRef}
              type="text"
              className="gimi-input"
              aria-label="Mensaje para Gimi"
              placeholder={isListening ? 'Escuchando tu voz...' : 'Pregúntale a Gimi (ej. tarifas, promos, métricas)...'}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isTyping}
            />

            <Button
              className="gimi-send-btn"
              disabled={!inputValue.trim() || isTyping}
              onClick={() => handleSendMessage()}
              aria-label="Enviar mensaje a Gimi"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
