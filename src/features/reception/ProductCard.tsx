import type { Product } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import './ProductCard.css';

type ProductCardProps = {
  product: Product;
  stock: number;
  quantity?: number;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  onQuantityChange?: (quantity: number) => void;
};

/** Neutral product presentation; callers own selection, quantity, and transaction semantics. */
export function ProductCard({ product, stock, quantity, selected = false, disabled = false, onSelect, onQuantityChange }: ProductCardProps) {
  return <article className={`product-card product-clay-card ${selected || quantity ? 'product-selected' : ''}`} onContextMenu={event => {
    event.preventDefault();
    if (!disabled && quantity && onQuantityChange) onQuantityChange(quantity - 1);
  }}>
    <div className="product-card-top"><span className={`product-stock-badge ${stock <= 3 ? 'stock-low' : ''}`} aria-label={`Stock: ${stock}`}>Stock: {stock}</span></div>
    <button type="button" className="product-tile-btn" aria-label={`Seleccionar ${product.name}`} aria-pressed={selected || Boolean(quantity)} disabled={disabled} onClick={() => {
      if (onQuantityChange && quantity !== undefined) onQuantityChange(quantity + 1);
      else onSelect?.();
    }}>
      <span className="product-name-label">{product.name}</span>
      <span className="product-price">{formatMoney(product.priceMinor)} MXN</span>
    </button>
    {quantity !== undefined && <div className="product-card-footer">{Boolean(quantity) && <div className="quantity-controls">
      <button type="button" className="qty-btn" aria-label={`Disminuir ${product.name}`} disabled={disabled} onClick={() => onQuantityChange?.(quantity - 1)}>−</button>
      <output aria-label={`Cantidad de ${product.name}`}>{quantity}</output>
      <button type="button" className="qty-btn" aria-label={`Aumentar ${product.name}`} disabled={disabled} onClick={() => onQuantityChange?.(quantity + 1)}>+</button>
      <button type="button" className="qty-btn qty-btn-remove" aria-label={`Quitar ${product.name}`} title="Quitar" disabled={disabled} onClick={() => onQuantityChange?.(0)}>×</button>
    </div>}</div>}
  </article>;
}
