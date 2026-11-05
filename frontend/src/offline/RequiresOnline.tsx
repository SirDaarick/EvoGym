/**
 * UI wrapper for online-only features: disables actions or renders "Requiere internet" badge (T5.11).
 */

import React, { type ReactNode } from 'react';
import { isAllowedOffline, type Command } from './capabilities';
import { useSync } from './SyncProvider';

export interface RequiresOnlineProps {
  cmd: Command;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequiresOnline({ cmd, children, fallback }: RequiresOnlineProps) {
  const { isOnline } = useSync();
  const allowed = isOnline || isAllowedOffline(cmd);

  if (allowed) {
    return <>{children}</>;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 opacity-60 pointer-events-none cursor-not-allowed select-none"
      title="Requiere internet para operar"
      aria-disabled="true"
    >
      {children}
      <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
        Requiere internet
      </span>
    </div>
  );
}
