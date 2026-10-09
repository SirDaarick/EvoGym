import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { ReceptionHome } from './ReceptionHome';

function ProductsProbe() {
  const { state } = useDemo();
  return <output aria-label="Cantidad de productos">{state.products.length}</output>;
}

describe('Reception Home overview', () => {
  it('shows every fixture product and the honest existing sale route', () => {
    render(<MemoryRouter><DemoProvider><ReceptionHome /><ProductsProbe /></DemoProvider></MemoryRouter>);
    expect(screen.getAllByRole('article')).toHaveLength(Number(screen.getByLabelText('Cantidad de productos').textContent));
    expect(screen.getByRole('link', { name: 'Registrar venta' })).toHaveAttribute('href', '/reception/sales');
    expect(screen.getByText(/El carrito se agregará/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Buscar socio' })).toHaveAttribute('href', '/reception/members');
    expect(screen.getByText('Imágenes pendientes · Los productos, precios y existencias son ilustrativos.')).toBeVisible();
  });
});
