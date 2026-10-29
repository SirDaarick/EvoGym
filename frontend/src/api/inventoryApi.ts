export type AuthenticatedRequest = (path: string, init?: RequestInit) => Promise<Response>;

export class InventoryApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'InventoryApiError';
  }
}

export interface BranchItem {
  id: string;
  code: string;
  name: string;
}

export interface ProductItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price_minor: number;
  cost_minor: number;
  is_active: boolean;
  unit: string;
  created_by: string;
  created_at: string;
}

export interface StockItem {
  product_id: string;
  code: string;
  name: string;
  category: string;
  price_minor: number;
  cost_minor: number;
  is_active: boolean;
  unit: string;
  initialized: boolean;
  opening_quantity: number | null;
  restocked_quantity: number;
  waste_quantity: number;
  quantity: number | null;
  initialized_at: string | null;
}

export interface StockPage {
  items: StockItem[];
  total: number;
}

export interface StockMovementItem {
  id: string;
  branch_id: string;
  product_id: string;
  kind: 'restock' | 'waste';
  quantity: number;
  reason: string | null;
  recorded_by: string;
  idempotency_key: string;
  recorded_at: string;
  on_hand_quantity: number;
}

export interface StockMovementPage {
  items: StockMovementItem[];
  total: number;
}

export interface CreateProductPayload {
  name: string;
  category?: string;
  price_minor: number;
  cost_minor?: number;
  initial_quantity?: number;
  initial_branch_id?: string;
  code?: string;
  unit?: string;
}

export interface UpdateProductPayload {
  name?: string;
  category?: string;
  price_minor?: number;
  cost_minor?: number;
  is_active?: boolean;
}

export interface CreateMovementPayload {
  product_id: string;
  kind: 'restock' | 'waste';
  quantity: number;
  reason?: string;
  idempotency_key: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Error de API (${res.status})`;
    try {
      const data = await res.json();
      if (data && typeof data === 'object') {
        if (typeof data.detail === 'string') message = data.detail;
        else if (Array.isArray(data.detail) && data.detail[0]?.msg) message = data.detail[0].msg;
        else if (typeof data.message === 'string') message = data.message;
      }
      throw new InventoryApiError(res.status, message, data);
    } catch (err) {
      if (err instanceof InventoryApiError) throw err;
      throw new InventoryApiError(res.status, message);
    }
  }
  return res.json() as Promise<T>;
}

export async function listBranches(request: AuthenticatedRequest): Promise<BranchItem[]> {
  const res = await request('/api/v1/inventory/branches');
  return handleResponse<BranchItem[]>(res);
}

export async function listBranchInventory(
  request: AuthenticatedRequest,
  branchId: string,
  offset = 0,
  limit = 100
): Promise<StockPage> {
  const res = await request(`/api/v1/inventory/branches/${branchId}/stock?offset=${offset}&limit=${limit}`);
  return handleResponse<StockPage>(res);
}

export async function createCatalogProduct(
  request: AuthenticatedRequest,
  payload: CreateProductPayload
): Promise<ProductItem> {
  const res = await request('/api/v1/inventory/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<ProductItem>(res);
}

export async function updateCatalogProduct(
  request: AuthenticatedRequest,
  productId: string,
  payload: UpdateProductPayload
): Promise<ProductItem> {
  const res = await request(`/api/v1/inventory/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<ProductItem>(res);
}

export async function recordStockMovement(
  request: AuthenticatedRequest,
  branchId: string,
  payload: CreateMovementPayload
): Promise<StockMovementItem> {
  const res = await request(`/api/v1/inventory/branches/${branchId}/movements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': payload.idempotency_key,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<StockMovementItem>(res);
}

export async function listStockMovements(
  request: AuthenticatedRequest,
  branchId: string,
  offset = 0,
  limit = 100
): Promise<StockMovementPage> {
  const res = await request(`/api/v1/inventory/branches/${branchId}/movements?offset=${offset}&limit=${limit}`);
  return handleResponse<StockMovementPage>(res);
}
