import type { Role } from '../../domain/models';
import { InventoryAnalytics } from '../owner/InventoryAnalytics';
import type { AuthenticatedRequest } from '../../api/inventoryApi';
import { DemoReceptionInventory } from './DemoReceptionInventory';
import { LiveReceptionInventory } from './LiveReceptionInventory';
import './Inventory.css';

export function Inventory({ role, apiRequest }: { role: Role; apiRequest?: AuthenticatedRequest }) {
  if (role === 'OWNER') {
    return <InventoryAnalytics apiRequest={apiRequest} />;
  }

  if (apiRequest) {
    return <LiveReceptionInventory apiRequest={apiRequest} />;
  }

  return <DemoReceptionInventory />;
}
