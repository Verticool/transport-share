import { calcRidePrice, DEFAULT_TARIFF } from '@sharing/shared';
import { makeScooter } from '@sharing/shared/testing/factories';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { readMockFile, stubFetchRoutes } from './helpers/mock-files';

/**
 * Поездка проверяется на мок-сервере: он ведёт время, паузы, заряд и решает, можно ли завершить
 * поездку здесь. Интерфейс только показывает состояние, поэтому все правила живут в этих тестах.
 *
 * Часы инъектируются: реальные минуты езды в тесте не нужны, сдвигаем время источника данных.
 */
const MOCK_START = Date.parse('2026-10-13T10:00:00.000Z');
const fast = { minDelayMs: 0, maxDelayMs: 0 };

/** Самокат для сценариев: заряд по умолчанию 80 %, статус «свободен». */
const testScooter = makeScooter({ id: 's-1', code: 'SC-001', batteryPct: 80, lat: 42.8746, lng: 74.5698 });

function setup() {
  const clock = { current: MOCK_START };
  const state = createMockServerState({ now: () => clock.current });
  const client = new MockApiClient({ ...fast, state, userId: 'u-1' });
  return {
    client,
    clock,
    advanceMinutes(minutes: number) {
      clock.current += minutes * 60_000;
    },
  };
}

/** Данные парка, которые «отдаёт сервер»: один самокат с заданными координатами. */
function scootersRoute(lat: number, lng: number): Record<string, string> {
  return {
    '/scooters.json': JSON.stringify([{ ...testScooter, lat, lng }]),
    '/service-zone.json': readMockFile('service-zone.json'),
  };
}

beforeEach(() => {
  stubFetchRoutes(scootersRoute(testScooter.lat, testScooter.lng));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Бронирует самокат и начинает поездку — общее начало большинства сценариев. */
async function startRide(client: MockApiClient) {
  const { booking } = await client.createBooking(testScooter.id);
  return client.startRide(booking.id);
}

describe('поездка на мок-сервере', () => {
  it('начинается из брони: бронь расходуется, самокат переходит в поездку', async () => {
    const { client } = setup();
    const snapshot = await startRide(client);

    expect(snapshot.ride.status).toBe('active');
    expect(snapshot.ride.startedAt).toBe(snapshot.serverTime);
    expect(snapshot.pauses).toEqual([]);
    expect(await client.getActiveBooking()).toBeNull();

    const park = await client.getPark();
    expect(park.scooters[0]?.status).toBe('in_ride');
  });

  it('отдаёт тариф вместе с поездкой: цены интерфейсу не принадлежат', async () => {
    const { client } = setup();
    const snapshot = await startRide(client);

    expect(snapshot.tariff).toEqual(DEFAULT_TARIFF);
  });

  it('не даёт начать поездку без брони', async () => {
    const { client } = setup();

    await expect(client.startRide('bk-нет')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('пауза и продолжение: пауза открывается и закрывается', async () => {
    const { client, advanceMinutes } = setup();
    const { ride } = await startRide(client);

    const paused = await client.pauseRide(ride.id);
    expect(paused.ride.status).toBe('paused');
    expect(paused.pauses).toHaveLength(1);
    expect(paused.pauses[0]?.endedAt).toBeNull();

    advanceMinutes(3);

    const resumed = await client.resumeRide(ride.id);
    expect(resumed.ride.status).toBe('active');
    expect(resumed.pauses[0]?.endedAt).toBe(resumed.serverTime);
  });

  it('не даёт поставить на паузу дважды', async () => {
    const { client } = setup();
    const { ride } = await startRide(client);
    await client.pauseRide(ride.id);

    await expect(client.pauseRide(ride.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('тарифицирует езду и паузу по своим тарифам', async () => {
    const { client, clock, advanceMinutes } = setup();
    const { ride } = await startRide(client);

    advanceMinutes(10);
    await client.pauseRide(ride.id);

    advanceMinutes(5);
    await client.resumeRide(ride.id);

    const snapshot = await client.getActiveRide();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) {
      return;
    }

    const breakdown = calcRidePrice(snapshot.ride, snapshot.pauses, clock.current, DEFAULT_TARIFF);
    expect(breakdown.rideMinutes).toBe(10);
    expect(breakdown.pauseMinutes).toBe(5);
    // 25.00 посадка + 10 мин × 6.00 + 5 мин × 2.00 = 95.00 сом
    expect(breakdown.total).toBe(2500 + 10 * 600 + 5 * 200);
    expect(breakdown.total).toBe(9500);
  });

  it('завершается и возвращает самокат в парк', async () => {
    const { client, advanceMinutes } = setup();
    const { ride } = await startRide(client);
    advanceMinutes(7);

    const finished = await client.finishRide(ride.id);

    expect(finished.ride.status).toBe('finished');
    expect(finished.ride.endReason).toBe('user');
    expect(finished.ride.totalAmount).toBe(2500 + 7 * 600);
    expect(await client.getActiveRide()).toBeNull();

    const park = await client.getPark();
    expect(park.scooters[0]?.status).toBe('free');
  });

  it('не даёт завершить поездку вне зоны обслуживания', async () => {
    const { client } = setup();
    const { ride } = await startRide(client);

    // Самокат «уехал» за пределы зоны: сервер обязан отказать в завершении.
    stubFetchRoutes(scootersRoute(43.5, 74.0));

    await expect(client.finishRide(ride.id)).rejects.toMatchObject({ code: 'outside_zone' });
    expect((await client.getActiveRide())?.ride.status).toBe('active');
  });

  it('не даёт завершить уже завершённую поездку', async () => {
    const { client } = setup();
    const { ride } = await startRide(client);
    await client.finishRide(ride.id);

    await expect(client.finishRide(ride.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('завершает поездку сама, когда кончился заряд, с причиной battery_depleted', async () => {
    const { client, advanceMinutes } = setup();
    await startRide(client);

    // Езда разряжает батарею на 1 % в минуту: 80 % хватает на 80 минут.
    advanceMinutes(81);

    const snapshot = await client.getActiveRide();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) {
      return;
    }

    expect(snapshot.ride.status).toBe('finished');
    expect(snapshot.ride.endReason).toBe('battery_depleted');
    expect(snapshot.ride.totalAmount).toBe(calcRidePrice(
      snapshot.ride,
      snapshot.pauses,
      Date.parse(snapshot.ride.finishedAt ?? snapshot.serverTime),
      DEFAULT_TARIFF,
    ).total);

    const park = await client.getPark();
    expect(park.scooters[0]?.status).toBe('unavailable');
    expect(park.scooters[0]?.batteryPct).toBe(0);
  });
});
