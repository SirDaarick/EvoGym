import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../../domain/models';
import { ProductCard } from './ProductCard';

const product: Product = { id: 'water', name: 'Agua', priceMinor: 2000, openingQuantity: 12, illustrative: true };

describe('ProductCard', () => {
  it('renders a selectable product without imposing a transaction', async () => {
    const onSelect = vi.fn();
    render(<ProductCard product={product} stock={12} selected onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Seleccionar Agua' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Stock: 12')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Agua' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Cantidad de Agua')).not.toBeInTheDocument();
  });

  it('delegates quantity controls to its caller', async () => {
    const onQuantityChange = vi.fn();
    render(<ProductCard product={product} stock={12} quantity={2} onQuantityChange={onQuantityChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar Agua' }));
    expect(onQuantityChange).toHaveBeenCalledWith(3);
    expect(screen.getByLabelText('Cantidad de Agua')).toHaveTextContent('2');
  });

  it('does not decrement a disabled product from its context menu', () => {
    const onQuantityChange = vi.fn();
    const { container } = render(<ProductCard product={product} stock={12} quantity={2} disabled onQuantityChange={onQuantityChange} />);
    fireEvent.contextMenu(container.querySelector('article')!);
    expect(onQuantityChange).not.toHaveBeenCalled();
  });
});
