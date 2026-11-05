/**
 * Hook to inspect whether a command can be executed under current connectivity (T5.11).
 */

import { isAllowedOffline, type Command } from './capabilities';
import { useSync } from './SyncProvider';

export interface CapabilityCheck {
  allowed: boolean;
  reason?: string;
}

export function useCapability(cmd: Command): CapabilityCheck {
  const { isOnline } = useSync();
  const allowed = isOnline || isAllowedOffline(cmd);

  return {
    allowed,
    reason: allowed ? undefined : 'Requiere internet',
  };
}
