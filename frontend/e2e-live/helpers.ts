import { expect, type Page } from '@playwright/test';
import { z } from 'zod';

/** Формы ответов, которые нужны для приведения аккаунта в спокойное состояние. */
const SessionSchema = z.object({ token: z.string() });
const ActiveBookingSchema = z.object({ booking: z.object({ id: z.string() }).nullable() });
const ActiveRideSchema = z.object({ ride: z.object({ id: z.string() }).nullable() });

/**
 * Общие шаги сквозных проверок на живом стеке.
 *
 * Прогон против собранных контейнеров идёт по «живой» базе, где у пользователя может остаться
 * бронь или незакрытая поездка от прошлого раза. Поэтому каждый сценарий начинается с приведения
 * аккаунта в спокойное состояние — тогда проверки не зависят от того, в каком порядке они шли.
 */
export const DEMO = { email: 'demo@sharing.kg', password: 'demo1234' };
export const SECOND_DEMO = { email: 'demo2@sharing.kg', password: 'demo1234' };

/** Переход по разделу в шапке: «Входящие», «Счета», «Поездки». */
export async function nav(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label }).click();
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

export async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Почта').fill(account.email);
  await page.getByLabel('Пароль').fill(account.password);
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Парк' })).toBeVisible();
}

/**
 * Освобождает аккаунт через API: снимает активную бронь и закрывает незакрытую поездку.
 *
 * Нужно для прогона против живой базы: предыдущий сценарий мог оставить бронь или поездку, и
 * тогда проверка начиналась бы не с того состояния. Через интерфейс это сделать не всегда можно
 * (поездку вне зоны сначала нужно вернуть в зону), поэтому сначала приводим данные в порядок.
 */
export async function clearAccount(page: Page, account: { email: string; password: string }): Promise<void> {
  const login = await page.request.post('/api/auth/login', {
    data: { email: account.email, password: account.password },
  });
  if (!login.ok()) {
    return;
  }
  const session = SessionSchema.safeParse(await login.json());
  if (!session.success) {
    return;
  }
  const auth = { authorization: `Bearer ${session.data.token}` };

  const bookingResponse = await page.request.get('/api/bookings/active', { headers: auth });
  const booking = ActiveBookingSchema.safeParse(await bookingResponse.json());
  if (booking.success && booking.data.booking !== null) {
    await page.request.delete(`/api/bookings/${booking.data.booking.id}`, { headers: auth });
  }

  const rideResponse = await page.request.get('/api/rides/active', { headers: auth });
  const ride = ActiveRideSchema.safeParse(await rideResponse.json());
  if (ride.success && ride.data.ride !== null) {
    // Самокат мог оказаться вне зоны: сначала возвращаем его в зону, иначе завершение отклонится.
    await page.request.post(`/api/rides/${ride.data.ride.id}/push-to-zone`, { headers: auth });
    await page.request.post(`/api/rides/${ride.data.ride.id}/finish`, { headers: auth });
  }
}

/** Освобождает аккаунт: снимает бронь и закрывает незакрытую поездку, если они есть. */
export async function ensureIdle(page: Page): Promise<void> {
  const booking = page.getByTestId('booking-panel');
  if (await booking.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Снять бронь' }).click();
    await expect(booking).toHaveCount(0);
  }

  const ride = page.getByTestId('ride-panel');
  if (await ride.isVisible().catch(() => false)) {
    await ride.getByRole('button', { name: 'Завершить' }).click();
    await expect(ride).toHaveCount(0);
  }
}

/** Строка самоката в списке парка по коду (SC-013): по ней клиенты говорят об одном и том же. */
export function rowByCode(page: Page, code: string) {
  return page.getByTestId('park-list').getByRole('button').filter({ hasText: code }).first();
}

/** Строка парка с указанным статусом — «Свободен», «Забронирован» и так далее. */
export function rowWithStatus(page: Page, status: string, index = 0) {
  return page.getByTestId('park-list').getByRole('button').filter({ hasText: status }).nth(index);
}

/**
 * Выбирает самокат кликом по маркеру на карте.
 *
 * Точка ищется так же, как её находит пользователь: курсор над маркером становится указателем.
 * Координаты не зашиты — иначе проверка ломалась бы при любом изменении вида карты.
 */
export async function clickMarker(page: Page): Promise<void> {
  const viewport = page.locator('.ol-viewport');
  const box = await viewport.boundingBox();
  if (box === null) {
    throw new Error('карта не заняла место на странице');
  }

  const stepX = (box.width - 80) / 16;
  const stepY = (box.height - 80) / 12;
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 16; column += 1) {
      const x = Math.round(box.x + 40 + column * stepX);
      const y = Math.round(box.y + 40 + row * stepY);
      await page.mouse.move(x, y);
      if (await viewport.evaluate((element) => element.style.cursor === 'pointer')) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error('на карте не нашлось ни одного маркера');
}

/** Первый свободный самокат из списка парка — надёжный выбор, когда маркер под курсором занят. */
export async function pickFreeScooter(page: Page): Promise<string> {
  const row = rowWithStatus(page, 'Свободен');
  await row.click();
  const card = page.getByTestId('scooter-card');
  await expect(card).toBeVisible();
  const text = await card.innerText();
  const code = /SC-\d{3}/.exec(text)?.[0];
  if (code === undefined) {
    throw new Error('в карточке нет кода самоката');
  }
  return code;
}
