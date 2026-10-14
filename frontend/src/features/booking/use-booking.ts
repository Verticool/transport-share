import { BOOKING_NOTIFY_MINUTES, toIso, type Booking } from '@sharing/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError, createApiClient, type ApiClient } from '../../lib/api';
import { useSessionStore } from '../../stores/session';

/** Через сколько миллисекунд обновляется отсчёт. Секунда — предел точности, который виден глазу. */
const TICK_MS = 1000;

export interface BookingState {
  /** Активная бронь пользователя, если она есть. */
  booking: Booking | null;
  /** Сколько осталось до автоматического снятия, миллисекунды (не меньше нуля). */
  remainingMs: number;
  /** Пора предупредить пользователя: до снятия осталось не больше BOOKING_NOTIFY_MINUTES. */
  expiresSoon: boolean;
  loading: boolean;
  error: string | null;
  book: (scooterId: string) => Promise<void>;
  cancel: () => Promise<void>;
  /**
   * Укорачивает бронь на минуты.
   *
   * Только для проверки: срок брони — пятнадцать минут, и оповещение «бронь скоро снимется»
   * приходит за три минуты до конца. Ждать этого на стенде бессмысленно.
   */
  shorten: (minutes: number) => Promise<void>;
  /** Перезапросить бронь: нужен после того, как поездка началась и бронь израсходована. */
  refresh: () => void;
}

/** Как часто спрашивать источник, пока бронь с истёкшим сроком ещё не снята. */
const EXPIRE_POLL_MS = 2_000;

export interface UseBookingOptions {
  /** Часы клиента — инъекция для тестов (RULES §F: без Date.now() напрямую). */
  now?: () => number;
  tickMs?: number;
}

/**
 * Активная бронь и обратный отсчёт до её снятия.
 *
 * Отсчёт считается от серверного времени: клиент запоминает, насколько его часы отличаются
 * от часов источника данных при получении брони, и дальше считает остаток по этой разнице.
 * Если считать от локальных часов, переведённые часы системы (или спящий ноутбук) дадут
 * пользователю неверный срок — а снять бронь должен сервер по своему времени.
 */
export function useBooking(client?: ApiClient, options: UseBookingOptions = {}): BookingState {
  const clientRef = useRef<ApiClient>(client ?? createApiClient());
  // Бронь принадлежит пользователю: источник данных определяет владельца по токену, поэтому
  // до входа запрашивать нечего — экран покажет «войдите».
  const token = useSessionStore((state) => state.token);
  // Часы и период тика фиксируются один раз: иначе новые стрелочные функции на каждом рендере
  // заставляли бы пересобираться эффекты и заново поднимать таймер. Ленивая инициализация
  // состояния (не ref) — так эти значения доступны при рендере и остаются неизменными.
  const [clock] = useState(() => ({
    now: options.now ?? (() => Date.now()),
    tickMs: options.tickMs ?? TICK_MS,
  }));
  const { now, tickMs } = clock;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Счётчик запросов: позволяет перезапросить состояние снаружи (например, после старта поездки).
  const [attempt, setAttempt] = useState(0);
  // Подпись последнего принятого снимка: одинаковые ответы не должны менять состояние.
  const snapshotKey = useRef('init');

  const applySnapshot = useCallback(
    (snapshot: { booking: Booking; serverTime: string } | null): void => {
      // Один и тот же снимок не должен менять состояние: иначе опрос раз в секунду давал бы
      // новый объект брони на каждый ответ, а на нём завязаны эффекты (проверено вживую).
      const key =
        snapshot === null
          ? 'none'
          : `${snapshot.booking.id}|${snapshot.booking.status}|${snapshot.booking.expiresAt}`;
      if (snapshotKey.current !== key) {
        snapshotKey.current = key;
        setBooking(snapshot?.booking ?? null);
      }
      if (snapshot !== null) {
        setSkewMs(Date.parse(snapshot.serverTime) - now());
      }
      setNowMs(now());
    },
    [now],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (token === null) {
      applySnapshot(null);
      setLoading(false);
      return;
    }

    try {
      applySnapshot(await clientRef.current.getActiveBooking(token));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Не удалось получить бронь');
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, token]);

  useEffect(() => {
    // Опрос внешнего источника данных: состояние меняет ответ «сервера», а не React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh, attempt]);

  // Тикер нужен только пока бронь жива: без неё отсчитывать нечего.
  useEffect(() => {
    if (booking === null) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(now());
    }, tickMs);
    return () => {
      clearInterval(timer);
    };
  }, [booking, now, tickMs]);

  const remainingMs =
    booking === null ? 0 : Math.max(0, Date.parse(booking.expiresAt) - (nowMs + skewMs));

  // Срок вышел — спрашиваем источник данных, пока он не снимет бронь и не вернёт самокат в парк.
  //
  // Одного запроса мало: снятие делает таймер источника (на сервере — тик раз в 5 секунд), поэтому
  // первый ответ может ещё содержать ту же бронь. Раньше запрос был ровно один: если он приходил
  // до тика сервиса, панель оставалась висеть на нуле, а самокат — заблокированным.
  useEffect(() => {
    if (booking === null || remainingMs > 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, EXPIRE_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [booking, remainingMs, refresh]);

  const book = useCallback(
    async (scooterId: string): Promise<void> => {
      if (token === null) {
        setError('Войдите, чтобы забронировать самокат');
        return;
      }

      setLoading(true);
      try {
        applySnapshot(await clientRef.current.createBooking(scooterId, token));
        setError(null);
      } catch (caught) {
        setError(caught instanceof ApiClientError ? caught.message : 'Не удалось забронировать');
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot, token],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const current = booking;
    if (current === null || token === null) {
      return;
    }
    setLoading(true);
    try {
      await clientRef.current.cancelBooking(current.id, token);
      applySnapshot(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Не удалось снять бронь');
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, booking, token]);

  const shorten = useCallback(
    async (minutes: number): Promise<void> => {
      const current = booking;
      if (current === null || token === null) {
        return;
      }
      setLoading(true);
      try {
        const updated = await clientRef.current.shortenBooking(current.id, minutes, token);
        // Срок изменился — счётчик в панели должен считать от нового срока, а не от прежнего.
        // Время сервера здесь неизвестно — берём часы клиента: панель считает остаток от срока брони.
        applySnapshot({ booking: updated, serverTime: toIso(now() + skewMs) });
        setError(null);
      } catch (caught) {
        setError(caught instanceof ApiClientError ? caught.message : 'Не удалось сократить бронь');
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot, booking, now, skewMs, token],
  );

  // Перезапрос — счётчиком попыток, а не новой функцией: снаружи (карта, панель) на эту функцию
  // подписаны эффекты, и нестабильная ссылка превращала бы любое событие в бесконечный цикл
  // запросов (проверено вживую: 930 запросов за 5 секунд).
  const requestRefresh = useCallback((): void => {
    setAttempt((value) => value + 1);
  }, []);

  return {
    booking,
    remainingMs,
    expiresSoon: remainingMs > 0 && remainingMs <= BOOKING_NOTIFY_MINUTES * 60_000,
    loading,
    error,
    book,
    cancel,
    shorten,
    refresh: requestRefresh,
  };
}
