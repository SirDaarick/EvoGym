import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ComponentCatalog } from './ComponentCatalog';

describe('shared component catalog foundation', () => {
  afterEach(() => { delete document.documentElement.dataset.theme; });

  it('exposes keyboard-operable tab navigation and applies reduced-motion guidance', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/reducen movimiento/i)).toBeVisible();
  });

  it('provides a direct, accessible light and dark theme control', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    const control = screen.getByRole('button', { name: 'Usar tema oscuro' });
    fireEvent.click(control);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders sortable movement examples, accessible chart alternatives, and attendance', async () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Vistas de datos' }));

    expect(screen.getByRole('button', { name: 'Ordenar por socio' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Movimientos de ejemplo' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Tendencia de ingresos de muestra' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Datos de tendencia de ejemplo' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Frecuencia de asistencia demo' })).toBeVisible();
    expect(screen.queryByText('Semana 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Periodo de análisis (demo)' }), { target: { value: '12' } });
    expect(screen.getAllByText('Semana 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Semana 12').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por socio' }));
    expect(screen.getByRole('button', { name: 'Ordenar por socio' }).closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('covers all eighteen planned workflow references with explicitly fictional examples', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));

    expect(screen.getByText(/muestras ficticias/i)).toBeVisible();
    expect(screen.getAllByText(/^T\d{2}$/)).toHaveLength(18);
  });
});
