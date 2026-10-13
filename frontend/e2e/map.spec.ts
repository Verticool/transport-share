import { expect, test } from '@playwright/test';

import { parkSummary, openFreeScooter, signIn, RIDES_LINK } from './helpers';

/**
 * Сквозные проверки фронта на мок-данных.
 *
 * Ходим по приложению ссылками и кнопками, а не перезагрузками: на мок-стадии состояние «сервера»
 * живёт в памяти вкладки (см. `docs/evidence/S6/account-acceptance.txt`), поэтому перезагрузка
 * страницы посередине сценария сбросила бы созданные данные. На S11 ограничение снимается, и
 * переходы по URL станут равнозначны.
 */
test.describe('карта парка', () => {
  test('показывает 40 самокатов, зону обслуживания и подпись источника', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Карта самокатов' })).toBeVisible();
    await expect(page.getByText(/\d+ свободны из 40 в зоне обслуживания/)).toBeVisible();
    await expect(page.getByText('Tiles © Esri — Esri, DeLorme, NAVTEQ')).toBeVisible();

    const rows = page.getByTestId('park-list').getByRole('button');
    await expect(rows).toHaveCount(40);
  });

  test('карточка самоката показывает состояние, заряд и расстояние', async ({ page }) => {
    await page.goto('/');

    const code = await openFreeScooter(page);
    const card = page.getByTestId('scooter-card');

    await expect(card).toBeVisible();
    await expect(card.getByText(`Самокат ${code}`)).toBeVisible();
    await expect(card.getByText('Свободен')).toBeVisible();
    await expect(card.getByText(/\d+ %/)).toBeVisible();
    await expect(card.getByText(/\d+([.,]\d+)? (м|км)/)).toBeVisible();
  });

  test('панель парка считает сводку по статусам', async ({ page }) => {
    await page.goto('/');

    const summary = await parkSummary(page);
    expect(summary.total).toBe(40);
    expect(summary.free + summary.reserved + summary.inRide + summary.unavailable).toBe(40);
  });
});

test.describe('вход и защищённые экраны', () => {
  test('без входа кабинет не открывается, после входа — открывается', async ({ page }) => {
    await page.goto('/rides');

    await expect(page.getByRole('heading', { name: 'Вход в Движ' })).toBeVisible();

    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Парк' })).toBeVisible();

    await page.getByRole('link', { name: RIDES_LINK }).click();
    await expect(page.getByRole('heading', { name: 'Поездки' })).toBeVisible();
    await expect(page.getByText(/Всего поездок: \d+/)).toBeVisible();
  });
});
