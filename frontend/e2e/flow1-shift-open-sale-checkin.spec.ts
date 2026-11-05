import { test, expect } from '@playwright/test';

test.describe('Flujo 1: Apertura de turno -> Venta de membresía en efectivo -> Check-in de socio', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('evogym:demo-mode', 'true');
    });
  });

  test('completa apertura con denominaciones, venta de membresía en efectivo y check-in', async ({ page }) => {
    // 1. Navegar a turnos
    await page.goto('/reception/shifts');
    await page.waitForLoadState('domcontentloaded');

    // Esperar a que la vista de turnos cargue y muestre el botón de acción principal (Cerrar o Abrir)
    const shiftActionBtn = page.getByRole('button', { name: /(Cerrar turno|Abrir [Tt]urno)/ }).first();
    await expect(shiftActionBtn).toBeVisible({ timeout: 10000 });

    // Si ya hay un turno abierto en el estado inicial del demo, lo cerramos para probar la apertura desde cero
    const closeShiftBtn = page.getByRole('button', { name: 'Cerrar turno' });
    if (await closeShiftBtn.isVisible()) {
      await closeShiftBtn.click();
      const closeDialog = page.getByRole('dialog', { name: /Cerrar turno/ });
      await expect(closeDialog).toBeVisible({ timeout: 5000 });

      const billInput = page.getByLabel(/Billete \$500(\.00)? · cantidad/i).or(page.locator('input[id*="quantity"]').first());
      await billInput.fill('1');

      const reviewCloseBtn = page.getByRole('button', { name: 'Revisar cierre' });
      await expect(reviewCloseBtn).toBeEnabled({ timeout: 5000 });
      await reviewCloseBtn.click();

      const confirmCloseBtn = page.getByRole('button', { name: 'Confirmar cierre' });
      await expect(confirmCloseBtn).toBeVisible({ timeout: 5000 });
      await confirmCloseBtn.click();

      await expect(closeDialog).not.toBeVisible({ timeout: 10000 });
    }

    // 2. Apertura de turno con desglose de denominaciones
    const openShiftBtn = page.locator('#shift-open-trigger').or(page.getByRole('button', { name: /Abrir [Tt]urno/ }));
    await expect(openShiftBtn.first()).toBeVisible({ timeout: 10000 });
    await openShiftBtn.first().click();

    // Modal de apertura: Paso 1 - Conteo de caja chica
    const openDialog = page.locator('dialog.shift-open-dialog');
    await expect(openDialog).toBeVisible({ timeout: 5000 });

    // Ingresar denominación: 2 billetes de $500.00
    const bill500Input = page.locator('input[id*="quantity-50000"]').or(page.getByLabel(/Billete \$500/));
    if (await bill500Input.isVisible()) {
      await bill500Input.fill('2');
    }

    // Avanzar a inventario
    await page.getByRole('button', { name: 'Continuar a Inventario →' }).click();

    // Paso 2 - Inventario: Continuar a resumen
    await page.getByRole('button', { name: 'Continuar a Resumen →' }).click();

    // Paso 3 - Confirmar e Iniciar Turno
    await page.getByRole('button', { name: 'Confirmar e Iniciar Turno' }).click();

    // Verificar que el turno quedó abierto
    await expect(page.getByRole('button', { name: 'Cerrar turno' })).toBeVisible({ timeout: 10000 });

    // 3. Venta de membresía en efectivo
    await page.goto('/reception/members/demo-001/payment');
    await page.waitForLoadState('domcontentloaded');

    // Seleccionar método efectivo si no está seleccionado
    const methodSelect = page.locator('select#payment-method');
    if (await methodSelect.isVisible()) {
      await methodSelect.selectOption('cash');
    }

    // Revisar y confirmar pago
    await page.getByRole('button', { name: 'Revisar pago' }).click();
    await page.getByRole('button', { name: 'Registrar pago' }).click();

    // Validar mensaje de resultado
    await expect(page.getByRole('status', { name: 'Resultado del pago' })).toContainText('Operación registrada localmente', { timeout: 10000 });

    // 4. Check-in de socio
    await page.getByRole('link', { name: 'Ver socio' }).click();
    await page.waitForLoadState('domcontentloaded');

    const checkInBtn = page.getByRole('button', { name: /Registrar (entrada|salida)/ });
    await expect(checkInBtn).toBeVisible({ timeout: 10000 });
    await checkInBtn.click();

    // Validar confirmación de asistencia
    const feedback = page.locator('[aria-label="Resultado de asistencia"]');
    await expect(feedback).toContainText(/(Entrada registrada|Salida registrada)/, { timeout: 10000 });
  });
});
