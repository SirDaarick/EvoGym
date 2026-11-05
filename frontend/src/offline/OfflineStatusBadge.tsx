/**
 * Visual header status badge displaying offline mode, pending sync queue, and sync progress (T5.10).
 */

import React from 'react';
import { useSync } from './SyncProvider';

export function OfflineStatusBadge() {
  const { status, pendingCount, lastSyncAt, error, flushNow } = useSync();

  if (status === 'offline') {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30"
        title="Operando sin conexión. Los eventos se guardan localmente y se sincronizarán al recuperar red."
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span>Modo Contingencia</span>
        {pendingCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-amber-500/30 text-[10px]">
            {pendingCount}
          </span>
        )}
      </div>
    );
  }

  if (status === 'syncing') {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30"
        title="Sincronizando eventos locales con el servidor..."
      >
        <svg
          className="w-3 h-3 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeLinecap="round" />
        </svg>
        <span>Sincronizando{pendingCount > 0 ? ` (${pendingCount})` : ''}</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={() => flushNow()}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 transition-colors cursor-pointer"
        title={error || 'Error al sincronizar. Haz clic para reintentar.'}
      >
        <span className="w-2 h-2 rounded-full bg-rose-400" />
        <span>Reintentar sync ({pendingCount})</span>
      </button>
    );
  }

  // Synced
  const timeFormatted = lastSyncAt ? lastSyncAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
      title={timeFormatted ? `Sincronizado a las ${timeFormatted}` : 'Conectado'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      <span>Sincronizado</span>
    </div>
  );
}
