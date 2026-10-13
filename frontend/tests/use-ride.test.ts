import { DEFAULT_TARIFF, type Ride } from '@sharing/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRide } from '../src/features/ride/use-ride';
import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { readMockFile, stubFetchRoutes } from './helpers/mock-files';
import { signInAsDemo } from './helpers/session';

/**
 * Поездка в интерфейсе: время, минуты, сумма. Часы источника данных инъектируются, поэтому
 * «поездка на 5 минут» в тесте — это сдвиг часов, а не ожидание.
 */
const MOCK_START = Date.parse('2026-10-13T10:00:00.000Z');
const TICK_MS = 20;
const fast = { minDelayMs: 0, maxDelayMs: 0 };

/** Самокат-фикстура: заряд с запасом, координаты в центре города. */
const SCOOTER = {
  id: 's-1',
  code: 'SC-001',
  model: 'Ninebot Max G30',
  status: 'free',
  batteryPct: 80,
  lat: 42.8746,
  lng: 74.5698,
  lastSeenAt: '2026-10-13T09:00:00.000Z',
  createdAt: '2026-09-13T09:00:00.000Z',
  updatedAt: '2026-10-13T09:00:00.000Z',
};

function setup() {
  const clock = { current: MOCK_START };
  const state = createMockServerState({ now: () => clock.current });
  const client = new MockApiClient({ ...fast, state });
  // Сессия в сторе: хук берёт токен оттуда, как в приложении.
  const token = signInAsDemo();
  const hook = renderHook(() => useRide(client, { now: () => clock.current, tickMs: TICK_MS }));

  return {
    ...hook,
    client,
    token,
    async advance(minutes: number) {
      clock.current += minutes * 60_000;
      await act(async () => {
        await new Promise((done) => setTimeout(done, TICK_MS * 2));
      });
    },
  };
}

function routeScooter(lat: number, lng: number): Record<string, string> {
  return {
    '/scooters.json': JSON.stringify([{ ...SCOOTER, lat, lng }]),
    '/service-zone.json': readMockFile('service-zone.json'),
    '/users.json': readMockFile('users.json'),
  };
}

beforeEach(() => {
  stubFetchRoutes(routeScooter(SCOOTER.lat, SCOOTER.lng));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Бронирует самокат и начинает поездку через хук — типовое начало сценария. */
async function beginRide(
  result: { current: ReturnType<typeof useRide> },
  client: MockApiClient,
  token: string,
) {
  const { booking } = await client.createBooking(SCOOTER.id, token);
  await act(async () => {
    await result.current.start(booking.id);
  });
}

describe('useRide', () => {
  it('до начала поездки показывает пустое состояние', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.ride).toBeNull();
    });
    expect(result.current.amount).toBe(0);
    expect(result.current.offline).toBe(false);
  });

  it('начинает поездку и сразу показывает посадку и первую минуту', async () => {
    const { result, client, token } = setup();
    await beginRide(result, client, token);

    expect(result.current.ride?.status).toBe('active');
    // Минута начисляется с первой секунды (в счёте нет дробных минут), поэтому сразу видно
    // плату за посадку и первую минуту езды.
    expect(result.current.amount).toBe(DEFAULT_TARIFF.unlockFee + DEFAULT_TARIFF.ridePerMinute);
    expect(result.current.tariff.currencySymbol).toBe(DEFAULT_TARIFF.currencySymbol);
  });

  it('считает сумму по минутам езды', async () => {
    const { result, client, token, advance } = setup();
    await beginRide(result, client, token);

    await advance(5);

    expect(result.current.rideMinutes).toBe(5);
    expect(result.current.amount).toBe(DEFAULT_TARIFF.unlockFee + 5 * DEFAULT_TARIFF.ridePerMinute);
    expect(result.current.rideMinutes).toBe(5);
  });

  it('тарифицирует паузу по своему тарифу и не считает её ездой', async () => {
    const { result, client, token, advance } = setup();
    await beginRide(result, client, token);
    await advance(4);

    await act(async () => {
      await result.current.pause();
    });
    await advance(3);

    expect(result.current.ride?.status).toBe('paused');
    expect(result.current.rideMinutes).toBe(4);
    expect(result.current.pauseMinutes).toBe(3);
    expect(result.current.amount).toBe(
      DEFAULT_TARIFF.unlockFee +
        4 * DEFAULT_TARIFF.ridePerMinute +
        3 * DEFAULT_TARIFF.pausePerMinute,
    );

    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.ride?.status).toBe('active');
  });

  it('после завершения показывает итоговую сумму', async () => {
    const { result, client, token, advance } = setup();
    await beginRide(result, client, token);
    await advance(7);

    await act(async () => {
      await result.current.finish();
    });

    const finished: Ride | null = result.current.ride;
    expect(finished?.status).toBe('finished');
    expect(finished?.totalAmount).toBe(DEFAULT_TARIFF.unlockFee + 7 * DEFAULT_TARIFF.ridePerMinute);
    expect(result.current.amount).toBe(finished?.totalAmount);
  });

  it('отказывает в завершении вне зоны и объясняет причину', async () => {
    const { result, client, token } = setup();
    await beginRide(result, client, token);

    // Самокат «уехал» за пределы зоны: сервер обязан отказать.
    stubFetchRoutes(routeScooter(43.5, 74.0));

    await act(async () => {
      await result.current.finish();
    });

    expect(result.current.ride?.status).toBe('active');
    expect(result.current.error).toBe('Здесь завершить поездку нельзя — вернитесь в зону обслуживания');
  });

  it('при потере связи поездка продолжается, а состояние помечается как офлайн', async () => {
    const { result, client, token, advance } = setup();
    await beginRide(result, client, token);
    await advance(2);

    const rideIdBefore = result.current.ride?.id;

    // Связь пропала: сетевые операции падают. Проверяем на завершении поездки — оно ходит к данным.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await act(async () => {
      await result.current.finish();
    });

    expect(result.current.offline).toBe(true);
    // Поездка не прервалась и не «завершилась» отказом сети — она всё та же.
    expect(result.current.ride?.id).toBe(rideIdBefore);
    expect(result.current.ride?.status).toBe('active');

    // Счёт продолжает идти по локальным часам от последнего известного состояния.
    await advance(3);
    expect(result.current.rideMinutes).toBe(5);
  });
});
