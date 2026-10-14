import { BOOKING_TTL_MINUTES, ScooterSchema } from '@sharing/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useBooking } from '../src/features/booking/use-booking';
import { createMockServerState, MockApiClient } from '../src/lib/api/mock-client';
import { parseMockFile, readMockFile, stubFetchRoutes } from './helpers/mock-files';
import { OTHER_EMAIL, mockUserByEmail, signInAsDemo, tokenFor } from './helpers/session';

/**
 * Бронь проверяется вместе с мок-сервером и с инъекцией часов: 15 минут в тесте не ждём,
 * а сдвигаем часы. Так проверяются и отсчёт, и предупреждение за 3 минуты, и автоснятие срока.
 */
const MOCK_START = Date.parse('2026-10-13T10:00:00.000Z');
const TICK_MS = 20;

/** Пауза, за которую хук успевает сходить за бронью повторно (опрос идёт раз в 2 секунды). */
const EXPIRE_POLL_WAIT_MS = 2_400;

const scooters = parseMockFile('scooters.json', z.array(ScooterSchema));
const freeScooter = scooters.find((scooter) => scooter.status === 'free');
if (freeScooter === undefined) {
  throw new Error('в мок-данных нужен свободный самокат');
}

function setup() {
  const clock = { current: MOCK_START };
  const state = createMockServerState({ now: () => clock.current });
  const client = new MockApiClient({ state, minDelayMs: 0, maxDelayMs: 0 });
  // Сессия в сторе: хук берёт токен оттуда, как в приложении.
  const token = signInAsDemo();

  const hook = renderHook(() => useBooking(client, { now: () => clock.current, tickMs: TICK_MS }));

  return {
    ...hook,
    client,
    clock,
    token,
    /** Двигает часы источника данных и даёт хуку пересчитать остаток. */
    async advance(minutes: number) {
      clock.current += minutes * 60_000;
      await act(async () => {
        await new Promise((done) => setTimeout(done, TICK_MS * 2));
      });
    },
  };
}

beforeEach(() => {
  stubFetchRoutes({
    '/scooters.json': readMockFile('scooters.json'),
    '/service-zone.json': readMockFile('service-zone.json'),
    '/users.json': readMockFile('users.json'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBooking', () => {
  it('на старте брони нет', async () => {
    const { result } = setup();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.booking).toBeNull();
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.expiresSoon).toBe(false);
  });

  it('бронирует самокат и отсчитывает остаток от серверного времени', async () => {
    const { result, advance } = setup();

    await act(async () => {
      await result.current.book(freeScooter.id);
    });

    expect(result.current.booking?.scooterId).toBe(freeScooter.id);
    expect(result.current.remainingMs).toBe(BOOKING_TTL_MINUTES * 60_000);

    await advance(2);

    // Часы источника данных ушли на 2 минуты вперёд — остаток обязан это учесть.
    expect(result.current.remainingMs).toBe((BOOKING_TTL_MINUTES - 2) * 60_000);
  });

  it('предупреждает, когда до снятия осталось 3 минуты', async () => {
    const { result, advance } = setup();

    await act(async () => {
      await result.current.book(freeScooter.id);
    });
    expect(result.current.expiresSoon).toBe(false);

    await advance(BOOKING_TTL_MINUTES - 3);

    expect(result.current.expiresSoon).toBe(true);
    expect(result.current.remainingMs).toBe(3 * 60_000);
  });

  it('по истечении срока бронь снимается сама в интерфейсе', async () => {
    const { result, advance } = setup();

    await act(async () => {
      await result.current.book(freeScooter.id);
    });

    await advance(BOOKING_TTL_MINUTES + 1);

    await waitFor(() => {
      expect(result.current.booking).toBeNull();
    });
    expect(result.current.remainingMs).toBe(0);
  });

  it('дожидается снятия брони, даже если первый ответ после срока вернул её же', async () => {
    // Так ведёт себя сервер: снятие делает тик раз в несколько секунд, поэтому сразу после выхода
    // срока ответ может ещё содержать бронь. Интерфейс обязан продолжать спрашивать, иначе панель
    // висит на нуле, а самокат остаётся заблокированным.
    const { result, client, advance } = setup();
    await waitFor(() => {
      expect(result.current.booking).toBeNull();
    });

    const scooter = freeScooter;
    await act(async () => {
      await result.current.book(scooter.id);
    });
    await waitFor(() => {
      expect(result.current.booking).not.toBeNull();
    });

    // Ответ после выхода срока ещё содержит бронь — так ведёт себя сервер до своего тика.
    const stuck = result.current.booking;
    if (stuck === null) {
      throw new Error('бронь не создана');
    }
    let stale = 1;
    client.getActiveBooking = async () => {
      if (stale > 0) {
        stale -= 1;
        return { booking: stuck, serverTime: new Date().toISOString() };
      }
      return null;
    };

    await advance(BOOKING_TTL_MINUTES + 1);
    await act(async () => {
      await new Promise((done) => setTimeout(done, EXPIRE_POLL_WAIT_MS));
    });

    await waitFor(() => {
      expect(result.current.booking).toBeNull();
    });
  });

  it('снятая по сроку бронь освобождает самокат на стороне данных', async () => {
    const { client, clock, token } = setup();
    await client.createBooking(freeScooter.id, token);

    clock.current += (BOOKING_TTL_MINUTES + 1) * 60_000;

    expect(await client.getActiveBooking(token)).toBeNull();
    const park = await client.getPark();
    const scooter = park.scooters.find((item) => item.id === freeScooter.id);
    expect(scooter?.status).toBe('free');
  });

  it('показывает отказ, если самокат заняли первым', async () => {
    const state = createMockServerState({ now: () => MOCK_START });
    // Второй пользователь со своим токеном занимает самокат первым.
    const other = new MockApiClient({ state, minDelayMs: 0, maxDelayMs: 0 });
    await other.createBooking(freeScooter.id, tokenFor(mockUserByEmail(OTHER_EMAIL)));

    signInAsDemo();
    const mine = new MockApiClient({ state, minDelayMs: 0, maxDelayMs: 0 });
    const { result } = renderHook(() => useBooking(mine, { now: () => MOCK_START, tickMs: TICK_MS }));

    await act(async () => {
      await result.current.book(freeScooter.id);
    });

    expect(result.current.booking).toBeNull();
    expect(result.current.error).toBe('Этот самокат уже забронирован');
  });

  it('снимает бронь по требованию пользователя', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.book(freeScooter.id);
    });
    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.booking).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
