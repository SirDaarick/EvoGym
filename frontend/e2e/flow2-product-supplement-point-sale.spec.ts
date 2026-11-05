import { test, expect } from '@playwright/test';

test.describe('Flujo 2: Venta de producto y suplemento con tarjeta y fallback Point terminal', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('evogym:demo-mode', 'true');
    });
  });

  test('agrega producto y porción de suplemento, prueba rechazo en Point terminal y completa cobro', async ({ page }) => {
    // 1. Navegar a inicio de recepción
    await page.goto('/reception/home');
    await page.waitForLoadState('domcontentloaded');

    // 2. Agregar un producto del catálogo (ej. primer producto disponible)
    const productTile = page.locator('button.product-tile-btn').first();
    await expect(productTile).toBeVisible({ timeout: 10000 });
    await productTile.click();

    // 3. Abrir modal de suplementos para porción (scoop)
    const supplementsBtn = page.getByRole('button', { name: 'Suplementos' });
    await expect(supplementsBtn).toBeVisible({ timeout: 10000 });
    await supplementsBtn.click();

    // En el modal de suplementos, agregar un scoop/porción
    const supplementTile = page.locator('.suplementos-modal-card button.product-tile-btn').first();
    await expect(supplementTile).toBeVisible({ timeout: 5000 });
    await supplementTile.click();

    // Cerrar modal de suplementos
    const closeSupplementsBtn = page.getByRole('button', { name: 'Cerrar modal de suplementos' });
    await expect(closeSupplementsBtn).toBeVisible({ timeout: 5000 });
    await closeSupplementsBtn.click();

    // 4. Proceder al cobro en CurrentPurchaseCard (Paso 1 -> Paso 2)
    const proceedBtn = page.getByRole('button', { name: /Proceder al cobro|Revisar cobro/i }).first();
    await expect(proceedBtn).toBeVisible({ timeout: 10000 });
    await proceedBtn.click();

    // 5. Seleccionar método Tarjeta (Point Smart terminal)
    const cardMethodRadio = page.locator('button[role="radio"][aria-label="Tarjeta"]');
    await expect(cardMethodRadio).toBeVisible({ timeout: 5000 });
    await cardMethodRadio.click();

    // Abrir PointPaymentModal
    const payWithCardBtn = page.getByRole('button', { name: /Cobrar con Tarjeta|Realizar cobro/i });
    await expect(payWithCardBtn).toBeVisible({ timeout: 5000 });
    await payWithCardBtn.click();

    // 6. Validar modal de Point Terminal
    const pointModal = page.locator('.point-modal-card').or(page.getByRole('dialog'));
    await expect(pointModal.first()).toBeVisible({ timeout: 5000 });

    // 7. Simular fallo de tarjeta (Rechazo / Sin saldo) para probar fallback
    const rejectBtn = page.getByRole('button', { name: /Sin saldo/i });
    await expect(rejectBtn).toBeVisible({ timeout: 5000 });
    await rejectBtn.click();

    // Validar fase de rechazo en la terminal
    await expect(page.locator('.point-modal-card')).toContainText(/sin saldo|rechazado|declinada/i, { timeout: 5000 });

    // Salir del rechazo para fallback
    const fallbackBtn = page.getByRole('button', { name: /Salir y cambiar método de cobro/i });
    await expect(fallbackBtn).toBeVisible({ timeout: 5000 });
    await fallbackBtn.click();

    // Modal de terminal cerrado, volvemos a la pantalla de cobro con mensaje de fallback
    await expect(pointModal.first()).not.toBeVisible({ timeout: 5000 });

    // 8. Reintentar cobro con tarjeta exitoso (Aprobación)
    await payWithCardBtn.click();
    await expect(pointModal.first()).toBeVisible({ timeout: 5000 });

    const approvePresetBtn = page.getByRole('button', { name: /Saldo suficiente/i });
    await expect(approvePresetBtn).toBeVisible({ timeout: 5000 });
    await approvePresetBtn.click();

    // Finalizar compra con el voucher emitido por la terminal
    const finalizeVoucherBtn = page.getByRole('button', { name: /Finalizar compra con Voucher/i });
    await expect(finalizeVoucherBtn).toBeVisible({ timeout: 5000 });
    await finalizeVoucherBtn.click();

    // Esperar cierre de modal tras aprobación del voucher
    await expect(pointModal.first()).not.toBeVisible({ timeout: 10000 });

    // Validar confirmación de compra completada
    const purchaseStatus = page.locator('[aria-label="Resultado de compra"]').or(page.getByRole('status'));
    await expect(purchaseStatus.first()).toBeVisible({ timeout: 10000 });
  });
});
