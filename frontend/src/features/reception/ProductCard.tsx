import type { Product } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import './ProductCard.css';

export type ProductCardItem = {
  id: string;
  name: string;
  priceMinor: number;
  subtitle?: string;
  flavor?: string;
};

export type ProductCardProps = {
  product: Product | ProductCardItem;
  stock: number;
  quantity?: number;
  selected?: boolean;
  disabled?: boolean;
  subtitle?: string;
  stockLabel?: string;
  stockLowThreshold?: number;
  priceSuffix?: string;
  onSelect?: () => void;
  onQuantityChange?: (quantity: number) => void;
};

/** Neutral product presentation; callers own selection, quantity, and transaction semantics. */
export function ProductCard({
  product,
  stock,
  quantity,
  selected = false,
  disabled = false,
  subtitle,
  stockLabel,
  stockLowThreshold,
  priceSuffix,
  onSelect,
  onQuantityChange,
}: ProductCardProps) {
  const sub = subtitle ?? ('subtitle' in product ? product.subtitle : ('flavor' in product ? product.flavor : undefined));
  const fullLabel = sub ? `${product.name} (${sub})` : product.name;
  const displayStock = stockLabel ?? `Stock: ${stock}`;
  const isLow = stock <= (stockLowThreshold ?? 3);

  return (
    <article
      className={`product-card product-clay-card ${selected || quantity ? 'product-selected' : ''}`}
      onContextMenu={event => {
        event.preventDefault();
        if (!disabled && quantity && onQuantityChange) onQuantityChange(quantity - 1);
      }}
    >
      <div className="product-card-top">
        <span className={`product-stock-badge ${isLow ? 'stock-low' : ''}`} aria-label={displayStock}>
          {displayStock}
        </span>
      </div>
      <button
        type="button"
        className="product-tile-btn"
        aria-label={`Seleccionar ${fullLabel}`}
        aria-pressed={selected || Boolean(quantity)}
        disabled={disabled}
        onClick={() => {
          onSelect?.();
          if (!disabled && onQuantityChange && quantity !== undefined) {
            onQuantityChange(quantity + 1);
          }
        }}
      >
        <span className="product-name-label">{product.name}</span>
        {sub && <span className="product-subtitle muted">{sub}</span>}
        <span className="product-price">{formatMoney(product.priceMinor)}{priceSuffix ?? ' MXN'}</span>
      </button>
      {quantity !== undefined && (
        <div className="product-card-footer">
          {Boolean(quantity) && (
            <div className="quantity-controls">
              <button
                type="button"
                className="qty-btn"
                aria-label={`Disminuir ${fullLabel}`}
                disabled={disabled}
                onClick={() => onQuantityChange?.(quantity - 1)}
              >
                −
              </button>
              <output aria-label={`Cantidad de ${fullLabel}`}>{quantity}</output>
              <button
                type="button"
                className="qty-btn"
                aria-label={`Aumentar ${fullLabel}`}
                disabled={disabled}
                onClick={() => onQuantityChange?.(quantity + 1)}
              >
                +
              </button>
              <button
                type="button"
                className="qty-btn qty-btn-remove"
                aria-label={`Quitar ${fullLabel}`}
                title="Quitar"
                disabled={disabled}
                onClick={() => onQuantityChange?.(0)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
