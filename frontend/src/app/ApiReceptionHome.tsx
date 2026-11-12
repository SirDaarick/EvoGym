import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedRequest } from '@/api/inventoryApi';
import { queryKeys } from '@/api/queryKeys';
import { CurrentPurchaseCard, type CheckoutPaymentBreakdown } from '../features/reception/CurrentPurchaseCard';
import { MemberAssignmentField } from '../features/reception/home/MemberAssignmentField';
import { ProductCatalogPanel } from '../features/reception/home/ProductCatalogPanel';
import { PurchaseSummary } from '../features/reception/home/PurchaseSummary';
import { ReceptionShortcutBar } from '../features/reception/home/ReceptionShortcutBar';
import { readStoredIntent, useProductSaleIntent } from '../features/reception/home/useProductSaleIntent';
import { useProductSaleSubmit } from '../features/reception/home/useProductSaleSubmit';
import { useCheckoutCatalog } from '../features/reception/home/useCheckoutCatalog';
import { useMemberSearch, type SearchMember } from '../features/reception/home/useMemberSearch';
import { useReceptionModals } from '../features/reception/home/useReceptionModals';
import { useRecoveredMember } from '../features/reception/home/useRecoveredMember';
import { MobileDetailPanel } from '../shared/MobileDetailPanel';
import { Button, PageHeader } from '../shared/ui';
import { DevolucionesModal } from '../features/reception/DevolucionesModal';
import { MermaModal } from '../features/reception/MermaModal';
import { GuantesModal } from '../features/reception/GuantesModal';
import { CasillerosModal } from '../features/reception/CasillerosModal';
import { ExtraModal } from '../features/reception/ExtraModal';
import { GastoModal } from '../features/reception/GastoModal';
import { SuplementosModal } from '../features/reception/SuplementosModal';

export function ApiReceptionHome({ request, actorId }: { request: AuthenticatedRequest; actorId: string }) {
  const queryClient = useQueryClient();
  const modals = useReceptionModals();
  const [registerId, setRegisterId] = useState(() => readStoredIntent(actorId)?.registerId ?? '');
  const saleIntent = useProductSaleIntent(request, actorId, setRegisterId);
  const { intent, intentLoaded } = saleIntent;
  const { branches, registers, stock, currentBranchId, catalogFailed, stockFailed } = useCheckoutCatalog(request, actorId, registerId);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [member, setMember] = useState<SearchMember | null>(null);
  const search = useMemberSearch(request, actorId, member !== null);
  const recoveredMemberName = useRecoveredMember(request, actorId, intent?.payload.member_id);
  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (saleIntent.loadFailed) { setError(true); setMessage('No se pudo consultar la compra pendiente. Recarga la página.'); }
  }, [saleIntent.loadFailed]);
  useEffect(() => {
    if (catalogFailed) { setError(true); setMessage('No se pudieron consultar las cajas y sucursales.'); }
  }, [catalogFailed]);
  useEffect(() => {
    if (stockFailed) { setError(true); setMessage('No se pudo cargar el inventario.'); }
  }, [stockFailed]);
  useEffect(() => {
    if (registerId || !registers.length) return;
    const open = registers.filter(register => register.has_open_shift);
    if (open.length === 1) setRegisterId(open[0].id);
    else if (registers.length === 1) setRegisterId(registers[0].id);
  }, [registers, registerId]);

  const selected = stock.filter(item => (quantities[item.product_id] ?? 0) > 0);
  const total = intent?.payload.expected_total_minor ?? selected.reduce((sum, item) => sum + item.price_minor * quantities[item.product_id], 0);
  const locked = !intentLoaded || pending || intent !== null;
  function changeQuantity(id: string, value: number) {
    const maximum = stock.find(item => item.product_id === id)?.quantity ?? 0;
    setQuantities(current => ({ ...current, [id]: Math.max(0, Math.min(value, maximum)) }));
  }

  const sale = useProductSaleSubmit({
    request, registerId, saleIntent, setMessage, setError, setPending, actorId,
    cart: { total, memberId: member?.id ?? null, items: selected.map(item => ({ product_id: item.product_id, quantity: quantities[item.product_id] })) },
    resetCart: () => { setQuantities({}); setMember(null); search.setQuery(''); setStep(1); },
    backToStart: () => setStep(1),
  });

  const hasOpenShift = Boolean(registers.find(register => register.id === registerId)?.has_open_shift);
  const purchaseContent = <>
    <CurrentPurchaseCard totalMinor={total} disabled={locked} step={step} onStepChange={setStep}
      useLiveCardIntent allowCredit allowMixed={false} disabledMethods={['transfer']} hasOpenShift={hasOpenShift}
      step1ActionDisabled={!selected.length || !registerId || locked} onConfirmPayment={(value: CheckoutPaymentBreakdown) => void sale.submit(value)}
      statusMessage={message} statusType={error ? 'error' : pending ? 'warning' : 'success'}
      assignedMember={member ? { id: member.id, name: member.full_name, phone: member.phone, creditMinor: member.credit_balance_minor ?? 0 } : null}
      memberAssignment={<MemberAssignmentField member={member} query={search.query} results={search.members} locked={locked}
        onQueryChange={search.setQuery} onSelect={setMember} onClear={() => { setMember(null); search.setQuery(''); }} />}>
      <PurchaseSummary intent={intent} recoveredMemberName={recoveredMemberName} selected={selected} quantities={quantities}
        stock={stock} locked={locked} onRemove={id => changeQuantity(id, 0)} />
    </CurrentPurchaseCard>
    {sale.activeCardIntentId && <div style={{ marginTop: '8px' }}><Button variant="secondary" onClick={() => void sale.cancelCurrentCardIntent()}>Cancelar cobro en terminal</Button></div>}
    {intent && !sale.activeCardIntentId && <div><p role="status">La compra está pendiente de confirmación. Al resolverla se recupera la venta registrada o se cancela el intento si no se registró.</p><Button disabled={pending} onClick={() => void sale.resolveIntent()}>Resolver compra pendiente</Button></div>}
  </>;

  return <>
    <PageHeader eyebrow="RECEPCIÓN · INICIO" title="Inicio de recepción" description="Socios y ventas, a un paso." />
    <div className="reception-checkout">
      <div className="reception-products-column">
        <ReceptionShortcutBar registerReady={Boolean(registerId && currentBranchId)} locked={locked} onOpen={modals.open} />
        <ProductCatalogPanel registers={registers} branches={branches} registerId={registerId} stock={stock} quantities={quantities} locked={locked}
          hasSelectedItems={selected.length > 0} onRegisterChange={id => { setRegisterId(id); setQuantities({}); setStep(1); }} onQuantityChange={changeQuantity} onOpenReturns={() => modals.open('devoluciones')} onOpenWaste={currentBranchId ? () => modals.open('merma') : undefined} />
      </div>
      <MobileDetailPanel title="Compra actual" triggerLabel="Ver compra actual" className="reception-current-purchase-slot">
        {!modals.isOpen('suplementos') && purchaseContent}
      </MobileDetailPanel>
    </div>
    <SuplementosModal isOpen={modals.isOpen('suplementos')} onClose={modals.close} live={{ stock, quantities, disabled: locked, onQuantityChange: changeQuantity, checkout: purchaseContent }} />
    {registerId && (
      <>
        <DevolucionesModal
          isOpen={modals.isOpen('devoluciones')}
          onClose={modals.close}
          apiRequest={request}
          registerId={registerId}
          initialMemberId={member?.id}
          onSuccess={({ message: returnMsg }) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
            setMessage(returnMsg);
            setError(false);
          }}
        />
        {currentBranchId && (
          <MermaModal
            isOpen={modals.isOpen('merma')}
            onClose={modals.close}
            apiRequest={request}
            branchId={currentBranchId}
            liveItems={selected.map(item => ({
              productId: item.product_id,
              name: item.name,
              priceMinor: item.price_minor,
              costMinor: item.cost_minor,
              availableStock: item.quantity ?? 0,
              quantity: quantities[item.product_id] ?? 0,
            }))}
            onSuccess={({ items: wastedItems, message: wasteMsg }) => {
              const nextQuantities = { ...quantities };
              for (const movement of wastedItems) {
                const remaining = (nextQuantities[movement.product_id] ?? 0) - movement.quantity;
                if (remaining > 0) nextQuantities[movement.product_id] = remaining;
                else delete nextQuantities[movement.product_id];
              }
              setQuantities(nextQuantities);
              if (Object.values(nextQuantities).every(qty => qty <= 0)) {
                setStep(1);
              }
              void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
              setError(false);
              setMessage(wasteMsg);
            }}
          />
        )}
        <ExtraModal isOpen={modals.isOpen('extra')} onClose={modals.close} apiRequest={request} registerId={registerId} />
        <GastoModal isOpen={modals.isOpen('gasto')} onClose={modals.close} apiRequest={request} registerId={registerId} branchId={currentBranchId} />
        <GuantesModal isOpen={modals.isOpen('guantes')} onClose={modals.close} apiRequest={request} registerId={registerId} branchId={currentBranchId || branches[0]?.id} hasOpenShift={hasOpenShift} />
        <CasillerosModal isOpen={modals.isOpen('casilleros')} onClose={modals.close} apiRequest={request} registerId={registerId} branchId={currentBranchId || branches[0]?.id} hasOpenShift={hasOpenShift} />
      </>
    )}
  </>;
}
