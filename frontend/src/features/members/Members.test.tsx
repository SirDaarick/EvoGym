import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { DemoProvider } from '../../demo/DemoProvider';

async function mount(path = '/reception/members') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /></DemoProvider></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}
describe('member workflow', () => {
  it('registers a measured visit and tries automatic closure without inventing time', async () => {
    await mount('/reception/members/demo-active');
    expect(screen.queryByText('Reloj y cierre de demostración')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /avanzar|simular/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Entrada registrada');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Salida registrada');
  }, 12000);
  it('groups global suggestions and selects a member with the keyboard', async () => {
    await mount('/reception/home');
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(input, 'Alex');
    expect(within(screen.getByRole('listbox')).getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(['Activos']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Enter}');
    expect(await screen.findByRole('heading', { name: 'Alex Morgan' }, { timeout: 10000 })).toBeVisible();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asistencia previa' })).toBeVisible();
  });
  it('shows no results and Escape closes suggestions', async () => {
    await mount();
    const input = screen.getByRole('combobox', { name: 'Búsqueda global de socios' });
    await userEvent.type(input, 'nobody');
    expect(screen.getByText('Sin coincidencias de socios.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sin coincidencias de socios.')).not.toBeInTheDocument();
  });
  it('requires renewal in the expired demo without pretending attendance exists', async () => {
    await mount('/reception/members/demo-expired');
    expect(screen.queryByRole('button', { name: 'Registrar entrada' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Registrar pago de membresía' })).not.toBeInTheDocument();
  });
  it('searches members and creates a member with only a required name', async () => {
    await mount();
    await userEvent.type(screen.getByLabelText('Buscar socio'), 'Mariana');
    expect(screen.getByRole('link', { name: 'Mariana López' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Carlos Rivera' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.type(screen.getByLabelText('Monto recibido'), '500');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar operación' }));
    expect(screen.getByRole('heading', { name: 'Registro guardado' })).toBeVisible();
    expect(screen.getByText(/Ana Torres/)).toBeVisible();
  });
  it('presents operation types as theme-aware accessible JellyRadio choices and plans as a list', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const operationChoices = within(screen.getByRole('radiogroup', { name: 'Tipo de operación' })).getAllByRole('radio');
    expect(operationChoices).toHaveLength(3);
    expect(operationChoices[0]).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-h': '36px' });
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-active': '#f5f5f5' });
    expect(screen.getByLabelText('Detalles del registro')).toBeVisible();
    const planList = screen.getByRole('listbox');
    expect(within(planList).getAllByRole('option').length).toBeGreaterThan(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Clase muestra' }));
    expect(screen.getByRole('option', { name: /Clase muestra.*100/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Total de compra')).toHaveTextContent('$100.00 MXN');
    await userEvent.click(screen.getByRole('button', { name: 'Usar tema oscuro' }));
    expect(document.querySelector('.registration-type-jelly')).toHaveStyle({ '--jr-h': '36px' });
  });
  it('shows method-specific cash, card, and transfer details and submits without acknowledgements', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    expect(screen.getByLabelText('Monto recibido')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Monto recibido'), '1000');
    expect(within(screen.getByText('Cambio a devolver:').parentElement!).getByText('$500.00 MXN')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Tarjeta' }));
    expect(screen.queryByRole('heading', { name: 'Terminal bancaria' })).not.toBeInTheDocument();
    expect(screen.queryByText(/comisión|neto/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Transferencia' }));
    expect(screen.queryByText(/exacto/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/T03/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Terminal bancaria' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('uses the shared cash calculator with exact payment and decimal validation', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const input = screen.getByLabelText('Monto recibido');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '1000');
    expect(screen.getByText('Cambio a devolver:')).toBeVisible();
    expect(within(screen.getByText('Cambio a devolver:').parentElement!).getByText('$500.00 MXN')).toBeVisible();
    await userEvent.clear(input);
    await userEvent.type(input, '1.234');
    expect(screen.getByText('Monto inválido')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pago exacto' }));
    expect(input).toHaveValue('500.00');
  });
  it('blocks cash registration when the tendered amount is below the current total', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.type(screen.getByLabelText('Monto recibido'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar operación' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Faltan $400.00 MXN.');
    expect(screen.queryByRole('heading', { name: 'Registro guardado' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Torres');
  });
  it('allows a student-rate plan without a verification checkbox or gate', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Alex Ruiz');
    await userEvent.click(screen.getByRole('option', { name: /Gym estudiante/i }));
    await userEvent.type(screen.getByLabelText('Monto recibido'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar operación' }));
    expect(screen.getByRole('heading', { name: 'Registro guardado' })).toBeVisible();
  });
  it('reuses the current purchase checkout without member assignment', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const currentPurchaseHeading = screen.getByRole('heading', { name: 'Compra actual' });
    expect(currentPurchaseHeading).toBeVisible();
    expect(currentPurchaseHeading.closest('section')).toHaveClass('cart-checkout-panel');
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Asignar socio' })).not.toBeInTheDocument();
  });
  it('shows a live draft assignment for membership and trial, but never for visits', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.getByText('Asignación de borrador')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Teléfono (opcional)'), '5551234');
    expect(screen.getByText('Tel: 5551234')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Visita' }));
    expect(screen.queryByText('Asignación de borrador')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Membresía' }));
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.getByText('Tel: 5551234')).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Clase muestra' }));
    expect(screen.getByText('Asignación de borrador')).toBeVisible();
  });
  it('places details before a bounded checkout column in the registration layout', async () => {
    await mount();
    await userEvent.click(screen.getByRole('link', { name: 'Nuevo socio' }));
    await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 });
    const form = document.querySelector('.new-registration-form')!;
    expect(form).toHaveClass('new-registration-form');
    expect(form.parentElement).toHaveClass('registration-checkout');
      expect(document.querySelector('.registration-panel')).toBeNull();
    const details = form.querySelector('.registration-main')!;
    const checkout = form.querySelector('.registration-current-purchase')!;
      expect(details.querySelector('.registration-details-card')).toBeInTheDocument();
      expect(checkout).toHaveClass('current-purchase-card');
    expect(details.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('reviews a cash payment, records it and leaves access dates unresolved', async () => {
    await mount('/reception/members/demo-002/payment');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    expect(screen.getByRole('heading', { name: 'Revisar pago de membresía' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(screen.getByRole('heading', { name: 'Pago completo registrado' })).toBeVisible();
    expect(screen.getByText(/Operación registrada localmente\. No activa acceso/)).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Ver socio' }));
    expect(screen.queryByText('Pagado · fechas por definir')).not.toBeInTheDocument();
    expect(screen.getAllByText('Pagado').length).toBeGreaterThan(0);
  });
  it('does not present a transfer as paid', async () => {
    await mount('/reception/members/demo-002/payment');
    await userEvent.selectOptions(screen.getByLabelText('Método'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar transferencia pendiente' }));
    expect(screen.getByRole('heading', { name: 'Transferencia sin confirmar' })).toBeVisible();
    expect(screen.queryByText('Pago completo registrado')).not.toBeInTheDocument();
  });
  it('renders owner member analytics in /owner/members and keeps reception view clean', async () => {
    await mount('/owner/members');
    expect(screen.getByRole('region', { name: 'Analítica de socios y membresías' })).toBeVisible();
    expect(screen.getByText('Directorio y análisis de socios')).toBeVisible();
    expect(screen.getByText('Socios Activos')).toBeVisible();
    expect(screen.getByText('Antigüedad (Mediana)')).toBeVisible();
    expect(screen.getByText('Desglose por disciplina y plan')).toBeVisible();
  });
  it('does not render owner analytics in reception view', async () => {
    await mount('/reception/members');
    expect(screen.queryByRole('region', { name: 'Analítica de socios y membresías' })).not.toBeInTheDocument();
    expect(screen.getByText('Socios y membresías')).toBeVisible();
  });
  it('opens the registration summary without submitting the draft', async () => {
    await mount('/reception/members/new');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana Torres');
    await userEvent.click(document.querySelector('.mobile-detail-trigger')!);
    expect(screen.getByRole('dialog', { name: 'Resumen del registro' })).toBeVisible();
    expect(screen.getByText('Ana Torres')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Registro guardado' })).not.toBeInTheDocument();
    await userEvent.click(document.querySelector('.mobile-detail-close')!);
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Torres');
  });
});
