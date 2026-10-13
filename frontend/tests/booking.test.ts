import { BOOKING_TTL_MINUTES, ScooterSchema } from '@sharing/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { ApiClientError } from '../src/lib/api/types';
import { parseMockFile, stubFetchRoutes, readMockFile } from './helpers/mock-files';
import { DEMO_EMAIL, OTHER_EMAIL, mockUserByEmail, tokenFor } from './helpers/session';

/**
 * Бронь проверяется на уровне мок-сервера: именно он отвечает за правила «один самокат — одна бронь»
 * и «бронь без поездки снимается через 15 минут». Интерфейс в это не вмешивается.
 *
 * Владельца брони определяет токен — как на сервере. Поэтому здесь у каждого участника свой токен,
 * а не настройка клиента.
 */
const fast = { minDelayMs: 0, maxDelayMs: 0 };
const MOCK_START = Date.parse('2026-10-13T10:00:00.000Z');

const scooters = parseMockFile('scooters.json', z.array(ScooterSchema));
const freeScooter = scooters.find((scooter) => scooter.status === 'free');
const busyScooter = scooters.find((scooter) => scooter.status === 'unavailable');

if (freeScooter === undefined || busyScooter === undefined) {
  throw new Error('в мок-данных нужны свободный и недоступный самокаты');
}

/** Часы мок-сервера: сдвигаются вручную, чтобы 15 минут не ждать в тесте. */
function makeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advanceMinutes(minutes: number) {
      current += minutes * 60_000;
    },
  };
}

function makeServer(options: { clock?: ReturnType<typeof makeClock> } = {}) {
  const clock = options.clock ?? makeClock(MOCK_START);
  const state = createMockServerState({ now: clock.now });
  const client = new MockApiClient({ ...fast, state });
  const token = tokenFor(mockUserByEmail(DEMO_EMAIL));
  const otherToken = tokenFor(mockUserByEmail(OTHER_EMAIL));
  return { client, clock, state, token, otherToken };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Бронь всегда читает парк из файла, поэтому сеть подменяем для каждого теста.
beforeEach(() => {
  stubFetchRoutes({
    '/scooters.json': readMockFile('scooters.json'),
    '/service-zone.json': readMockFile('service-zone.json'),
    '/users.json': readMockFile('users.json'),
  });
});

describe('бронь на мок-сервере', () => {
  it('создаёт бронь на 15 минут от серверного времени', async () => {
    const { client, token } = makeServer();
    const { booking, serverTime } = await client.createBooking(freeScooter.id, token);

    expect(booking.status).toBe('active');
    expect(booking.scooterId).toBe(freeScooter.id);
    expect(booking.reservedAt).toBe(serverTime);
    expect(Date.parse(booking.expiresAt) - Date.parse(booking.reservedAt)).toBe(
      BOOKING_TTL_MINUTES * 60_000,
    );
  });

  it('записывает бронь на владельца токена', async () => {
    const { client, token } = makeServer();
    const { booking } = await client.createBooking(freeScooter.id, token);

    expect(booking.userId).toBe(mockUserByEmail(DEMO_EMAIL).id);
  });

  it('показывает забронированный самокат как занятый в парке', async () => {
    const { client, token } = makeServer();
    await client.createBooking(freeScooter.id, token);

    stubFetchRoutes({ '/scooters.json': readMockFile('scooters.json') });
    const park = await client.getPark();
    const booked = park.scooters.find((scooter) => scooter.id === freeScooter.id);

    expect(booked?.status).toBe('reserved');
  });

  it('не даёт забронировать один самокат двоим', async () => {
    const { client, token, otherToken } = makeServer();

    await client.createBooking(freeScooter.id, token);

    await expect(client.createBooking(freeScooter.id, otherToken)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('не даёт одному пользователю две активные брони', async () => {
    const { client, token } = makeServer();
    const other = scooters.find(
      (scooter) => scooter.status === 'free' && scooter.id !== freeScooter.id,
    );
    if (other === undefined) {
      throw new Error('нужен второй свободный самокат');
    }

    await client.createBooking(freeScooter.id, token);

    await expect(client.createBooking(other.id, token)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('отказывает в брони недоступного самоката', async () => {
    const { client, token } = makeServer();

    await expect(client.createBooking(busyScooter.id, token)).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.createBooking(busyScooter.id, token)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('сообщает об отсутствующем самокате', async () => {
    const { client, token } = makeServer();

    await expect(client.createBooking('нет-такого', token)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('не отдаёт чужую бронь: второй пользователь своей не видит', async () => {
    const { client, token, otherToken } = makeServer();
    await client.createBooking(freeScooter.id, token);

    expect(await client.getActiveBooking(otherToken)).toBeNull();
    expect(await client.getActiveBooking(token)).not.toBeNull();
  });

  it('снимает бронь через 15 минут: самокат снова свободен', async () => {
    const { client, clock, token } = makeServer();
    await client.createBooking(freeScooter.id, token);

    clock.advanceMinutes(BOOKING_TTL_MINUTES + 1);

    expect(await client.getActiveBooking(token)).toBeNull();
    stubFetchRoutes({ '/scooters.json': readMockFile('scooters.json') });
    const park = await client.getPark();
    const scooter = park.scooters.find((item) => item.id === freeScooter.id);
    expect(scooter?.status).toBe(freeScooter.status);
  });

  it('снимает бронь по требованию пользователя и освобождает самокат', async () => {
    const { client, token } = makeServer();
    const { booking } = await client.createBooking(freeScooter.id, token);

    await client.cancelBooking(booking.id, token);

    expect(await client.getActiveBooking(token)).toBeNull();
  });

  it('не даёт снять чужую бронь', async () => {
    const { client, token, otherToken } = makeServer();
    const { booking } = await client.createBooking(freeScooter.id, token);

    await expect(client.cancelBooking(booking.id, otherToken)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('сообщает, что отменять нечего, если брони нет', async () => {
    const { client, token } = makeServer();

    await expect(client.cancelBooking('bk-нет', token)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('требует вход: без токена брони нет', async () => {
    const { client } = makeServer();

    await expect(client.createBooking(freeScooter.id, '')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
