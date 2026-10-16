import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DemoProvider, useDemo } from '../../demo/DemoProvider';
import { ReceptionHome } from '../reception/ReceptionHome';
import { Inventory } from './Inventory';

function StateProbe() {
  const { state } = useDemo();
  return <output aria-label="Persisted state">{JSON.stringify(state)}</output>;
}

describe('Inventory catalog preview', () => {
  it('searches products and keeps receiving actions unavailable without cost data', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    expect(screen.getByRole('heading', { name: 'Recepción de inventario' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar producto' }), { target: { value: 'agua' } });
    expect(screen.getByRole('button', { name: /Seleccionar Agua/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Seleccionar Barra/ })).not.toBeInTheDocument();
    expect(screen.getByText('Costo unitario').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByRole('button', { name: 'Crear producto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled();
  });

  it('matches home product markup, order, stock, price and layout classes', () => {
    const home = render(<MemoryRouter><DemoProvider><ReceptionHome /></DemoProvider></MemoryRouter>);
    const initialCards = screen.getAllByRole('article').map(card => card.outerHTML);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    const selectedCard = screen.getByRole('button', { name: /Seleccionar Agua/ }).closest('article')?.outerHTML;
    home.unmount();
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    expect(screen.getAllByRole('article').map(card => card.outerHTML)).toEqual(initialCards);
    const card = screen.getByRole('button', { name: /Seleccionar Agua/ });
    expect(card.closest('.product-grid')).toHaveAttribute('class', 'product-grid');
    expect(card.closest('.product-catalog-panel')).not.toBeNull();
    expect(card.closest('.reception-products-column')).not.toBeNull();
    expect(card.closest('.reception-checkout')).not.toBeNull();
    fireEvent.click(card);
    expect(card.closest('article')?.outerHTML).toEqual(selectedCard);
  });

  it('increments and decrements with clicks and quantity controls without changing persisted state', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /><StateProbe /></DemoProvider>);
    const stateBefore = screen.getByLabelText('Persisted state').textContent;
    const agua = screen.getByRole('button', { name: /Seleccionar Agua/ });
    const barra = screen.getByRole('button', { name: /Seleccionar Barra/ });
    for (let count = 0; count < 13; count++) fireEvent.click(agua);
    fireEvent.click(barra);
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('13');
    expect(screen.getByLabelText(/Cantidad de Barra/)).toHaveTextContent('1');
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    fireEvent.contextMenu(agua.closest('article') as HTMLElement);
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('12');
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('12');
    fireEvent.click(screen.getByRole('button', { name: /Aumentar Agua/ }));
    fireEvent.click(screen.getByRole('button', { name: /Disminuir Agua/ }));
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('12');
    fireEvent.click(screen.getByRole('button', { name: /Quitar Agua/ }));
    expect(screen.queryByLabelText(/Cantidad de Agua/)).not.toBeInTheDocument();
    expect(agua).toHaveAttribute('aria-pressed', 'false');
    fireEvent.contextMenu(barra.closest('article') as HTMLElement);
    fireEvent.contextMenu(barra.closest('article') as HTMLElement);
    expect(screen.queryByLabelText(/Cantidad de Barra/)).not.toBeInTheDocument();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('0');
    expect(screen.getByLabelText('Persisted state').textContent).toBe(stateBefore);
  });

  it('preserves independent local quantities while filtering and shows an empty search state', () => {
    render(<DemoProvider><Inventory role="RECEPTION" /></DemoProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Barra/ }));
    const search = screen.getByRole('searchbox', { name: 'Buscar producto' });
    fireEvent.change(search, { target: { value: 'unknown-product' } });
    expect(screen.getByRole('status')).toHaveTextContent('No se encontraron productos.');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.change(search, { target: { value: ' AGUA ' } });
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('1');
    expect(screen.queryByLabelText(/Cantidad de Barra/)).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByLabelText(/Cantidad de Agua/)).toHaveTextContent('1');
    expect(screen.getByLabelText(/Cantidad de Barra/)).toHaveTextContent('1');
  });

  it('opens the non-transactional receiving preview without inventing a total', async () => {
    render(<DemoProvider><Inventory role="RECEPTION" /><StateProbe /></DemoProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Seleccionar Agua/ }));
    const stateBefore = screen.getByLabelText('Persisted state').textContent;
    fireEvent.click(document.querySelector('.mobile-detail-trigger')!);
    expect(screen.getByRole('dialog', { name: 'Vista previa de recepción' })).toBeVisible();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Costo unitario').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByText('Total de recepción').parentElement).toHaveTextContent('No disponible');
    expect(screen.getByRole('button', { name: 'Confirmar recepción' })).toBeDisabled();
    fireEvent.click(document.querySelector('.mobile-detail-close')!);
    expect(screen.queryByRole('dialog', { name: 'Vista previa de recepción' })).not.toBeInTheDocument();
    expect(screen.getByText('Cantidad recibida').parentElement).toHaveTextContent('1');
    expect(screen.getByLabelText('Persisted state').textContent).toBe(stateBefore);
  });
});
