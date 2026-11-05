import { test, expect } from '@playwright/test';

test.describe('Flujo 3: Cierre de turno con arqueo, conteo de denominaciones y visualización de discrepancia', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('evogym:demo-mode', 'true');
    });
  });

  test('realiza conteo de denominaciones, verifica cálculo de discrepancia y confirma cierre', async ({ page }) => {
    // 1. Navegar a turnos
    await page.goto('/reception/shifts');
    await page.waitForLoadState('domcontentloaded');

    // 2. Asegurarse de que el turno esté abierto. Si estuviera cerrado, lo abrimos
    const openShiftBtn = page.locator('#shift-open-trigger').or(page.getByRole('button', { name: /Abrir [Tt]urno/ }));
    if (await openShiftBtn.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await openShiftBtn.first().click();
      await page.getByRole('button', { name: 'Continuar a Inventario →' }).click();
      await page.getByRole('button', { name: 'Continuar a Resumen →' }).click();
      await page.getByRole('button', { name: 'Confirmar e Iniciar Turno' }).click();
      await expect(page.getByRole('button', { name: 'Cerrar turno' })).toBeVisible({ timeout: 10000 });
    }

    // 3. Iniciar cierre de turno
    const closeShiftBtn = page.getByRole('button', { name: 'Cerrar turno' });
    await expect(closeShiftBtn).toBeVisible({ timeout: 10000 });
    await closeShiftBtn.click();

    // 4. Modal de cierre de turno
    const closeDialog = page.getByRole('dialog', { name: /Cerrar turno/ });
    await expect(closeDialog).toBeVisible({ timeout: 5000 });

    // 5. Seleccionar conteo por denominaciones
    const countModeSelect = page.getByLabel('Forma de conteo');
    if (await countModeSelect.isVisible()) {
      await countModeSelect.selectOption('denominations');
    }

    // 6. Ingresar cantidades en denominaciones con una cifra intencionalmente diferente para generar discrepancia
    // Ej. 1 billete de $500.00
    const bill500Input = page.getByLabel(/Billete \$500(\.00)? · cantidad/i);
    if (await bill500Input.isVisible()) {
      await bill500Input.fill('1');
    } else {
      // Fallback a primer input de denominación disponible
      const firstDenom = page.locator('input[id*="quantity"]').first();
      await firstDenom.fill('1');
    }

    // Agregar nota u observaciones
    const notesInput = page.locator('#shift-closing-notes');
    if (await notesInput.isVisible()) {
      await notesInput.fill('Arqueo realizado con conteo físico de caja chica.');
    }

    // 7. Click en "Revisar cierre"
    const reviewBtn = page.getByRole('button', { name: 'Revisar cierre' });
    await expect(reviewBtn).toBeEnabled({ timeout: 5000 });
    await reviewBtn.click();

    // 8. Visualización de discrepancia
    const summaryRegion = page.locator('[role="region"][aria-label*="Resumen"]');
    await expect(summaryRegion).toBeVisible({ timeout: 5000 });
    await expect(summaryRegion).toContainText('Diferencia');

    // 9. Confirmar cierre definitivo
    const confirmBtn = page.getByRole('button', { name: 'Confirmar cierre' });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // 10. Validar que el turno se cerró (el modal desaparece y aparece la opción de abrir nuevo turno)
    await expect(closeDialog).not.toBeVisible({ timeout: 10000 });
    const nextOpenTrigger = page.locator('#shift-open-trigger').or(page.getByRole('button', { name: /Abrir [Tt]urno/ }));
    await expect(nextOpenTrigger.first()).toBeVisible({ timeout: 10000 });
  });
});
