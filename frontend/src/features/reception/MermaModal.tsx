import { formatMoney } from '@/shared/formatters/money';
import { useEffect, useId, useRef, useState } from 'react';
import {
  InventoryApiError,
  recordWasteBatch,
  type AuthenticatedRequest,
  type StockMovementItem,
} from '../../api/inventoryApi';
import { expectedStock } from '../../demo/inventoryOperations';
import type { DemoState, Product } from '../../domain/models';
import { Dialog } from '../../shared/components/ui';
import { Button, FormField, Notice } from '../../shared/ui';

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export interface WasteItem {
  product: Product;
  quantity: number;
}

export interface LiveWasteItem {
  productId: string;
  name: string;
  priceMinor: number;
  costMinor: number;
  availableStock: number;
  quantity: number;
}

export interface MermaModalProps {
  isOpen: boolean;
  onClose: () => void;
  products?: Product[];
  items?: WasteItem[];
  selectedProductId?: string;
  state?: DemoState;
  onConfirmWaste?: (
    itemsOrProductId: WasteItem[] | string,
    quantityOrReason?: number | string,
    maybeReason?: string
  ) => { status: 'ok' } | { status: 'error'; message: string };
  apiRequest?: AuthenticatedRequest;
  branchId?: string;
  liveItems?: LiveWasteItem[];
  onSuccess?: (result: { totalUnits: number; items: StockMovementItem[]; message: string }) => void;
}

interface DraftWasteItem {
  productId: string;
  name: string;
  priceMinor: number;
  costMinor: number;
  availableStock: number;
  quantity: number;
  demoProduct?: Product;
}

function buildInitialDrafts(props: MermaModalProps): DraftWasteItem[] {
  const { apiRequest, branchId, liveItems, items = [], products = [], selectedProductId, state } = props;
  if (apiRequest && branchId) {
    return (liveItems ?? [])
      .filter(item => item.quantity > 0)
      .map(item => ({ ...item }));
  }

  const demoStock = (id: string) => (state ? expectedStock(state, id) : 0);
  if (items.length > 0) {
    return items.map(item => ({
      productId: item.product.id,
      name: item.product.name,
      priceMinor: item.product.priceMinor,
      costMinor: item.product.costMinor ?? 0,
      availableStock: demoStock(item.product.id),
      quantity: item.quantity,
      demoProduct: item.product,
    }));
  }

  const fallbackProduct = selectedProductId
    ? products.find(p => p.id === selectedProductId) ?? state?.products.find(p => p.id === selectedProductId)
    : products[0];

  if (!fallbackProduct) return [];
  return [
    {
      productId: fallbackProduct.id,
      name: fallbackProduct.name,
      priceMinor: fallbackProduct.priceMinor,
      costMinor: fallbackProduct.costMinor ?? 0,
      availableStock: demoStock(fallbackProduct.id),
      quantity: 1,
      demoProduct: fallbackProduct,
    },
  ];
}

export function MermaModal(props: MermaModalProps) {
  const { isOpen, onClose, onConfirmWaste, apiRequest, branchId, onSuccess } = props;
  const isLive = Boolean(apiRequest && branchId);

  const [step, setStep] = useState<1 | 2>(1);
  const [draftItems, setDraftItems] = useState<DraftWasteItem[]>([]);
  const [reason, setReason] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [reasonError, setReasonError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const inFlight = useRef(false);
  const pendingKey = useRef<string | null>(null);
  const pendingFingerprint = useRef<string | null>(null);
  const wasOpen = useRef(false);
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const itemsHeadingId = useId();
  const reasonFieldId = useId();

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setStep(1);
      setDraftItems(buildInitialDrafts(props));
      setReason('');
      setErrorMessage('');
      setReasonError('');
      pendingKey.current = null;
      pendingFingerprint.current = null;
    }
    wasOpen.current = isOpen;
  }, [
    isOpen,
    props.apiRequest,
    props.branchId,
    props.liveItems,
    props.items,
    props.products,
    props.selectedProductId,
    props.state,
  ]);

  useEffect(() => {
    if (isOpen && step === 2) {
      reasonInputRef.current?.focus();
    }
  }, [isOpen, step]);

  const totalQuantity = draftItems.reduce((sum, item) => sum + item.quantity, 0);
  const hasCostBasis = draftItems.length > 0 && draftItems.every(item => item.costMinor > 0);
  const totalCostMinor = draftItems.reduce((sum, item) => sum + item.costMinor * item.quantity, 0);
  const totalPriceMinor = draftItems.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);
  const totalDisplayMinor = hasCostBasis ? totalCostMinor : totalPriceMinor;

  const stockExceededItem = draftItems.find(item => item.quantity > item.availableStock);

  function updateQuantity(productId: string, nextQuantity: number) {
    setErrorMessage('');
    setDraftItems(current =>
      current.map(item =>
        item.productId === productId
          ? { ...item, quantity: Math.max(1, Math.min(nextQuantity, Math.max(1, item.availableStock))) }
          : item
      )
    );
  }

  function removeItem(productId: string) {
    setErrorMessage('');
    setDraftItems(current => current.filter(item => item.productId !== productId));
  }

  function handleContinue() {
    if (draftItems.length === 0) {
      setErrorMessage('No hay productos seleccionados para dar de baja.');
      return;
    }
    if (stockExceededItem) {
      setErrorMessage(
        `La cantidad a dar de baja de "${stockExceededItem.name}" supera el stock disponible (${stockExceededItem.availableStock}).`
      );
      return;
    }
    setErrorMessage('');
    setStep(2);
  }

  async function submitWaste() {
    if (draftItems.length === 0) {
      setErrorMessage('No hay productos seleccionados para dar de baja.');
      return;
    }
    if (stockExceededItem) {
      setErrorMessage(
        `La cantidad a dar de baja de "${stockExceededItem.name}" supera el stock disponible (${stockExceededItem.availableStock}).`
      );
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setErrorMessage('');
      setReasonError('Escribe el motivo u observaciones de la merma.');
      reasonInputRef.current?.focus();
      return;
    }
    setReasonError('');

    if (isLive && apiRequest && branchId) {
      if (inFlight.current) return;
      const payload = {
        items: draftItems.map(item => ({ product_id: item.productId, quantity: item.quantity })),
        reason: cleanReason,
      };
      const payloadFingerprint = JSON.stringify({ branchId, payload });
      if (!pendingKey.current || pendingFingerprint.current !== payloadFingerprint) {
        pendingKey.current = `waste-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        pendingFingerprint.current = payloadFingerprint;
      }

      inFlight.current = true;
      setSubmitting(true);
      setErrorMessage('');
      try {
        const res = await recordWasteBatch(apiRequest, branchId, payload, pendingKey.current);
        pendingKey.current = null;
        pendingFingerprint.current = null;
        const successMessage = `Merma registrada: ${totalQuantity} unidad(es) descontada(s) del inventario.`;
        onSuccess?.({ totalUnits: totalQuantity, items: res.items, message: successMessage });
        onClose();
      } catch (err) {
        if (err instanceof InventoryApiError) {
          if (err.status === 409) {
            pendingKey.current = null;
            pendingFingerprint.current = null;
          }
          setErrorMessage(err.message);
        } else {
          setErrorMessage('No se pudo confirmar si la merma se registró. Reintenta con los mismos datos.');
        }
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
      return;
    }

    if (onConfirmWaste) {
      const demoItems: WasteItem[] = draftItems
        .filter((item): item is DraftWasteItem & { demoProduct: Product } => Boolean(item.demoProduct))
        .map(item => ({ product: item.demoProduct, quantity: item.quantity }));
      const result = onConfirmWaste(demoItems, cleanReason);
      if (result.status === 'error') {
        setErrorMessage(result.message);
      } else {
        onClose();
      }
    }
  }

  const description =
    step === 1
      ? 'Paso 1 de 2 · Confirma los productos y cantidades antes de continuar.'
      : 'Paso 2 de 2 · Registra las observaciones; se descontará del inventario y se avisará al administrador.';

  const footer =
    step === 1 ? (
      <>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          type="button"
          disabled={draftItems.length === 0 || Boolean(stockExceededItem)}
          onClick={handleContinue}
        >
          Continuar
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          type="button"
          disabled={submitting}
          onClick={() => {
            setErrorMessage('');
            setReasonError('');
            setStep(1);
          }}
        >
          Volver
        </Button>
        <Button variant="secondary" type="button" disabled={submitting} onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          type="button"
          className="ui-dialog__confirm--danger"
          disabled={submitting || draftItems.length === 0 || Boolean(stockExceededItem)}
          aria-busy={submitting || undefined}
          onClick={() => void submitWaste()}
        >
          {submitting ? 'Registrando…' : 'Confirmar merma'}
        </Button>
      </>
    );

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Registrar merma de producto"
      description={description}
      footer={footer}
      maxWidth="520px"
      dismissible={!submitting}
      closeLabel="Cerrar diálogo"
      panelClassName="merma-modal-card"
    >
      {step === 1 ? (
        <div className="merma-step-content">
          <div className="merma-items-section" role="group" aria-labelledby={itemsHeadingId}>
            <p id={itemsHeadingId} className="merma-items-heading">
              Productos seleccionados ({totalQuantity} {totalQuantity === 1 ? 'unidad' : 'unidades'}):
            </p>

            {draftItems.length === 0 ? (
              <Notice tone="warning">No hay productos seleccionados. Selecciona productos en el catálogo.</Notice>
            ) : (
              <div className="merma-items-list">
                {draftItems.map(item => {
                  const lineMinor = (hasCostBasis ? item.costMinor : item.priceMinor) * item.quantity;
                  return (
                    <div key={item.productId} className="merma-item-row">
                      <div className="merma-item-info">
                        <strong>{item.name}</strong>
                        <div className="muted merma-item-stock">
                          Disponibles: {item.availableStock}
                        </div>
                      </div>

                      <div className="merma-item-qty">
                        <button
                          type="button"
                          className="qty-btn"
                          aria-label={`Disminuir merma de ${item.name}`}
                          disabled={item.quantity <= 1}
                          onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        >
                          −
                        </button>
                        <output className="merma-item-output" aria-label={`Cantidad de merma de ${item.name}`}>
                          {item.quantity}
                        </output>
                        <button
                          type="button"
                          className="qty-btn"
                          aria-label={`Aumentar merma de ${item.name}`}
                          disabled={item.quantity >= item.availableStock}
                          onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="qty-btn qty-btn-remove"
                          aria-label={`Quitar ${item.name} de merma`}
                          onClick={() => removeItem(item.productId)}
                          title="Quitar producto"
                        >
                          <TrashIcon />
                        </button>
                      </div>

                      <strong className="merma-item-amount">
                        {formatMoney(lineMinor)} MXN
                      </strong>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="merma-value-summary">
            <span>
              {hasCostBasis ? 'Costo estimado de la merma:' : 'Valor total de la merma:'}
            </span>
            <strong className="merma-value-amount">
              {formatMoney(totalDisplayMinor)} MXN
            </strong>
          </div>
          {!hasCostBasis && isLive && draftItems.length > 0 && (
            <p className="muted merma-cost-note">
              Referencia a precio de venta (algunos productos no tienen costo base capturado).
            </p>
          )}

          {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
        </div>
      ) : (
        <form
          className="merma-step-content"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submitWaste();
          }}
        >
          <div className="merma-step2-summary">
            <div className="merma-step2-summary-header">
              <strong>
                Productos confirmados ({totalQuantity} {totalQuantity === 1 ? 'unidad' : 'unidades'})
              </strong>
              <strong className="merma-item-amount">{formatMoney(totalDisplayMinor)} MXN</strong>
            </div>
            <ul className="merma-step2-list">
              {draftItems.map(item => (
                <li key={item.productId}>
                  {item.name} × {item.quantity}
                </li>
              ))}
            </ul>
          </div>

          <FormField id={reasonFieldId} error={reasonError} label="Motivo u observaciones *">
            <input
              ref={reasonInputRef}
              className="merma-reason-input"
              type="text"
              placeholder="Ej. Producto dañado, roto, caducado o consumo interno"
              value={reason}
              disabled={submitting}
              onChange={e => {
                setReason(e.target.value);
                setErrorMessage('');
                setReasonError('');
              }}
              required
            />
          </FormField>

          {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
        </form>
      )}
    </Dialog>
  );
}
