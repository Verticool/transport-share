import { BOOKING_TTL_MINUTES, ScooterSchema } from '@sharing/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { ApiClientError } from '../src/lib/api/types';
import { parseMockFile, stubFetchRoutes, readMockFile } from './helpers/mock-files';

/**
 * Бронь проверяется на уровне мок-сервера: именно он отвечает за правила «один самокат — одна бронь»
 * и «бронь без поездки снимается через 15 минут». Интерфейс в это не вмешивается.
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

function makeServer(options: { userId?: string; clock?: ReturnType<typeof makeClock> } = {}) {
  const clock = options.clock ?? makeClock(MOCK_START);
  const state = createMockServerState({ now: clock.now });
  const client = new MockApiClient({
    ...fast,
    state,
    userId: options.userId ?? 'u-1',
    minDelayMs: 0,
    maxDelayMs: 0,
  });
  return { client, clock, state };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Бронь всегда читает парк из файла, поэтому сеть подменяем для каждого теста.
beforeEach(() => {
  stubFetchRoutes({
    '/scooters.json': readMockFile('scooters.json'),
    '/service-zone.json': readMockFile('service-zone.json'),
  });
});

describe('бронь на мок-сервере', () => {
  it('создаёт бронь на 15 минут от серверного времени', async () => {
    const { client } = makeServer();
    const { booking, serverTime } = await client.createBooking(freeScooter.id);

    expect(booking.status).toBe('active');
    expect(booking.scooterId).toBe(freeScooter.id);
    expect(booking.reservedAt).toBe(serverTime);
    expect(Date.parse(booking.expiresAt) - Date.parse(booking.reservedAt)).toBe(
      BOOKING_TTL_MINUTES * 60_000,
    );
  });

  it('показывает забронированный самокат как занятый в парке', async () => {
    const { client } = makeServer();
    await client.createBooking(freeScooter.id);

    stubFetchRoutes({ '/scooters.json': readMockFile('scooters.json') });
    const park = await client.getPark();
    const booked = park.scooters.find((scooter) => scooter.id === freeScooter.id);

    expect(booked?.status).toBe('reserved');
  });

  it('не даёт забронировать один самокат двоим', async () => {
    const clock = makeClock(MOCK_START);
    const state = createMockServerState({ now: clock.now });
    const first = new MockApiClient({ ...fast, state, userId: 'u-1' });
    const second = new MockApiClient({ ...fast, state, userId: 'u-2' });

    await first.createBooking(freeScooter.id);

    await expect(second.createBooking(freeScooter.id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('не даёт одному пользователю две активные брони', async () => {
    const { client } = makeServer();
    const other = scooters.find(
      (scooter) => scooter.status === 'free' && scooter.id !== freeScooter.id,
    );
    if (other === undefined) {
      throw new Error('нужен второй свободный самокат');
    }

    await client.createBooking(freeScooter.id);

    await expect(client.createBooking(other.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('отказывает в брони недоступного самоката', async () => {
    const { client } = makeServer();

    await expect(client.createBooking(busyScooter.id)).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.createBooking(busyScooter.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('сообщает об отсутствующем самокате', async () => {
    const { client } = makeServer();

    await expect(client.createBooking('нет-такого')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('снимает бронь через 15 минут: самокат снова свободен', async () => {
    const { client, clock } = makeServer();
    await client.createBooking(freeScooter.id);

    clock.advanceMinutes(BOOKING_TTL_MINUTES + 1);

    expect(await client.getActiveBooking()).toBeNull();
    stubFetchRoutes({ '/scooters.json': readMockFile('scooters.json') });
    const park = await client.getPark();
    const scooter = park.scooters.find((item) => item.id === freeScooter.id);
    expect(scooter?.status).toBe(freeScooter.status);
  });

  it('снимает бронь по требованию пользователя и освобождает самокат', async () => {
    const { client } = makeServer();
    const { booking } = await client.createBooking(freeScooter.id);

    await client.cancelBooking(booking.id);

    expect(await client.getActiveBooking()).toBeNull();
  });

  it('сообщает, что отменять нечего, если брони нет', async () => {
    const { client } = makeServer();

    await expect(client.cancelBooking('bk-нет')).rejects.toMatchObject({ code: 'not_found' });
  });
});
