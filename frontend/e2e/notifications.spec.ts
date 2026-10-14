import { expect, test } from '@playwright/test';



/**
 * Оповещения на экране.
 *
 * Проверяется то, ради чего они делались: постоянные состояния видно с любого экрана полосой под
 * хедером, а события всплывают поверх и не требуют заходить в почту или счета.
 */
test.describe('оповещения на экране', () => {
  test('потеря сети даёт полосу сверху, возвращение — всплывающее оповещение', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByTestId('park-list').getByRole('button').first()).toBeVisible();

    await context.setOffline(true);
    const banner = page.getByTestId('status-banner-network');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Нет доступа к интернету');

    await context.setOffline(false);
    // Полоса снимается, а вместо неё ненадолго всплывает сообщение о восстановлении.
    await expect(page.getByTestId('status-banner-network')).toHaveCount(0);
    const toast = page.getByTestId('toast-network-restored');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Доступ восстановлен');

    // Всплывающее оповещение скрывается само — иначе оно превратилось бы в ещё одну полосу.
    await expect(toast).toHaveCount(0, { timeout: 10_000 });
  });
});
