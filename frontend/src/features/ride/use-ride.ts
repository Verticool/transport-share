import {
  calcRidePrice,
  currentAmount,
  DEFAULT_TARIFF,
  splitRideSegments,
  type Minor,
  type Ride,
  type RidePause,
  type Tariff,
} from '@sharing/shared';
import { useCallback, useEffect, useState } from 'react';

import { ApiClientError, createApiClient, type ApiClient, type RideSnapshot } from '../../lib/api';

/** Как часто обновляется отсчёт и сумма. Секунда — предел, который виден пользователю. */
const TICK_MS = 1000;

/** Как часто пробуем связаться с источником данных, пока связи нет (в тиках отсчёта). */
const RESYNC_EVERY_TICKS = 3;

export interface RideState {
  ride: Ride | null;
  pauses: RidePause[];
  tariff: Tariff;
  /** Сумма на текущий момент, минорные единицы. */
  amount: Minor;
  /** Минуты езды и паузы по текущему времени — то, из чего складывается сумма. */
  rideMinutes: number;
  pauseMinutes: number;
  /** Прошло от старта поездки, секунды (без пауз). */
  elapsedSeconds: number;
  /** Связи с источником данных нет: отсчёт продолжается, но сумма может отставать. */
  offline: boolean;
  /** Последняя ошибка действия (старт, пауза, завершение). */
  error: string | null;
  busy: boolean;
  start: (bookingId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
}

export interface UseRideOptions {
  /** Часы клиента — инъекция для тестов (RULES §F: без `Date.now()` напрямую). */
  now?: () => number;
  tickMs?: number;
}

/**
 * Активная поездка: счётчик времени и суммы.
 *
 * Сумма считается по домену (`calcRidePrice`), а не «своей арифметикой в компоненте»: та же
 * функция считает итоговый счёт, поэтому панель и счёт не могут разойтись. Отсчёт идёт от
 * серверного времени — смещение часов клиента измеряется один раз при получении снапшота.
 *
 * Потеря связи не останавливает поездку: последний снапшот остаётся, сумма продолжает расти
 * локально, а каждые несколько секунд приложение пытается получить актуальное состояние
 * (требование ТЗ: «пропала связь — поездка продолжается, счёт идёт, при возврате состояние
 * актуализируется»).
 */
export function useRide(client?: ApiClient, options: UseRideOptions = {}): RideState {
  const [clientInstance] = useState<ApiClient>(() => client ?? createApiClient());
  const [clock] = useState(() => ({
    now: options.now ?? (() => Date.now()),
    tickMs: options.tickMs ?? TICK_MS,
  }));
  const { now, tickMs } = clock;

  const [ride, setRide] = useState<Ride | null>(null);
  const [pauses, setPauses] = useState<RidePause[]>([]);
  const [tariff, setTariff] = useState<Tariff>(DEFAULT_TARIFF);
  const [skewMs, setSkewMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => now());
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticks, setTicks] = useState(0);

  const applySnapshot = useCallback(
    (snapshot: { ride: Ride; pauses: RidePause[]; tariff: Tariff; serverTime: string } | null): void => {
      setRide(snapshot?.ride ?? null);
      setPauses(snapshot?.pauses ?? []);
      if (snapshot !== null) {
        setTariff(snapshot.tariff);
        setSkewMs(Date.parse(snapshot.serverTime) - now());
      }
      setNowMs(now());
    },
    [now],
  );

  /** Забирает состояние поездки. Ошибка сети не сбрасывает поездку — только помечает связь как потерянную. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const snapshot = await clientInstance.getActiveRide();
      // Поездку закрыл источник данных (заряд, простой) — принимаем это как факт.
      applySnapshot(snapshot);
      setOffline(false);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'network') {
        setOffline(true);
        return;
      }
      setError(caught instanceof ApiClientError ? caught.message : 'Не удалось получить поездку');
    }
  }, [applySnapshot, clientInstance]);

  // Опрос внешнего источника данных из эффекта — это и есть работа с внешней системой:
  // данные приходят по сети, а не из React, поэтому состояние меняет ответ сервера.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Тикер: пока поездка идёт, раз в секунду пересчитываем время и сумму.
  useEffect(() => {
    if (ride === null || ride.status === 'finished') {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(now());
      setTicks((value) => value + 1);
    }, tickMs);
    return () => {
      clearInterval(timer);
    };
  }, [ride, now, tickMs]);

  // Периодическая синхронизация с источником данных: она же восстанавливает связь после обрыва.
  // Без неё приложение не узнало бы, что данные устарели (на S11 это заменит поток событий).
  useEffect(() => {
    if (ticks === 0 || ticks % RESYNC_EVERY_TICKS !== 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [ticks, refresh]);

  const serverNowMs = nowMs + skewMs;
  const rideEndMs = ride?.finishedAt != null ? Date.parse(ride.finishedAt) : serverNowMs;
  const breakdown =
    ride === null ? null : calcRidePrice(ride, pauses, rideEndMs, tariff);
  const amount =
    ride === null || ride.status === 'finished'
      ? (ride?.totalAmount ?? 0)
      : currentAmount(ride, pauses, serverNowMs, tariff);
  const elapsedSeconds =
    ride === null
      ? 0
      : Math.max(
          0,
          Math.round(
            splitRideSegments(ride, pauses, rideEndMs).reduce(
              (sum, segment) => sum + (segment.end - segment.start),
              0,
            ) / 1000,
          ),
        );

  const runAction = useCallback(
    async (task: () => Promise<RideSnapshot | null>, fallbackMessage: string): Promise<void> => {
      setBusy(true);
      try {
        applySnapshot(await task());
        setError(null);
        setOffline(false);
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.code === 'network') {
          setOffline(true);
        }
        setError(caught instanceof ApiClientError ? caught.message : fallbackMessage);
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot],
  );

  const start = useCallback(
    (bookingId: string) =>
      runAction(() => clientInstance.startRide(bookingId), 'Не удалось начать поездку'),
    [runAction, clientInstance],
  );

  const pause = useCallback(() => {
    if (ride === null) {
      return Promise.resolve();
    }
    return runAction(() => clientInstance.pauseRide(ride.id), 'Не удалось поставить паузу');
  }, [runAction, clientInstance, ride]);

  const resume = useCallback(() => {
    if (ride === null) {
      return Promise.resolve();
    }
    return runAction(() => clientInstance.resumeRide(ride.id), 'Не удалось продолжить поездку');
  }, [runAction, clientInstance, ride]);

  const finish = useCallback(() => {
    if (ride === null) {
      return Promise.resolve();
    }
    return runAction(() => clientInstance.finishRide(ride.id), 'Не удалось завершить поездку');
  }, [runAction, clientInstance, ride]);

  return {
    ride,
    pauses,
    tariff,
    amount,
    rideMinutes: breakdown?.rideMinutes ?? 0,
    pauseMinutes: breakdown?.pauseMinutes ?? 0,
    elapsedSeconds,
    offline,
    error,
    busy,
    start,
    pause,
    resume,
    finish,
  };
}
