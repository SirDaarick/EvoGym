import type { StockItem } from '@/api/inventoryApi';
import { formatMoney } from '@/shared/formatters/money';
import type { Intent } from './useProductSaleIntent';

interface Props {
  intent: Intent | null;
  recoveredMemberName: string;
  selected: StockItem[];
  quantities: Record<string, number>;
  stock: StockItem[];
  locked: boolean;
  onRemove(productId: string): void;
}

export function PurchaseSummary({ intent, recoveredMemberName, selected, quantities, stock, locked, onRemove }: Props) {
  return <div className="cart-items-section">{intent ? <><p>Compra pendiente de confirmar. Socio: {intent.payload.member_id ? recoveredMemberName || intent.payload.member_id : 'Sin asignar'}</p><ul className="cart-lines">{intent.payload.items.map(item => <li className="cart-line-row" key={item.product_id}>{item.quantity} × {stock.find(product => product.product_id === item.product_id)?.name ?? item.product_id}</li>)}</ul></> : selected.length ? <ul className="cart-lines">{selected.map(item => <li className="cart-line-row" key={item.product_id}>
    <span>{quantities[item.product_id]} × {item.name}</span><strong>{formatMoney(item.price_minor * quantities[item.product_id])} MXN</strong>
    <button type="button" disabled={locked} onClick={() => onRemove(item.product_id)}>Quitar</button>
  </li>)}</ul> : <p className="cart-empty-msg">Sin productos seleccionados.</p>}</div>;
}
