import { expect, test, type Page } from '@playwright/test';

import { SECOND_DEMO, clickMarker, ensureIdle, pickFreeScooter, signIn, clearAccount } from './helpers';

/** Число поездок из подписи «Всего поездок: N» на странице истории. */
async function countRides(page: Page): Promise<number> {
  await page.getByRole('link', { name: 'Поездки' }).click();
  const text = await page.getByText(/Всего поездок: \d+/).innerText();
  return Number(/:\s*(\d+)/.exec(text)?.[1] ?? Number.NaN);
}

/**
 * Поездка целиком, начатая с карты, на живом стеке.
 *
 * Проверяет два требования сразу: самокат можно выбрать прямо на карте (а не только в списке) и
 * поездку можно вести — начать, поставить на паузу и завершить — под вторым демонстрационным
 * входом. Раньше на этом месте была ошибка «пользователь не найден», а самокат оставался занятым.
 */
test('поездка с карты под вторым демо-входом: бронь, старт, пауза, завершение', async ({ page }) => {
  await clearAccount(page, SECOND_DEMO);
    await signIn(page, SECOND_DEMO);
  await ensureIdle(page);

  // Выбираем самокат на карте: клик по маркеру открывает ту же карточку с бронью.
  await clickMarker(page);
  const card = page.getByTestId('scooter-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/SC-\d{3}/);

  // Если под курсор попался занятый самокат, берём первый свободный из списка — выбор равнозначен.
  if (!(await card.getByRole('button', { name: 'Забронировать' }).isEnabled())) {
    await pickFreeScooter(page);
  }

  await page.getByTestId('scooter-card').getByRole('button', { name: 'Забронировать' }).click();
  await expect(page.getByTestId('booking-panel')).toBeVisible();

  await page.getByRole('button', { name: 'Начать поездку' }).click();
  await expect(page.getByTestId('ride-panel')).toBeVisible();
  await expect(page.getByTestId('ride-panel')).toContainText('Едем');

  // Пауза — то место, где раньше появлялась ошибка про ненайденного пользователя.
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByTestId('ride-panel')).toContainText('Пауза — время тарифицируется отдельно');
  await expect(page.getByTestId('ride-panel').getByRole('alert')).toHaveCount(0);

  // Продолжаем и завершаем: поездка закрывается, самокат возвращается в парк.
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('ride-panel')).toContainText('Едем');

  await page.getByTestId('ride-panel').getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('ride-panel')).toHaveCount(0);

  // Поездка записана на этого пользователя: он видит её в своей истории, и она уже не «идёт».
  expect(await countRides(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('rides-list').getByText('Идёт')).toHaveCount(0);
});
