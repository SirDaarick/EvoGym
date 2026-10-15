import type { ReactNode } from 'react';
import type { PaymentMethod } from '../../domain/models';
import { formatMoney } from '../../demo/adapter';
import { useIsDarkMode } from '../../shared/theme';
import { Panel } from '../../shared/ui';
import JellyRadio from '../catalog/react-bits/JellyRadio';
import './CurrentPurchaseCard.css';

interface CurrentPurchaseCardProps {
  totalMinor: number;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (method: PaymentMethod) => void;
  headerContent?: ReactNode;
  memberAssignment?: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function CurrentPurchaseCard({ totalMinor, paymentMethod, onPaymentMethodChange, headerContent, memberAssignment, children, className = '', disabled = false }: CurrentPurchaseCardProps) {
  const dark = useIsDarkMode();
  return <Panel className={`cart-checkout-panel current-purchase-card ${className}`.trim()}>
    <div className="cart-header-top">
      <div className="cart-heading-row">
        <h2>Compra actual</h2>
        <output className="cart-total-badge" aria-label="Total de compra">{`${formatMoney(totalMinor)} MXN`}</output>
      </div>
      {headerContent}
    </div>
    {memberAssignment}
    <div className="cart-payment-methods-box">
      <span className="field-label" id="payment-method-label">Método de cobro</span>
      <div className="cart-jelly-method-wrap">
        <JellyRadio
          items={[{ value: 'cash', label: 'Efectivo' }, { value: 'card', label: 'Tarjeta' }, { value: 'transfer', label: 'Transferencia' }]}
          value={paymentMethod}
          disabled={disabled}
          onChange={value => onPaymentMethodChange(value as PaymentMethod)}
          size="sm"
          radius={10}
          swell={0}
          barge={0}
          shrink={0}
          chipColor={dark ? '#26232E' : '#EFEFED'}
          activeColor="#FC6C06"
          textColor={dark ? '#D1D0D5' : '#3F3F46'}
          activeTextColor="var(--color-primary-text, #080808)"
          ariaLabel="Método de cobro"
        />
      </div>
    </div>
    {children}
  </Panel>;
}
