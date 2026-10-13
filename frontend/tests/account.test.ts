import { DEFAULT_TARIFF, EmailMessageSchema, InvoiceSchema, RideSchema } from '@sharing/shared';
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
  const client = new MockApiClient({ ...fast, state });
  return { client, clock, state };
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

  it('токен работает и после перезагрузки страницы', async () => {
    const { client } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);

    // Перезагрузка страницы для источника данных — это новый процесс: карта выданных токенов пуста,
    // а сессия берётся из хранилища. Токен должен проверяться сам по себе.
    const afterReload = new MockApiClient({ ...fast, state: createMockServerState() });

    await expect(afterReload.getMe(token)).resolves.toMatchObject({ email: DEMO_EMAIL });
  });

  it('погашенный при выходе токен не работает и после перезагрузки', async () => {
    const { client, state } = setup();
    const { token } = await client.login(DEMO_EMAIL, DEMO_PASSWORD);
    await client.logout(token);

    const afterReload = new MockApiClient({ ...fast, state });

    await expect(afterReload.getMe(token)).rejects.toMatchObject({ code: 'unauthorized' });
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

    const { booking } = await client.createBooking(free.id, token);
    const { ride } = await client.startRide(booking.id, token);
    await client.finishRide(ride.id, token);

    const after = await client.getRides({ limit: 100, offset: 0 }, token);

    expect(after.total).toBe(before.total + 1);
    expect(after.items[0]?.id).toBe(ride.id);
    expect(after.items[0]?.userId).toBe(before.items[0]?.userId);
  });
});

describe('счета и письма', () => {
  it('в мок-данных на каждую поездку приходится ровно одно письмо, а суммы счетов сходятся', () => {
    const rides = RideSchema.array().parse(JSON.parse(readMockFile('rides.json')));
    const invoices = InvoiceSchema.array().parse(JSON.parse(readMockFile('invoices.json')));
    const emails = EmailMessageSchema.array().parse(JSON.parse(readMockFile('emails.json')));

    const rideIds = new Set(rides.map((ride) => ride.id));

    // Счёт: разбор обязан сходиться с итогом, а поездка — существовать.
    for (const invoice of invoices) {
      expect(rideIds.has(invoice.rideId)).toBe(true);
      expect(invoice.breakdown.total).toBe(invoice.amount);
      expect(invoice.breakdown.unlockFee + invoice.breakdown.rideAmount + invoice.breakdown.pauseAmount).toBe(
        invoice.amount,
      );
    }

    // Письмо: одно на поездку, ссылается на свою поездку тем же ключом, что и счёт.
    const keys = emails.map((email) => email.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const email of emails) {
      expect(email.dedupeKey.startsWith('invoice:')).toBe(true);
      expect(rideIds.has(email.dedupeKey.slice('invoice:'.length))).toBe(true);
    }

    // Счёт есть у каждой завершённой поездки: иначе пользователь не увидел бы, за что заплатил.
    const finished = rides.filter((ride) => ride.finishedAt !== null);
    expect(emails.length).toBe(finished.length);
  });

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

    const { booking } = await client.createBooking(free.id, token);
    const { ride } = await client.startRide(booking.id, token);
    await client.finishRide(ride.id, token);

    const emailsAfter = await client.getEmails(token);
    const fresh = emailsAfter.filter(
      (email) => !emailsBefore.some((before) => before.dedupeKey === email.dedupeKey),
    );

    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.dedupeKey).toBe(`invoice:${ride.id}`);
    // Письмо называет самокат так, как его видит пользователь, а не внутренним идентификатором.
    expect(fresh[0]?.subject).toBe(`Счёт за поездку ${free.code}`);
    expect(fresh[0]?.toEmail).toBe(DEMO_EMAIL);

    const invoices = await client.getInvoices(token);
    expect(invoices.some((invoice) => invoice.rideId === ride.id)).toBe(true);
  });
});
