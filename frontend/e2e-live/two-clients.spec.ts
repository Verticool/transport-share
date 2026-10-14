import { expect, test, type Page } from '@playwright/test';

import { DEMO, SECOND_DEMO, clearAccount, ensureIdle, rowByCode, rowWithStatus, signIn } from './helpers';

/** Код самоката из первой строки подписи строки парка: «SC-013» из «SC-013 Свободен 21 %». */
async function codeOf(row: ReturnType<typeof rowByCode>): Promise<string> {
  const text = await row.innerText();
  const code = /SC-\d{3}/.exec(text)?.[0];
  if (code === undefined) {
    throw new Error(`в строке парка нет кода самоката: ${text}`);
  }
  return code;
}

/** Сколько из двух клиентов получили бронь: ровно один самокат — ровно одна бронь. */
async function bookingsHeld(pages: Page[]): Promise<number> {
  let held = 0;
  for (const page of pages) {
    if (await page.getByTestId('booking-panel').isVisible().catch(() => false)) {
      held += 1;
    }
  }
  return held;
}

/**
 * Два клиента на реальном стеке: фронт обращается к серверу, состояние общее и живое.
 *
 * Проверяется главное требование этапа: состояние меняется у всех, кто смотрит карту, а один
 * самокат не могут забронировать двое. Второй клиент узнаёт об этом по потоку событий, без
 * перезагрузки и без ручного обновления.
 */
test('живой поток: состояние доезжает до второго клиента и бронь нельзя перехватить', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    await clearAccount(firstPage, DEMO);
    await signIn(firstPage, DEMO);
    await ensureIdle(firstPage);
    await clearAccount(secondPage, SECOND_DEMO);
    await signIn(secondPage, SECOND_DEMO);
    await ensureIdle(secondPage);

    // Поток поднялся: панель парка показывает, что данные живые.
    await expect(firstPage.getByTestId('live-indicator')).toBeVisible();

    // Оба клиента видят один и тот же самокат свободным.
    const target = rowWithStatus(firstPage, 'Свободен');
    await expect(target).toBeVisible();
    const code = await codeOf(target);
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
    process.stdout.write(`\nвторой клиент увидел бронь за ${propagatedMs} мс\n`);
    expect(propagatedMs).toBeLessThan(500);

    // Второй клиент не может забронировать тот же самокат: получает отказ, а не «тихую» бронь.
    await rowByCode(secondPage, code).click();
    const secondCard = secondPage.getByTestId('scooter-card');
    await expect(secondCard).toBeVisible();
    // Кнопка недоступна: самокат занят — интерфейс не предлагает действие, которое сервер отклонит.
    await expect(secondCard.getByRole('button', { name: 'Забронировать' })).toBeDisabled();

    // Отмена брони первым клиентом: второй тоже видит самокат свободным — поток работает в обе стороны.
    await firstPage.getByRole('button', { name: 'Снять бронь' }).click();
    await expect(rowByCode(secondPage, code)).toContainText('Свободен');
  } finally {
    await first.close();
    await second.close();
  }
});

test('два клиента бронируют одновременно: один и тот же самокат достаётся ровно одному', async ({
  browser,
}) => {
  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    await clearAccount(firstPage, DEMO);
    await signIn(firstPage, DEMO);
    await ensureIdle(firstPage);
    await clearAccount(secondPage, SECOND_DEMO);
    await signIn(secondPage, SECOND_DEMO);
    await ensureIdle(secondPage);

    // Оба выбирают один и тот же свободный самокат и жмут «Забронировать» одновременно.
    const target = rowWithStatus(firstPage, 'Свободен');
    await expect(target).toBeVisible();
    const code = await codeOf(target);

    await target.click();
    await rowByCode(secondPage, code).click();
    await expect(firstPage.getByTestId('scooter-card')).toBeVisible();
    await expect(secondPage.getByTestId('scooter-card')).toBeVisible();

    // Жмём одновременно. Второй клик может не пройти вовсе: если первый успел занять самокат,
    // у второго кнопка уже недоступна — это тоже правильный исход, и падать из-за него нельзя.
    const clicks = await Promise.all([
      firstPage
        .getByTestId('scooter-card')
        .getByRole('button', { name: 'Забронировать' })
        .click()
        .then(() => true)
        .catch(() => false),
      secondPage
        .getByTestId('scooter-card')
        .getByRole('button', { name: 'Забронировать' })
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false),
    ]);
    expect(clicks.some(Boolean)).toBe(true);

    // Ровно один получает бронь: второй видит самокат занятым, а не «тихую» вторую бронь.
    // Проверяем по состоянию самоката и числу броней, а не по конкретному тексту отказа:
    // интерфейс может показать и подпись «занят», и сообщение сервера — важно, что бронь одна.
    expect(await bookingsHeld([firstPage, secondPage])).toBe(1);
    await expect(rowByCode(secondPage, code)).toContainText('Забронирован');
    const loserCard = secondPage.getByTestId('scooter-card');
    if (await loserCard.isVisible().catch(() => false)) {
      await expect(loserCard.getByRole('button', { name: 'Забронировать' })).toBeDisabled();
    }

    // А разные самокаты бронируются одновременно без конфликта: ограничение про один самокат.
    // Бронь победителя снимаем через API — иначе второй самокат выбирать было бы негде.
    await clearAccount(firstPage, DEMO);
    await clearAccount(secondPage, SECOND_DEMO);
    await firstPage.reload();
    await secondPage.reload();

    const firstFree = rowWithStatus(firstPage, 'Свободен', 0);
    const secondFree = rowWithStatus(secondPage, 'Свободен', 1);
    await expect(firstFree).toBeVisible();
    await expect(secondFree).toBeVisible();
    const firstCode = await codeOf(firstFree);
    const secondCode = await codeOf(secondFree);
    expect(firstCode).not.toBe(secondCode);

    await firstFree.click();
    await secondFree.click();
    // Жмём одновременно. Второй клик может не пройти вовсе: если первый успел занять самокат,
    // у второго кнопка уже недоступна — это тоже правильный исход, и падать из-за него нельзя.
    const bookings = await Promise.all([
      firstPage
        .getByTestId('scooter-card')
        .getByRole('button', { name: 'Забронировать' })
        .click()
        .then(() => true)
        .catch(() => false),
      secondPage
        .getByTestId('scooter-card')
        .getByRole('button', { name: 'Забронировать' })
        .click({ timeout: 3000 })
        .then(() => true)
        .catch(() => false),
    ]);
    expect(bookings.some(Boolean)).toBe(true);

    // Обе брони прошли: разные самокаты друг другу не мешают.
    await expect(firstPage.getByTestId('booking-panel')).toBeVisible();
    await expect(secondPage.getByTestId('booking-panel')).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test('истёкший доступ продлевается сам: пользователя не выбрасывает на вход', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await clearAccount(page, DEMO);
    await signIn(page, DEMO);

    // Так выглядит протухший доступ: страницу не перезагружали, но токен доступа больше не
    // принимается. Токен обновления в сохранённой сессии остаётся — им и продлеваем.
    await page.evaluate(() => {
      const key = 'dvizh:session';
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        throw new Error('сессия не сохранена');
      }
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('сессия сохранена в неожиданной форме');
      }
      window.localStorage.setItem(key, JSON.stringify({ ...parsed, token: 'stale.access.token' }));
    });

    await page.reload();

    // Экран должен ожить сам: клиент получает отказ доступа, продлевает сессию по токену
    // обновления и повторяет запрос. Никакого «войдите заново» здесь быть не должно.
    await expect(page.getByTestId('park-list').getByRole('button').first()).toBeVisible();
    await expect(page.getByText('войдите заново', { exact: false })).toHaveCount(0);

    const stored = await page.evaluate(() => window.localStorage.getItem('dvizh:session'));
    if (stored === null) {
      throw new Error('сессия пропала из хранилища');
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null || !('token' in parsed)) {
      throw new Error('в сохранённой сессии нет токена');
    }
    const token = String(parsed.token);
    // Токен заменён на рабочий: продление прошло и приложение сохранило новую пару.
    expect(token).not.toBe('stale.access.token');
  } finally {
    await context.close();
  }
});

test('обрыв связи не ломает экран: после восстановления состояние снова живое', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await clearAccount(page, DEMO);
    await signIn(page, DEMO);
    await ensureIdle(page);
    await expect(page.getByTestId('live-indicator')).toBeVisible();

    const free = rowWithStatus(page, 'Свободен');
    await expect(free).toBeVisible();
    const code = await codeOf(free);

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
