import { expect, type Locator, type Page } from '@playwright/test';

/** Демонстрационный доступ: на мок-стадии пароль один для всех пользователей. */
export const DEMO_EMAIL = 'demo@sharing.kg';
export const DEMO_PASSWORD = 'demo1234';
export const OTHER_EMAIL = 'alan@example.com';

export const RIDES_LINK = 'Поездки';
export const INVOICES_LINK = 'Счета';
export const INBOX_LINK = 'Входящие';
export const MAP_LINK = 'Карта';

/** Входит в аккаунт и ждёт возврата на карту. */
export async function signIn(page: Page, email: string = DEMO_EMAIL): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Пароль').fill(DEMO_PASSWORD);
  // Кнопка «Войти» есть и в шапке, и в форме: нажимаем именно отправку формы.
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Парк' })).toBeVisible();
}

/** Переход по основной навигации: без перезагрузки, чтобы состояние «сервера» не сбрасывалось. */
export async function nav(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: label }).click();
}

/** Открывает карточку первого свободного самоката и возвращает его код. */
export async function openFreeScooter(page: Page): Promise<string> {
  const row = page.getByTestId('park-list').getByRole('button').filter({ hasText: 'Свободен' }).first();
  const code = (await row.innerText()).split('\n')[0]?.trim() ?? '';
  await row.click();
  await expect(page.getByTestId('scooter-card')).toBeVisible();
  return code;
}

export interface ParkSummary {
  free: number;
  reserved: number;
  inRide: number;
  unavailable: number;
  total: number;
}

/** Читает сводку панели парка: числа рядом со статусами. */
export async function parkSummary(page: Page): Promise<ParkSummary> {
  const rows = page.getByTestId('park-list').getByRole('button');
  // Список подгружается асинхронно: без ожидания счётчик отдал бы ноль.
  await expect(rows.first()).toBeVisible();

  const panel = page.getByRole('complementary', { name: 'Панель парка' });
  const value = async (label: string): Promise<number> => {
    const text = await panel.getByText(label, { exact: true }).first().locator('..').innerText();
    const digits = text.replace(/\D+/g, ' ');
    return Number(digits.trim().split(/\s+/).at(-1));
  };

  return {
    free: await value('Свободен'),
    reserved: await value('Забронирован'),
    inRide: await value('В поездке'),
    unavailable: await value('Недоступен'),
    total: await rows.count(),
  };
}

/** Ждёт, пока в панели появится панель поездки. */
export async function expectRidePanel(page: Page): Promise<Locator> {
  const panel = page.getByTestId('ride-panel');
  await expect(panel).toBeVisible();
  return panel;
}
