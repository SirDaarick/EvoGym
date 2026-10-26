import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DemoProvider, useDemo } from '../demo/DemoProvider';

function Location() { return <output aria-label="Ruta actual">{useLocation().pathname}</output>; }
function DemoProbe() {
  const { state, update } = useDemo();
  return <><output aria-label="Socios de prueba">{state.members.length}</output>
    <button onClick={() => update(current => ({ ...current, members: [] }))}>Vaciar prueba</button></>;
}
async function mount(path = '/owner/overview') {
  render(<MemoryRouter initialEntries={[path]}><DemoProvider><App /><Location /><DemoProbe /></DemoProvider></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando pantalla' })).not.toBeInTheDocument(), { timeout: 10000 });
}

describe('application foundation', () => {
  it('preserves provider data and shell controls across lazy route changes', async () => {
    await mount('/owner/overview');
    expect(screen.getByTestId('application-shell')).toHaveClass('app-shell');
    expect(screen.getAllByLabelText('Navegación principal')[0].querySelector('.sidebar-icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Usar tema/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Vaciar prueba' }));
    await userEvent.click(screen.getByRole('link', { name: 'Historial' }));
    expect(await screen.findByRole('heading', { name: 'Historial de movimientos' }, { timeout: 10000 })).toBeVisible();
    expect(screen.getByLabelText('Socios de prueba')).toHaveTextContent('0');
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Abrir asistente Gimi' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer datos' }));
  });
  it('connects profile, cart, keyboard member lookup, measured attendance and denomination close', async () => {
    await mount('/profiles');
    await userEvent.click(screen.getByRole('button', { name: /Mikel/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Seleccionar Agua' }, { timeout: 10000 }));
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar Barra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cobro' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Efectivo' }));
    await userEvent.click(screen.getByRole('button', { name: /Realizar cobro|Registrar cobro/ }));
    expect(screen.getByRole('status', { name: 'Resultado de compra' })).toHaveTextContent('Cobro registrado');
    expect(screen.getByText('Sin productos seleccionados.')).toBeVisible();
    await userEvent.type(screen.getByRole('combobox', { name: 'Búsqueda global de socios' }), 'Alex Morgan');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByRole('heading', { name: 'Alex Morgan' }, { timeout: 10000 })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Entrada registrada.');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));
    expect(screen.getByRole('status', { name: 'Resultado de asistencia' })).toHaveTextContent('Salida registrada.');
    await userEvent.click(screen.getByRole('link', { name: /^Turno/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar turno' }, { timeout: 10000 }));
    await userEvent.selectOptions(screen.getByLabelText('Forma de conteo'), 'denominations');
    for (const value of ['$500.00', '$50.00', '$5.00']) await userEvent.type(screen.getByLabelText(`${value === '$5.00' ? 'Moneda' : 'Billete'} ${value} · cantidad`), '1');
    expect(screen.getByRole('region', { name: 'Resumen del conteo' })).toHaveTextContent('$555.00');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar cierre' }));
    expect(screen.getByRole('region', { name: 'Resumen de revisión' })).toHaveTextContent('$20.00 MXN');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }));
    expect(screen.getByText('Turno cerrado')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Conteo registrado' })).toHaveTextContent('$500.00');
  }, 15000);
  it('clears stale suggestions when resetting demo or switching profile', async () => {
    await mount('/reception/home');
    await userEvent.type(screen.getByRole('combobox', { name: 'Búsqueda global de socios' }), 'Alex');
    expect(screen.getByRole('listbox')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer datos' }));
    expect(screen.getByRole('combobox', { name: 'Búsqueda global de socios' })).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox', { name: 'Búsqueda global de socios' }), 'Alex');
    await userEvent.selectOptions(screen.getByLabelText('Rol de acceso'), 'OWNER');
    expect(screen.getByRole('combobox', { name: 'Búsqueda global de socios' })).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  }, 15000);
  it('offers login at root and allows switching to staff profiles with Admin and Reception grid', async () => {
    await mount('/');
    expect(screen.getByRole('heading', { name: /Iniciar sesi/i })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Modo Kiosco/i }));
    expect(screen.getByRole('heading', { name: 'Elige tu perfil' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Admin/ })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Recepción/ })).toHaveLength(9);
    expect(screen.getByRole('button', { name: /Mikel/ })).toBeVisible();
    expect(screen.queryByLabelText('Rol de acceso')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mikel/ }));
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
    expect(screen.getByRole('link', { name: /Inicio/ })).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Cambiar perfil' }));
    await userEvent.click(screen.getByRole('button', { name: /Admin/ }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.type(screen.getByRole('textbox', { name: /PIN/i }), '1234');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/owner/overview');
  });
  it('labels local data and owner navigation', async () => {
    await mount();
    expect(screen.getByText('Datos locales')).toBeVisible();
    expect(screen.queryByText(/simula vistas|fechas de muestra/i)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Historial/ })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resumen del negocio' })).toBeVisible();
  });
  it('opens new-member registration directly from the global header for the active role', async () => {
    await mount('/reception/home');
    await userEvent.click(screen.getByRole('link', { name: 'Agregar socio' }));
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/members/new');
    expect(await screen.findByRole('heading', { name: 'Nuevo socio' }, { timeout: 10000 })).toBeVisible();
  });
  it('exposes Personal navigation link in Reception view leading to StaffAttendanceView', async () => {
    await mount('/reception/home');
    const personalLink = screen.getByRole('link', { name: 'Personal' });
    expect(personalLink).toBeVisible();
    await userEvent.click(personalLink);
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/staff');
    expect(await screen.findByRole('heading', { name: 'Pase de Lista del Personal' }, { timeout: 10000 })).toBeVisible();
  });
  it('uses neutral operational guidance for local membership payment records', async () => {
    await mount('/owner/members/demo-001/payment');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar pago' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    const status = screen.getByRole('status', { name: 'Resultado del pago' });
    expect(status).toHaveTextContent('Operación registrada localmente. No activa acceso; las fechas efectivas siguen sin definir.');
    expect(status).not.toHaveTextContent(/simulad[oa]/i);
  });
  it('uses neutral operational guidance for local sales records', async () => {
    await mount('/owner/sales');
    await userEvent.click(screen.getByRole('button', { name: 'Revisar venta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));
    const status = screen.getByText('Venta registrada correctamente en el sistema.');
    expect(status).toBeVisible();
  });
  it('keeps compact navigation identifiable and exposes the unaltered brand asset', async () => {
    await mount();
    const sidebar = screen.getByRole('complementary', { name: 'Barra lateral' });
    expect(sidebar).toHaveAttribute('data-expanded', 'false');
    expect(screen.getByRole('img', { name: 'EvoGym' })).toHaveAttribute('src', expect.stringContaining('evogym-logo-128.webp'));
    expect(screen.getByRole('img', { name: 'EvoGym' })).toHaveAttribute('width', '128');
    expect(screen.getByRole('img', { name: 'EvoGym' })).toHaveAttribute('height', '124');
    const overview = screen.getByRole('link', { name: 'Resumen' });
    expect(overview).toHaveAttribute('aria-current', 'page');
    expect(overview).toHaveAttribute('title', 'Resumen');
    expect(overview.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Historial' }).querySelector('svg')).toBeInTheDocument();
  });
  it('opens the mobile navigation drawer from the compact brand control', async () => {
    await mount();
    const opener = document.querySelector<HTMLButtonElement>('.mobile-brand-opener');
    expect(opener).toHaveAttribute('aria-label', 'Abrir navegación');
    await userEvent.click(opener!);
    expect(screen.getByRole('dialog', { name: 'Navegación principal' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar navegación' }));
    expect(screen.queryByRole('dialog', { name: 'Navegación principal' })).not.toBeInTheDocument();
  });
  it('does not reinterpret a gesture inside the detail drawer as the menu swipe', async () => {
    await mount('/reception/home');
    await userEvent.click(document.querySelector('.mobile-detail-trigger')!);
    const detail = screen.getByRole('dialog', { name: 'Compra actual' });
    fireEvent.touchStart(detail, { touches: [{ clientX: 36, clientY: 200 }] });
    fireEvent.touchEnd(detail, { touches: [], changedTouches: [{ clientX: 140, clientY: 202 }] });
    expect(screen.queryByRole('dialog', { name: 'Navegación principal' })).not.toBeInTheDocument();
  });
  it('contains drawer focus, makes the workspace inert, and restores focus on every dismissal', async () => {
    await mount();
    const opener = document.querySelector<HTMLButtonElement>('.mobile-brand-opener')!;
    const workspace = document.querySelector<HTMLElement>('.workspace')!;
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(workspace).toHaveAttribute('inert');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    await userEvent.click(document.querySelector('.mobile-nav-backdrop')!);
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('link', { name: 'Historial' }));
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/owner/history');
    expect(opener).toHaveFocus();
    expect(workspace).not.toHaveAttribute('inert');
  });
  it('resets the mobile drawer when the viewport enters desktop layout', async () => {
    const previousMatchMedia = window.matchMedia;
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const media = { matches: false, media: '(min-width: 721px)', onchange: null, addEventListener: vi.fn((_type: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback; }), removeEventListener: vi.fn() } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => media) });
    await mount();
    const opener = document.querySelector<HTMLButtonElement>('.mobile-brand-opener')!;
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Navegación principal' })).toBeVisible();
    Object.defineProperty(media, 'matches', { value: true });
    listener?.({ matches: true, media: media.media } as MediaQueryListEvent);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Navegación principal' })).not.toBeInTheDocument());
    expect(document.getElementById('main-content')).toHaveFocus();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: previousMatchMedia });
  });
  it('navigates from a member detail through the sidebar without getting stuck', async () => {
    await mount('/owner/members/demo-001');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/owner/members/demo-001');

    await userEvent.click(screen.getByRole('link', { name: 'Inventario' }));

    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/owner/inventory');
    expect(screen.getByRole('link', { name: 'Inventario' })).toHaveAttribute('aria-current', 'page');
  });
  it('expands on pointer or keyboard focus and keeps focus inside visible', async () => {
    await mount();
    const sidebar = screen.getByRole('complementary', { name: 'Barra lateral' });
    await userEvent.hover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await userEvent.unhover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'false');
    await userEvent.click(screen.getByRole('link', { name: 'Resumen' }));
    await userEvent.unhover(sidebar);
    await userEvent.tab();
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Fijar barra lateral' }));
    expect(screen.getByRole('button', { name: 'Liberar barra lateral' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.tab();
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
  });
  it('collapses after pointer clicks while preserving keyboard focus and pinning', async () => {
    const user = userEvent.setup();
    await mount();
    const sidebar = screen.getByRole('complementary', { name: 'Barra lateral' });
    const overview = screen.getByRole('link', { name: 'Resumen' });

    await user.hover(sidebar);
    await user.click(overview);
    await user.unhover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    await user.tab();
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await user.tab();
    expect(sidebar).toHaveAttribute('data-expanded', 'true');

    await user.click(sidebar);
    await user.unhover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    await user.click(overview);
    await user.unhover(sidebar);
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await user.tab({ shift: true });
    expect(sidebar).toHaveAttribute('data-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Fijar barra lateral' }));
    await user.unhover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Liberar barra lateral' }));
    await user.unhover(sidebar);
    expect(sidebar).toHaveAttribute('data-expanded', 'false');
  }, 15000);
  it('switches role, route and visible navigation without claiming authentication', async () => {
    await mount();
    await userEvent.selectOptions(screen.getByLabelText('Rol de acceso'), 'RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
    expect(screen.getByText(/autenticación y los permisos no están implementados/)).toBeVisible();
  });
  it('resets changed sample data and announces the result', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Vaciar prueba' }));
    expect(screen.getByLabelText('Socios de prueba')).toHaveTextContent('0');
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer datos' }));
    expect(screen.getByLabelText('Socios de prueba')).toHaveTextContent('12');
    expect(screen.getByRole('status', { name: 'Resultado local' })).toHaveTextContent('Datos locales restablecidos');
  });
  it('redirects an unavailable reception route to its primary task', async () => {
    await mount('/reception/history');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rol de acceso')).toHaveValue('RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/home');
  });
  it('preserves a shared task when switching role', async () => {
    await mount('/owner/shifts');
    await userEvent.selectOptions(screen.getByLabelText('Rol de acceso'), 'RECEPTION');
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/reception/shifts');
  });
  it('keeps the reception view when opening the component catalog', async () => {
    await mount('/reception/members');
    await userEvent.click(screen.getByRole('link', { name: 'Sistema de componentes' }));
    expect(screen.getByLabelText('Rol de acceso')).toHaveValue('RECEPTION');
    expect(screen.queryByRole('link', { name: /Historial/ })).not.toBeInTheDocument();
  });
  it('renders the shared component catalog', async () => {
    await mount('/components');
    expect(screen.getByRole('heading', { name: 'Componentes compartidos' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Acción pendiente' })).toBeDisabled();
  });
  it('triggers shift close from the global header button when a shift is active', async () => {
    await mount('/reception/home');
    const shiftButton = screen.getByRole('button', { name: 'Cerrar' });
    expect(shiftButton).toBeVisible();
    await userEvent.click(shiftButton);
    expect(screen.getByRole('dialog', { name: /Cerrar turno/ })).toBeInTheDocument();
  });
});


