import { fireEvent, render, screen } from '@testing-library/react';
import stylesheet from '../../styles.css?raw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComponentCatalog } from './ComponentCatalog';

const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

describe('shared component catalog foundation', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    if (showModalDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  });

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

  it('renders reusable domain composites, not only workflow descriptions', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));

    expect(screen.getByRole('heading', { name: 'Socios y perfiles demo' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Venta y resultado de muestra' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Turno, alertas y reporte demo' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Producto e inventario demo' })).toBeVisible();
    expect(screen.getByText('Mara Solís · socia de ejemplo')).toBeVisible();
    expect(screen.getByText(/Agua · muestra × 2/)).toBeVisible();
  });

  it('announces simulated success and error outcomes without changing demo records', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));
    const result = screen.getByRole('combobox', { name: 'Resultado de compra (demo)' });

    fireEvent.change(result, { target: { value: 'success' } });
    expect(screen.getByRole('status', { name: 'Resultado ficticio de compra' })).toHaveTextContent('Éxito de muestra');
    fireEvent.change(result, { target: { value: 'error' } });
    expect(screen.getByRole('alert', { name: 'Resultado ficticio de compra' })).toHaveTextContent('Error de muestra');
  });

  it('opens a modal dialog with focus, Escape, and focus return', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));
    const opener = screen.getByRole('button', { name: 'Ver diálogo ilustrativo' });
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Detalle ilustrativo de muestra' });
    const close = screen.getByRole('button', { name: 'Cerrar diálogo de muestra' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Este diálogo solo ilustra el componente. No confirma, guarda ni cambia datos.');
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo de muestra' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps dark-theme text and chart colors above their minimum contrast ratios', () => {
    const readToken = (name: string) => stylesheet.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const surface = '#1A1D23';
    const primaryLabel = readToken('--catalog-primary-label')!;
    const fieldError = readToken('--catalog-field-error')!;
    const chartOne = readToken('--catalog-chart-1')!;
    const chartTwo = readToken('--catalog-chart-2')!;

    expect(contrast(primaryLabel, '#FF9A54')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fieldError, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(chartOne, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(chartTwo, surface)).toBeGreaterThanOrEqual(3);
    expect(stylesheet).toMatch(/\.catalog-content\s*\{[^}]*animation:/s);
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.catalog-content/);
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.catalog-dialog\[open\][\s\S]*?\.catalog-dialog::backdrop/);
  });
});
