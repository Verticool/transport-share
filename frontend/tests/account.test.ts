import { DEFAULT_TARIFF } from '@sharing/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { readMockFile, stubFetchRoutes } from './helpers/mock-files';

/**
 * Кабинет на мок-сервере: вход, история поездок с пагинацией, счета и письма.
 *
 * Требование ТЗ «по завершении приходит одно письмо со счётом» проверяется здесь же: письмо
 * выпускается при закрытии поездки и дедуплицируется по ключу.
 */
const MOCK_START = Date.parse('2026-10-13T10:00:00.000Z');
const fast = { minDelayMs: 0, maxDelayMs: 0 };
const DEMO_EMAIL = 'demo@sharing.kg';
const DEMO_PASSWORD = 'demo1234';

function setup() {
  const clock = { current: MOCK_START };
  const state = createMockServerState({ now: () => clock.current });
  const client = new MockApiClient({ ...fast, state, userId: 'anonymous' });
  return { client, clock };
}

beforeEach(() => {
  stubFetchRoutes({
    '/scooters.json': readMockFile('scooters.json'),
    '/service-zone.json': readMockFile('service-zone.json'),
    '/users.json': readMockFile('users.json'),
    '/rides.json': readMockFile('rides.json'),
    '/invoices.json': readMockFile('invoices.json'),
    '/emails.json': readMockFile('emails.json'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('вход в аккаунт', () => {
  it('принимает демонстрационного пользователя и выдаёт токен', async () => {
    const { client } = setup();

    const session = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    expect(session.user.email).toBe(DEMO_EMAIL);
    expect(session.token.startsWith('tk-')).toBe(true);
    expect(await client.getMe(session.token)).toEqual(session.user);
  });

  it('не пускает с неверным паролем', async () => {
    const { client } = setup();

    await expect(client.login(DEMO_EMAIL, 'неверный')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('не подсказывает, какие адреса зарегистрированы', async () => {
    const { client } = setup();

    await expect(client.login('nobody@example.com', DEMO_PASSWORD)).rejects.toMatchObject({
      message: 'Неверная почта или пароль',
    });
  });

  it('после выхода токен перестаёт действовать', async () => {
    const { client } = setup();
    const session = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    await client.logout(session.token);

    await expect(client.getMe(session.token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('без входа кабинет закрыт', async () => {
    const { client } = setup();

    await expect(client.getRides({ limit: 5, offset: 0 }, 'чужой-токен')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});

describe('история поездок', () => {
  it('отдаёт страницу поездок, свежие сверху, и общее число', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    const page = await client.getRides({ limit: 5, offset: 0 }, token);

    expect(page.total).toBeGreaterThan(5);
    expect(page.items).toHaveLength(5);
    expect(page.limit).toBe(5);
    expect(page.offset).toBe(0);

    const starts = page.items.map((ride) => Date.parse(ride.startedAt));
    expect(starts).toEqual([...starts].sort((left, right) => right - left));
  });

  it('вторая страница не повторяет первую', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    const first = await client.getRides({ limit: 5, offset: 0 }, token);
    const second = await client.getRides({ limit: 5, offset: 5 }, token);

    const firstIds = first.items.map((ride) => ride.id);
    const secondIds = second.items.map((ride) => ride.id);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('поездка, совершённая после входа, попадает в историю пользователя', async () => {
    const { client, clock } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);
    const before = await client.getRides({ limit: 100, offset: 0 }, token);

    const park = await client.getPark();
    const free = park.scooters.find((scooter) => scooter.status === 'free');
    expect(free).toBeDefined();
    if (free === undefined) {
      return;
    }

    // Часы источника данных уводим вперёд: в истории есть поездки более поздние, чем старт теста,
    // а свежие показываются сверху — иначе новая поездка не окажется первой.
    clock.current += 30 * 24 * 60 * 60_000;

    const { booking } = await client.createBooking(free.id);
    const { ride } = await client.startRide(booking.id);
    await client.finishRide(ride.id);

    const after = await client.getRides({ limit: 100, offset: 0 }, token);

    expect(after.total).toBe(before.total + 1);
    expect(after.items[0]?.id).toBe(ride.id);
    expect(after.items[0]?.userId).toBe(before.items[0]?.userId);
  });
});

describe('счета и письма', () => {
  it('отдаёт счета пользователя, свежие сверху, с разбором', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    const invoices = await client.getInvoices(token);

    expect(invoices.length).toBeGreaterThan(0);
    const first = invoices[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    expect(first.breakdown.total).toBe(first.amount);
    expect(first.breakdown.rideAmount).toBe(first.breakdown.rideMinutes * DEFAULT_TARIFF.ridePerMinute);

    const issued = invoices.map((invoice) => Date.parse(invoice.issuedAt));
    expect(issued).toEqual([...issued].sort((left, right) => right - left));
  });

  it('отдаёт письма без дублей по одной и той же поездке', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    const emails = await client.getEmails(token);

    expect(emails.length).toBeGreaterThan(0);
    const keys = emails.map((email) => email.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('после завершённой поездки появляется ровно одно новое письмо со счётом', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    const emailsBefore = await client.getEmails(token);

    // Поездка целиком: бронь → старт → завершение.
    const park = await client.getPark();
    const free = park.scooters.find((scooter) => scooter.status === 'free');
    expect(free).toBeDefined();
    if (free === undefined) {
      return;
    }

    const { booking } = await client.createBooking(free.id);
    const { ride } = await client.startRide(booking.id);
    await client.finishRide(ride.id);

    const emailsAfter = await client.getEmails(token);
    const fresh = emailsAfter.filter(
      (email) => !emailsBefore.some((before) => before.dedupeKey === email.dedupeKey),
    );

    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.dedupeKey).toBe(`invoice:${ride.id}`);

    const invoices = await client.getInvoices(token);
    expect(invoices.some((invoice) => invoice.rideId === ride.id)).toBe(true);
  });
});
