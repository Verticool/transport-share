import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { INBOX_LINK, OTHER_EMAIL, RIDES_LINK, nav, signIn } from './helpers';

/** Число поездок из подписи «Всего поездок: N». */
async function totalFrom(page: Page): Promise<number> {
  const text = await page.getByText(/Всего поездок: \d+/).innerText();
  return Number(/:\s*(\d+)/.exec(text)?.[1] ?? Number.NaN);
}

/**
 * Два клиента одновременно.
 *
 * На мок-стадии это два независимых браузерных контекста: каждый со своей сессией и своим
 * состоянием «сервера» в памяти вкладки. Полноценная проверка «состояние меняется у всех сразу»
 * требует общего сервера — она на S11 (поток событий поверх WebSocket).
 *
 * Здесь проверяется то, что уже обязано работать без сервера: данные принадлежат аккаунту, а не
 * браузеру. Второй пользователь не видит ни поездок, ни писем первого.
 */
test('два пользователя видят каждый свой кабинет', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();

  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    await signIn(firstPage, 'demo@sharing.kg');
    await signIn(secondPage, OTHER_EMAIL);

    // Письма адресованы владельцу: чужой ящик не показывается.
    await nav(firstPage, INBOX_LINK);
    await expect(firstPage.getByTestId('inbox-list').getByRole('listitem').first()).toContainText(
      'demo@sharing.kg',
    );

    await nav(secondPage, INBOX_LINK);
    await expect(secondPage.getByTestId('inbox-list').getByRole('listitem').first()).toContainText(
      OTHER_EMAIL,
    );

    // Истории поездок у них разные — это разные аккаунты, а не один общий кэш.
    // Сверяем не «магические» числа, а содержимое: у второго пользователя в его истории видна
    // его незакрытая поездка, у первого её быть не может — значит данные принадлежат аккаунту.
    await nav(firstPage, RIDES_LINK);
    expect(await totalFrom(firstPage)).toBeGreaterThan(0);
    // У открытой поездки причина окончания не проставлена — в списке она помечена «Идёт».
    await expect(firstPage.getByTestId('rides-list').getByText('Идёт')).toHaveCount(0);

    await nav(secondPage, RIDES_LINK);
    expect(await totalFrom(secondPage)).toBeGreaterThan(0);
    await expect(secondPage.getByTestId('rides-list').getByText('Идёт').first()).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test('второй клиент не видит пароль и сессию первого', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'demo@sharing.kg');

    const stored = await page.evaluate(() => window.localStorage.getItem('dvizh:session'));
    expect(stored).not.toBeNull();
    // В хранилище лежит токен и профиль, но не пароль: пароль на сервер уходит и там и остаётся.
    expect(stored).not.toContain('demo1234');
  } finally {
    await context.close();
  }
});
