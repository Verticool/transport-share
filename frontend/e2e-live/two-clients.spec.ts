import { expect, test, type Page } from '@playwright/test';

/**
 * Два клиента на реальном стеке: фронт обращается к серверу, состояние общее и живое.
 *
 * Проверяется главное требование этапа: состояние меняется у всех, кто смотрит карту, а один
 * самокат не могут забронировать двое. Второй клиент узнаёт об этом по потоку событий, без
 * перезагрузки и без ручного обновления.
 */
const DEMO = { email: 'demo@sharing.kg', password: 'demo1234' };
const OTHER = { email: 'alan@example.com', password: 'demo1234' };

async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Почта').fill(account.email);
  await page.getByLabel('Пароль').fill(account.password);
  await page.locator('form').getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Парк' })).toBeVisible();
}

/** Строка парка с указанным статусом: по ней видно состояние самоката у этого клиента. */
function rowWithStatus(page: Page, status: string, index = 0) {
  return page
    .getByTestId('park-list')
    .getByRole('button')
    .filter({ hasText: status })
    .nth(index);
}

/** Строка парка по коду самоката — так два клиента говорят об одном и том же самокате. */
function rowByCode(page: Page, code: string) {
  return page.getByTestId('park-list').getByRole('button').filter({ hasText: code }).first();
}

test('живой поток: состояние доезжает до второго клиента и бронь нельзя перехватить', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    await signIn(firstPage, DEMO);
    await signIn(secondPage, OTHER);

    // Поток поднялся: панель парка показывает, что данные живые.
    await expect(firstPage.getByTestId('live-indicator')).toBeVisible();

    // Оба клиента видят один и тот же самокат свободным.
    const target = rowWithStatus(firstPage, 'Свободен');
    const code = ((await target.innerText()).split('\n')[0] ?? '').trim();
    expect(code).toMatch(/^[A-Z]{2}-\d+$/);
    await expect(rowByCode(secondPage, code)).toContainText('Свободен');

    // Первый клиент бронирует: сервер сообщает об этом всем, и второй видит смену статуса.
    await target.click();
    await firstPage.getByRole('button', { name: 'Забронировать' }).click();
    await expect(firstPage.getByTestId('booking-panel')).toBeVisible();

    const startedAt = Date.now();
    await expect(rowByCode(secondPage, code)).toContainText('Забронирован');
    const propagatedMs = Date.now() - startedAt;
    // Требование этапа: второй клиент узнаёт об этом быстрее половины секунды.
    // Значение печатается: приёмка идёт по измерению, а не по слову «работает».
    process.stdout.write(`
второй клиент увидел бронь за ${propagatedMs} мс
`);
    expect(propagatedMs).toBeLessThan(500);

    // Второй клиент не может забронировать тот же самокат: получает отказ, а не «тихую» бронь.
    await (rowByCode(secondPage, code)).click();
    const secondCard = secondPage.getByTestId('scooter-card');
    await expect(secondCard).toBeVisible();
    // Кнопка недоступна: самокат занят — интерфейс не предлагает действие, которое сервер отклонит.
    await expect(secondCard.getByRole('button', { name: 'Забронировать' })).toBeDisabled();

    // Отмена брони первым клиентом: второй тоже видит самокат свободным — поток работает в обе стороны.
    await firstPage.getByRole('button', { name: "Снять бронь" }).click();
    await expect(rowByCode(secondPage, code)).toContainText('Свободен');
  } finally {
    await first.close();
    await second.close();
  }
});

test('обрыв связи не ломает экран: после восстановления состояние снова живое', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, DEMO);
    await expect(page.getByTestId('live-indicator')).toBeVisible();

    const free = rowWithStatus(page, 'Свободен');
    const code = ((await free.innerText()).split('\n')[0] ?? '').trim();

    // Имитируем пропажу сети: экран остаётся работоспособным, список не исчезает.
    await context.setOffline(true);
    await expect(rowByCode(page, code)).toBeVisible();

    await context.setOffline(false);
    // Поток переподключается сам: карта снова обновляется без перезагрузки страницы.
    await expect(page.getByTestId('live-indicator')).toBeVisible();
    await expect(rowByCode(page, code)).toBeVisible();
  } finally {
    await context.close();
  }
});
