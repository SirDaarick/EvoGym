import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { getPlanList, resetPlans } from '../../demo/plans';
import { PlanEditor } from './PlanEditor';

async function continueStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Continuar' }));
}

it('uses the existing Stepper and exposes only active step inputs', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const { container } = render(<PlanEditor onClose={vi.fn()} onSave={onSave} />);
  expect(container.querySelector('.stepper')).toBeInTheDocument();
  const services = screen.getByRole('heading', { name: '¿Qué incluye el plan?' });
  expect(services).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Paso 3: Precio y revisión' })).toBeDisabled();
  expect(screen.queryByLabelText('Cantidad del periodo')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Precio MXN')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Guardar plan' })).not.toBeInTheDocument();
  await continueStep(user);
  expect(screen.getByRole('heading', { name: '¿Cuánto dura?' })).toHaveFocus();
  expect(screen.queryByRole('checkbox', { name: 'Gym' })).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

it('validates services and custom duration before advancing and never saves on early Enter', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<PlanEditor onClose={vi.fn()} onSave={onSave} />);
  await user.click(screen.getByRole('checkbox', { name: 'Gym' }));
  await continueStep(user);
  expect(screen.getByText(/Selecciona al menos un servicio/)).toBeVisible();
  expect(screen.getByRole('heading', { name: '¿Qué incluye el plan?' })).toBeVisible();
  await user.click(screen.getByRole('checkbox', { name: 'Box' }));
  await user.keyboard('{Enter}');
  expect(screen.getByRole('heading', { name: '¿Cuánto dura?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Personalizado' }));
  const period = screen.getByLabelText('Cantidad del periodo');
  await user.clear(period);
  await user.type(period, '1.5{Enter}');
  expect(period).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('heading', { name: '¿Cuánto dura?' })).toBeVisible();
  await user.clear(period);
  await user.type(period, '8{Enter}');
  expect(screen.getByRole('heading', { name: 'Precio y revisión' })).toBeVisible();
  expect(onSave).not.toHaveBeenCalled();
});

it('generates editable names and descriptions, retains drafts on back and saves only on final submit', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<PlanEditor onClose={onClose} onSave={onSave} />);
  await user.click(screen.getByRole('checkbox', { name: 'Box' }));
  await continueStep(user);
  await user.click(screen.getByRole('button', { name: 'Anual' }));
  await continueStep(user);
  expect(screen.getByLabelText('Nombre del plan')).toHaveValue('Gym + Box anual');
  expect(screen.getByText('Gym + Box · anual. Fechas efectivas pendientes.', { selector: 'dd' })).toBeVisible();
  await user.clear(screen.getByLabelText('Nombre del plan'));
  await user.type(screen.getByLabelText('Nombre del plan'), 'Plan personal');
  await user.type(screen.getByLabelText('Precio de referencia (100%)'), '750.50');
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('100');
  await user.click(screen.getByText('Descripción y condiciones (opcional)'));
  await user.clear(screen.getByLabelText('Descripción de aplicabilidad'));
  await user.type(screen.getByLabelText('Descripción de aplicabilidad'), 'Mi descripción');
  await user.click(screen.getByRole('button', { name: 'Atrás' }));
  await user.click(screen.getByRole('button', { name: 'Mensual' }));
  await user.click(screen.getByRole('button', { name: 'Atrás' }));
  await user.click(screen.getByRole('checkbox', { name: 'Box' }));
  await continueStep(user);
  await continueStep(user);
  expect(screen.getByLabelText('Nombre del plan')).toHaveValue('Plan personal');
  expect(screen.getByLabelText('Descripción de aplicabilidad')).toHaveValue('Mi descripción');
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('750.50');
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Guardar plan' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Plan personal', applicability: 'Mi descripción', amountMinor: 75050, composition: expect.objectContaining({ services: ['gym'], period: { value: 1, unit: 'month', expiryRule: 'calendar' } }) }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('rejects invalid final price and name and leaves a failed save open', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSave = vi.fn(() => { throw new Error('No se pudo guardar por falta de espacio.'); });
  render(<PlanEditor onClose={onClose} onSave={onSave} />);
  await continueStep(user);
  await continueStep(user);
  await user.clear(screen.getByLabelText('Nombre del plan'));
  await user.type(screen.getByLabelText('Precio de referencia (100%)'), '500');
  await user.clear(screen.getByLabelText('Precio MXN'));
  await user.type(screen.getByLabelText('Precio MXN'), '10.999');
  await user.click(screen.getByRole('button', { name: 'Guardar plan' }));
  expect(screen.getByLabelText('Precio MXN')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Nombre del plan')).toHaveAttribute('aria-invalid', 'true');
  expect(onSave).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Nombre del plan'), 'Gym probado');
  await user.clear(screen.getByLabelText('Precio MXN'));
  await user.type(screen.getByLabelText('Precio MXN'), '500');
  await user.click(screen.getByRole('button', { name: 'Guardar plan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar por falta de espacio.');
  expect(onClose).not.toHaveBeenCalled();
});

it('preserves exact existing names, eight-day periods, expiry rules and conditions through the stepper', async () => {
  const user = userEvent.setup();
  resetPlans();
  const plan = getPlanList().find(item => item.id === 'gym-week')!;
  plan.name = '  Nombre previo  ';
  plan.applicability = 'Descripción previa exacta';
  plan.restriction = 'Requisito anterior';
  plan.composition!.conditions = { eligibility: 'custom', notes: 'Nota previa' };
  const onSave = vi.fn();
  render(<PlanEditor plan={plan} onClose={vi.fn()} onSave={onSave} />);
  expect(screen.queryByLabelText('Condiciones del plan (opcional)')).not.toBeInTheDocument();
  await continueStep(user);
  expect(screen.getByLabelText('Cantidad del periodo')).toHaveValue(8);
  expect(screen.getByLabelText('Unidad del periodo')).toHaveValue('day');
  await continueStep(user);
  expect(screen.getByLabelText('Nombre del plan')).toHaveValue('  Nombre previo  ');
  expect(screen.getByLabelText('Descripción de aplicabilidad')).toBeVisible();
  expect(screen.getByLabelText('Condiciones del plan (opcional)')).toHaveValue('Nota previa');
  expect(screen.getByLabelText('Restricción u observación (opcional)')).toHaveValue('Requisito anterior');
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: plan.name, applicability: plan.applicability, restriction: plan.restriction, amountMinor: plan.amountMinor, composition: plan.composition }));
});

it('keeps unresolved fifteen-day activity explicit across steps and in the saved payload', async () => {
  const user = userEvent.setup();
  resetPlans();
  const plan = getPlanList().find(item => item.id === 'custom-fortnight')!;
  const onSave = vi.fn();
  render(<PlanEditor plan={plan} onClose={vi.fn()} onSave={onSave} />);
  expect(screen.getByLabelText('Actividad pendiente de confirmar')).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Gym' })).not.toBeChecked();
  expect(screen.getByText(/Sin acceso inferido/)).toBeVisible();
  await continueStep(user);
  expect(screen.getByRole('button', { name: '15 días' })).toHaveAttribute('aria-pressed', 'true');
  await continueStep(user);
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('250.00');
  expect(screen.getByText('Pendiente de confirmar; no concede acceso.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ restriction: plan.restriction, composition: plan.composition }));
});

it('contains focus, excludes collapsed controls, closes on Escape and restores the opener', async () => {
  const user = userEvent.setup();
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const onClose = vi.fn();
  const { unmount } = render(<PlanEditor onClose={onClose} onSave={vi.fn()} />);
  const dialog = screen.getByRole('dialog', { name: 'Nuevo plan' });
  const first = within(dialog).getByRole('button', { name: 'Cerrar modal' });
  const last = within(dialog).getByRole('button', { name: 'Continuar' });
  first.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(first).toHaveFocus();
  await continueStep(user);
  const expiry = screen.getByLabelText('Regla de vencimiento');
  expect(expiry.closest('details')).not.toHaveAttribute('open');
  const summary = screen.getByText('Ajustes de vencimiento');
  summary.focus();
  await user.tab();
  expect(expiry).not.toHaveFocus();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
  unmount();
  expect(opener).toHaveFocus();
  expect(document.body.style.overflow).not.toBe('hidden');
  opener.remove();
});

it('links reference price, final price and percentage to charge in both directions', async () => {
  resetPlans();
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<PlanEditor plan={getPlanList().find(plan => plan.id === 'gym-month')} onClose={vi.fn()} onSave={onSave} />);
  await continueStep(user);
  await continueStep(user);
  expect(screen.getByLabelText('Precio de referencia (100%)')).toHaveValue('500.00');
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('100');
  await user.clear(screen.getByLabelText('Precio MXN'));
  await user.type(screen.getByLabelText('Precio MXN'), '400');
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('80');
  await user.clear(screen.getByLabelText('Porcentaje a cobrar'));
  await user.type(screen.getByLabelText('Porcentaje a cobrar'), '90');
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('450.00');
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 45000, referenceAmountMinor: 50000 }));
});

it('keeps an unrounded ratio when the reference changes and derives percentages from final prices', async () => {
  const user = userEvent.setup();
  resetPlans();
  render(<PlanEditor plan={getPlanList().find(plan => plan.id === 'gym-month')} onClose={vi.fn()} onSave={vi.fn()} />);
  await continueStep(user); await continueStep(user);
  const final = screen.getByLabelText('Precio MXN');
  fireEvent.change(final, { target: { value: '375' } });
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('75');
  fireEvent.change(final, { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Precio de referencia (100%)'), { target: { value: '1000' } });
  expect(final).toHaveValue('800.00');
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('80');
});

it('accepts decimal percentage commas, rounds final cents half up and permits percentages above 100', async () => {
  const user = userEvent.setup();
  resetPlans();
  render(<PlanEditor plan={getPlanList().find(plan => plan.id === 'gym-month')} onClose={vi.fn()} onSave={vi.fn()} />);
  await continueStep(user); await continueStep(user);
  const percentage = screen.getByLabelText('Porcentaje a cobrar');
  fireEvent.change(percentage, { target: { value: '12,345' } });
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('61.73');
  fireEvent.change(percentage, { target: { value: '125' } });
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('625.00');
  fireEvent.change(screen.getByLabelText('Precio de referencia (100%)'), { target: { value: '10.01' } });
  fireEvent.change(percentage, { target: { value: '50' } });
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('5.01');
});

it.each([
  ['Precio de referencia (100%)', ''], ['Precio de referencia (100%)', '0'],
  ['Precio de referencia (100%)', '9007199254740992'], ['Porcentaje a cobrar', ''],
  ['Porcentaje a cobrar', '0'], ['Porcentaje a cobrar', '-5'], ['Porcentaje a cobrar', 'NaN'],
  ['Porcentaje a cobrar', 'Infinity'], ['Precio MXN', '9007199254740992'],
  ['Porcentaje a cobrar', '99999999999999999999999999999999'],
])('blocks saving invalid %s drafts without replacing them: %s', async (label, value) => {
  const user = userEvent.setup();
  resetPlans();
  const onSave = vi.fn();
  render(<PlanEditor plan={getPlanList().find(plan => plan.id === 'gym-month')} onClose={vi.fn()} onSave={onSave} />);
  await continueStep(user); await continueStep(user);
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(screen.getByLabelText(label)).toHaveValue(value);
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
});

it.each([{ reference: 99999, recalculated: '333333.00' }, { reference: 100000, recalculated: '333329.67' }])('preserves exact cents through display, navigation and reopening at reference $reference', async ({ reference, recalculated }) => {
  const user = userEvent.setup();
  resetPlans();
  const plan = { ...getPlanList().find(plan => plan.id === 'gym-month')!, amountMinor: 33333, referenceAmountMinor: reference };
  const onSave = vi.fn();
  const view = render(<PlanEditor plan={plan} onClose={vi.fn()} onSave={onSave} />);
  await continueStep(user); await continueStep(user);
  expect(screen.getByLabelText('Porcentaje a cobrar')).toHaveValue('33.333');
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('333.33');
  await user.click(screen.getByRole('button', { name: 'Atrás' })); await continueStep(user);
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 33333, referenceAmountMinor: reference }));
  view.unmount();
  render(<PlanEditor plan={{ ...plan, ...onSave.mock.calls[0][0] }} onClose={vi.fn()} onSave={vi.fn()} />);
  await continueStep(user); await continueStep(user);
  expect(screen.getByLabelText('Precio MXN')).toHaveValue('333.33');
  fireEvent.change(screen.getByLabelText('Precio de referencia (100%)'), { target: { value: '999999' } });
  expect(screen.getByLabelText('Precio MXN')).toHaveValue(recalculated);
});
