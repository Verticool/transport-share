import { expect, test, type Page } from '@playwright/test';

import { z } from 'zod';

import { SECOND_DEMO, clickMarker, clearAccount, ensureIdle, nav, pickFreeScooter, signIn } from './helpers';

/** Формы ответов сервера, нужные только этому сценарию. */
const SessionSchema = z.object({ token: z.string() });
const RidesPageSchema = z.object({ items: z.array(z.object({ id: z.string() })) });

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

  // Заряд самоката виден прямо в панели поездки: это такая же рабочая цифра, как время и сумма.
  await expect(page.getByTestId('ride-battery')).toContainText('заряд');

  // Пауза — то место, где раньше появлялась ошибка про ненайденного пользователя.
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByTestId('ride-panel')).toContainText('Пауза — время тарифицируется отдельно');
  await expect(page.getByTestId('ride-panel').getByRole('alert')).toHaveCount(0);

  // Продолжаем и завершаем: поездка закрывается, самокат возвращается в парк.
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByTestId('ride-panel')).toContainText('Едем');

  // Разряжаем батарею до порога и проверяем предупреждение с подсказкой замены. Это тот случай,
  // который в жизни требует действий: самокат вот-вот отключится сам, пора брать другой.
  // Разряжаем до порога, но не до нуля: на нуле поездка закрывается сама, и панель исчезает.
  for (let press = 0; press < 12; press += 1) {
    const shown = await page.getByTestId('ride-battery').innerText();
    const percent = Number(/(\d+)/.exec(shown)?.[1] ?? '100');
    if (percent <= 15) {
      break;
    }
    await page.getByTestId('ride-drain').click();
  }
  const warning = page.getByTestId('ride-low-battery');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Пора искать замену');


  await page.getByTestId('ride-panel').getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('ride-panel')).toHaveCount(0);

  // Поездка записана на этого пользователя: он видит её в своей истории, и она уже не «идёт».
  expect(await countRides(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('rides-list').getByText('Идёт')).toHaveCount(0);

  // Письмо со счётом: после завершения поездки оно должно прийти на почту — это требование ТЗ
  // (почта эмулируется, но письмо настоящее: его видно во «Входящих»).
  await nav(page, 'Входящие');
  const inbox = page.getByTestId('inbox-list');
  await expect(inbox).toContainText('Счёт');
  const letters = await inbox.getByRole('listitem').count();

  // Идемпотентность: повторное завершение уже закрытой поездки не проходит, а значит второго
  // счёта и второго письма не появляется.
  const login = await page.request.post('/api/auth/login', { data: SECOND_DEMO });
  const session = SessionSchema.parse(await login.json());
  const auth = { authorization: `Bearer ${session.token}` };
  const ridesPage = RidesPageSchema.parse(await (await page.request.get('/api/rides?limit=1', { headers: auth })).json());
  const lastRideId = ridesPage.items[0]?.id;
  if (lastRideId === undefined) {
    throw new Error('в истории нет ни одной поездки');
  }
  const response = await page.request.post(`/api/rides/${lastRideId}/finish`, { headers: auth });
  expect([404, 409, 422]).toContain(response.status());
  await page.reload();
  await nav(page, 'Входящие');
  expect(await page.getByTestId('inbox-list').getByRole('listitem').count()).toBe(letters);
});
