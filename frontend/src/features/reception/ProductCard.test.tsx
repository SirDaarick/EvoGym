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

  it('renders supplement-style card with subtitle, custom priceSuffix, and custom stockLabel', async () => {
    const onQuantityChange = vi.fn();
    const onSelect = vi.fn();
    const supplementItem = {
      id: 'sup-01',
      name: 'Proteína Whey',
      priceMinor: 3500,
      flavor: 'Vainilla',
    };

    const { container } = render(
      <ProductCard
        product={supplementItem}
        subtitle="Vainilla"
        stock={24}
        stockLabel="24 scoops"
        priceSuffix=" / scoop"
        quantity={1}
        onSelect={onSelect}
        onQuantityChange={onQuantityChange}
      />
    );

    expect(screen.getByText('24 scoops')).toBeVisible();
    expect(screen.getByText('Vainilla')).toBeVisible();
    expect(screen.getByText('$35.00 / scoop')).toBeVisible();

    // Left-click on card tile increments quantity
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Proteína Whey (Vainilla)' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onQuantityChange).toHaveBeenCalledWith(2);

    // Right-click on card article decrements quantity
    fireEvent.contextMenu(container.querySelector('article')!);
    expect(onQuantityChange).toHaveBeenCalledWith(0);
  });
});
