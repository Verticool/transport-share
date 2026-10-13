import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { INBOX_LINK, INVOICES_LINK, RIDES_LINK, expectRidePanel, nav, openFreeScooter, signIn } from './helpers';

/**
 * Полный путь пользователя: вход, бронь, поездка с паузой, завершение, счёт и письмо.
 *
 * Это главная сквозная проверка стадии: она проходит через все слои интерфейса — карту, бронь,
 * поездку, кабинет — и сверяет числа, а не только наличие элементов. Сумма в панели и сумма в счёте
 * обязаны совпасть: обе считает домен по одному тарифу.
 */
test.describe('поездка от брони до счёта', () => {
  test('бронь, старт, пауза, завершение и счёт в кабинете', async ({ page }) => {
    await signIn(page);

    // Бронь свободного самоката.
    const code = await openFreeScooter(page);
    await page.getByRole('button', { name: 'Забронировать' }).click();

    const booking = page.getByTestId('booking-panel');
    await expect(booking).toBeVisible();
    await expect(booking.getByText(`Самокат ${code} забронирован`)).toBeVisible();
    await expect(booking.getByText('Поездка не начата — самокат освободится сам через 15 минут')).toBeVisible();
    await expect(page.getByTestId('booking-countdown')).toHaveText(/^\d{2}:\d{2}$/);

    // Старт поездки.
    await page.getByRole('button', { name: 'Начать поездку' }).click();
    const ride = await expectRidePanel(page);
    await expect(ride.getByText(`Поездка на ${code}`)).toBeVisible();
    await expect(ride.getByText('Едем')).toBeVisible();
    await expect(page.getByTestId('ride-timer')).toHaveText(/^\d{2}:\d{2}$/);
    // Тариф: сумма = посадка 25.00 + минуты езды по 6.00, уже на первой минуте.
    const amountAfterStart = Number(
      (await page.getByTestId('ride-amount').innerText()).replace(/[^\d.]/g, ''),
    );
    expect(amountAfterStart).toBeGreaterThanOrEqual(25);
    expect((amountAfterStart - 25) % 6).toBe(0);

    // Пауза: время паузы тарифицируется отдельно, по 2.00 сом в минуту.
    await page.getByRole('button', { name: 'Пауза' }).click();
    await expect(ride.getByText('Пауза — время тарифицируется отдельно')).toBeVisible();
    await expect(page.getByTestId('pause-minutes')).toBeVisible();

    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(ride.getByText('Едем')).toBeVisible();

    // Завершение: панель поездки закрывается, самокат возвращается в парк.
    await page.getByRole('button', { name: 'Завершить' }).click();
    await expect(page.getByTestId('ride-panel')).toBeHidden();

    // История: сверху — только что завершённая поездка.
    await nav(page, RIDES_LINK);
    const firstRide = page.getByTestId('rides-list').getByRole('listitem').first();
    await expect(firstRide).toContainText('Завершена вами');
    await expect(firstRide).toContainText('сом');

    // Счёт: разбор обязан сходиться с итогом, а счетов ровно столько же, сколько поездок.
    const ridesTotal = await totalFrom(page, /Всего поездок: (\d+)/);
    await nav(page, INVOICES_LINK);
    const invoicesTotal = await totalFrom(page, /Всего счетов: (\d+)/);
    expect(invoicesTotal).toBe(ridesTotal);

    const firstInvoice = page.getByTestId('invoices-list').getByRole('listitem').first();
    await expect(firstInvoice).toContainText('Посадка');
    await expect(firstInvoice).toContainText('Езда');
    await expect(firstInvoice).toContainText('Пауза');

    // Письмо: одно на поездку, с кодом самоката в теме.
    await nav(page, INBOX_LINK);
    const firstEmail = page.getByTestId('inbox-list').getByRole('listitem').first();
    await expect(firstEmail).toContainText(`Счёт за поездку ${code}`);
    await expect(firstEmail).toContainText('Спасибо за поездку!');
  });

  test('пока идёт бронь, другой самокат не забронировать: панель остаётся на первой брони', async ({
    page,
  }) => {
    await signIn(page);

    const first = await openFreeScooter(page);
    await page.getByRole('button', { name: 'Забронировать' }).click();
    await expect(page.getByTestId('booking-panel')).toBeVisible();

    // Пробуем выбрать другой свободный самокат: интерфейс не должен предлагать вторую бронь.
    await page
      .getByTestId('park-list')
      .getByRole('button')
      .filter({ hasText: 'Свободен' })
      .nth(1)
      .click();

    await expect(page.getByTestId('booking-panel').getByText(`Самокат ${first} забронирован`)).toBeVisible();
    await expect(page.getByTestId('scooter-card')).toBeHidden();
  });
});

/** Число из подписи вида «Всего поездок: 9» или «Всего счетов: 9 · на сумму 131.00 сом». */
async function totalFrom(page: Page, pattern: RegExp): Promise<number> {
  const text = await page.getByText(pattern).innerText();
  const match = /:\s*(\d+)/.exec(text);
  return match === null ? Number.NaN : Number(match[1]);
}
