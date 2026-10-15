import { fireEvent, render, screen, within } from '@testing-library/react';
import stylesheet from '../../styles.css?raw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../../shared/ui';
import { ComponentCatalog } from './ComponentCatalog';
import SwipeToast from './react-bits/SwipeToast';

const showModalDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
const elementAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

describe('shared component catalog foundation', () => {
  beforeEach(() => {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    window.matchMedia = vi.fn().mockImplementation(query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
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
    if (matchMediaDescriptor) Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
    else delete (window as Partial<Window>).matchMedia;
    if (resizeObserverDescriptor) Object.defineProperty(window, 'ResizeObserver', resizeObserverDescriptor);
    else Reflect.deleteProperty(window, 'ResizeObserver');
    if (elementAnimateDescriptor) Object.defineProperty(Element.prototype, 'animate', elementAnimateDescriptor);
    else Reflect.deleteProperty(Element.prototype, 'animate');
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
    expect(screen.getByRole('img', { name: 'Tendencia de ingresos de referencia' })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Datos de tendencia de referencia' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Frecuencia de asistencia' })).toBeVisible();
    expect(screen.queryByText('Semana 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Periodo de análisis' }), { target: { value: '12' } });
    expect(screen.getAllByText('Semana 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Semana 12').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por socio' }));
    expect(screen.getByRole('button', { name: 'Ordenar por socio' }).closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('filters fictional movements and keeps row selection visible across searches', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Vistas de datos' }));

    const movementTable = screen.getByRole('table', { name: 'Movimientos de ejemplo' });
    expect(screen.queryByRole('button', { name: 'Ordenar por selección' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Selección' })).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('button', { name: 'Ordenar por socio' })).toBeVisible();
    expect(screen.getByText('4 de 4 movimientos visibles')).toBeVisible();
    expect(screen.getByText('0 movimientos seleccionados')).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar movimiento M-101' }));
    expect(screen.getByText('1 movimiento seleccionado')).toBeVisible();

    const search = screen.getByRole('searchbox', { name: 'Filtrar movimientos de ejemplo' });
    fireEvent.change(search, { target: { value: 'Diego' } });
    expect(screen.getByText('1 de 4 movimientos visibles')).toBeVisible();
    expect(screen.getByText('1 movimiento seleccionado')).toBeVisible();
    expect(movementTable).not.toHaveTextContent('Mariana Solís');
    expect(movementTable).toHaveTextContent('Diego Ramos');

    fireEvent.change(search, { target: { value: 'sin coincidencia' } });
    expect(screen.getByText('0 de 4 movimientos visibles')).toBeVisible();
    expect(screen.getByText('Sin movimientos de ejemplo para este filtro.')).toBeVisible();

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Seleccionar movimiento M-101' })).toBeChecked();
  });

  it('compares fictional categories with an exact-value table beside the grouped chart', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Vistas de datos' }));

    const chart = screen.getByRole('img', { name: 'Comparación de categorías de referencia' });
    expect(chart).toBeVisible();
    expect(chart.querySelectorAll('[fill="var(--ts-chart-1)"]').length).toBeGreaterThan(0);
    expect(chart.querySelectorAll('[fill="var(--ts-chart-2)"]').length).toBeGreaterThan(0);
    const legend = screen.getByRole('list', { name: 'Escenarios de categorías de referencia' });
    expect(within(legend).getByText('Escenario A')).toBeVisible();
    expect(within(legend).getByText('Escenario B')).toBeVisible();
    expect(legend.querySelector('[data-series="scenario-a"]')).toHaveStyle({ backgroundColor: 'var(--ts-chart-1)' });
    expect(legend.querySelector('[data-series="scenario-b"]')).toHaveStyle({ backgroundColor: 'var(--ts-chart-2)' });
    const values = screen.getByRole('table', { name: 'Valores exactos de categorías de referencia' });
    expect(values).toHaveTextContent('Bebidas');
    expect(values).toHaveTextContent('Accesorios');
    expect(values).toHaveTextContent('Botanas');
    expect(values).toHaveTextContent('24');
    expect(values).toHaveTextContent('18');
    expect(values).toHaveTextContent('Escenario A');
    expect(values).toHaveTextContent('Escenario B');
  });

  it('covers all eighteen planned workflow references with explicitly fictional examples', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));

    expect(screen.getByText('Datos de referencia: esta galería no representa el estado operativo ni habilita las reglas pendientes.')).toBeVisible();
    expect(screen.getAllByText(/^T\d{2}$/)).toHaveLength(18);
  });

  it('renders reusable domain composites, not only workflow descriptions', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));

    expect(screen.getByRole('heading', { name: 'Socios y perfiles de referencia' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Venta y resultado de muestra' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Turno, alertas y reporte de referencia' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Producto e inventario de referencia' })).toBeVisible();
    expect(screen.getByText('Mara Solís · socia de ejemplo')).toBeVisible();
    expect(screen.getByText(/Agua · muestra × 2/)).toBeVisible();
  });

  it('announces neutral preview outcomes without changing catalog data', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));
    const result = screen.getByRole('combobox', { name: 'Resultado de compra (vista previa)' });

    fireEvent.change(result, { target: { value: 'success' } });
    expect(screen.getByRole('status', { name: 'Resultado de compra en vista previa' })).toHaveTextContent('Vista previa de resultado: registro disponible. Ningún dato cambió.');
    fireEvent.change(result, { target: { value: 'error' } });
    expect(screen.getByRole('alert', { name: 'Resultado de compra en vista previa' })).toHaveTextContent('Vista previa de resultado: error. Ningún dato cambió.');
    expect(screen.getByRole('alert', { name: 'Resultado de compra en vista previa' })).not.toHaveTextContent(/demo|fictici|simulad/i);
  });

  it('opens a modal dialog with focus, Escape, and focus return', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    fireEvent.click(screen.getByRole('tab', { name: 'Flujos de trabajo' }));
    const opener = screen.getByRole('button', { name: 'Ver diálogo ilustrativo' });
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Detalle ilustrativo' });
    const close = screen.getByRole('button', { name: 'Cerrar diálogo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Este diálogo solo muestra el componente. No confirma, guarda ni cambia datos.');
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('animates an enabled shared-button click from the activation point without delaying its handler', () => {
    const onClick = vi.fn();
    const { container } = render(<Button onClick={onClick}>Spark action</Button>);
    const button = screen.getByRole('button', { name: 'Spark action' });
    button.getBoundingClientRect = () => new DOMRect(10, 5, 100, 40);

    fireEvent.click(button, { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
    const spark = container.querySelector('.click-spark');
    expect(spark).toBeInTheDocument();
    expect(spark).toHaveStyle({ '--click-spark-x': '50%', '--click-spark-y': '50%' });
    fireEvent.click(button, { detail: 1, clientX: 35, clientY: 20 });
    expect(container.querySelector('.click-spark')).toHaveStyle({ '--click-spark-x': '25px', '--click-spark-y': '15px' });
  });

  it('does not spark disabled buttons or buttons under reduced-motion preferences', () => {
    const disabledAction = vi.fn();
    const enabledAction = vi.fn();
    const { container } = render(<><Button disabled onClick={disabledAction}>Disabled action</Button><Button onClick={enabledAction}>Reduced action</Button></>);

    fireEvent.click(screen.getByRole('button', { name: 'Disabled action' }));
    expect(disabledAction).not.toHaveBeenCalled();
    expect(container.querySelector('.click-spark')).not.toBeInTheDocument();

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Reduced action' }));
    expect(enabledAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.click-spark')).not.toBeInTheDocument();
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
    const surface = '#202020';
    const primaryLabel = readToken('--catalog-primary-label')!;
    const fieldError = readToken('--catalog-field-error')!;
    const chartOne = readToken('--catalog-chart-1')!;
    const chartTwo = readToken('--catalog-chart-2')!;

    expect(contrast(primaryLabel, '#FC6C06')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fieldError, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(chartOne, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(chartTwo, surface)).toBeGreaterThanOrEqual(3);
    expect(stylesheet).toMatch(/\.catalog-content\s*\{[^}]*animation:/s);
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.catalog-content/);
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.catalog-dialog\[open\][\s\S]*?\.catalog-dialog::backdrop/);
  });
  it('offers nine interactive React Bits demos only in the components tab', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    for (const name of ['CodeSlots', 'JellyRadio', 'RubberSegment', 'SpringCheck', 'SquishSwitch', 'SwipeToast', 'MagicBento', 'AnimatedList', 'Stepper']) {
      expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    expect(screen.getByText(/NO ES AUTENTICACIÓN/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mostrar aviso de vista previa' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Vistas de datos' }));
    expect(screen.queryByRole('heading', { name: 'CodeSlots' })).not.toBeInTheDocument();
  });
  it('uses neutral preview language throughout the component showcase', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    expect(document.querySelector('.catalog-page')).not.toHaveTextContent(/demo|demostraci[oó]n|fictici|simulad/i);
  });
  it('keeps the fictional React Bits controls operable and disabled code input inert', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    const digits = screen.getByRole('textbox', { name: 'Dígitos de muestra; no es autenticación' });
    fireEvent.keyDown(digits, { key: '1' });
    expect(screen.getByText('Dígitos de muestra ingresados: 1 de 4')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Dígitos de muestra deshabilitados' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Muestra B' }));
    expect(screen.getByText('Selección: Muestra B')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Resumen' }), { key: 'ArrowRight' });
    expect(screen.getByText('Vista: Detalle')).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Marcar elemento como completo' }));
    expect(screen.getByText('Lista de verificación: completa')).toBeVisible();
    fireEvent.click(screen.getByRole('switch', { name: 'Preferencia visual' }));
    expect(screen.getByText('Preferencia: activada')).toBeVisible();
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(screen.getByText('Elemento seleccionado: Muestra B')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente paso' }));
    expect(screen.getByText('Paso actual: 2')).toBeVisible();
  });
  it('preserves sample errors and remains usable with reduced motion', () => {
    window.matchMedia = vi.fn().mockImplementation(query => ({ matches: query.includes('reduced-motion'), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    expect(screen.getByText('Estudio de muestra')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar error de vista previa' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Error de vista previa');
    expect(screen.getByRole('alert')).toHaveTextContent('No se modificaron datos de la aplicación.');
    expect(stylesheet).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*?\.react-bits-gallery/);
  });
  it('does not request authentication autofill and localizes the toast close control', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    expect(screen.getByRole('textbox', { name: 'Dígitos de muestra; no es autenticación' })).toHaveAttribute('autocomplete', 'off');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar error de vista previa' }));
    expect(screen.getByRole('button', { name: 'Cerrar aviso' })).toBeInTheDocument();
  });
  it('suppresses toast Web Animations under reduced motion', () => {
    const animate = vi.fn().mockReturnValue({ pause() {}, cancel() {}, play() {}, playState: 'running', onfinish: null });
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    render(<SwipeToast open duration={5000} reducedMotion title="Aviso de muestra" />);
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector('.swipe-toast')).toHaveAttribute('data-fuse', 'none');
  });
  it('finishes a reduced-motion toast swipe without a scripted exit animation', () => {
    const onClose = vi.fn();
    render(<SwipeToast open duration={0} reducedMotion title="Aviso de muestra" onClose={onClose} />);
    const toast = screen.getByText('Aviso de muestra').closest('[role="status"]')!;
    fireEvent.pointerDown(toast, { button: 0, pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(toast, { pointerId: 1, clientY: 60 });
    fireEvent.pointerMove(toast, { pointerId: 1, clientY: 120 });
    fireEvent.pointerUp(toast, { pointerId: 1, clientY: 120 });
    expect(onClose).toHaveBeenCalledWith('swipe');
  });
});
