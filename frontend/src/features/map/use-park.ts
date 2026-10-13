import type { Scooter } from '@sharing/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiClientError, createApiClient, readApiMode, type ApiClient } from '../../lib/api';
import { useParkStream } from './use-park-stream';

export interface ParkState {
  scooters: Scooter[];
  loading: boolean;
  /** Текст ошибки для интерфейса; null — данные загружены. */
  error: string | null;
  /** Состояние приходит живым потоком с сервера, а не запросом. */
  live: boolean;
  /**
   * Номер события потока: меняется, когда сервер сообщил о брони или поездке.
   * Экраны используют его как сигнал «перезапроси своё состояние», не заводя второй сокет.
   */
  changeTick: number;
  reload: () => void;
}

/**
 * Данные парка для экрана карты.
 *
 * В режиме моков состояние приходит запросом, в режиме сервера — потоком WebSocket: экран не знает
 * разницы, ему нужен список самокатов и признак актуальности. Клиент передаётся параметром
 * (в тестах — подменённый), иначе создаётся один раз на компонент: новый клиент на каждый рендер
 * означал бы новый запрос на каждую перерисовку.
 */
export function usePark(client?: ApiClient): ParkState {
  const clientRef = useRef<ApiClient>(client ?? createApiClient());
  const [attempt, setAttempt] = useState(0);
  const [scooters, setScooters] = useState<Scooter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mode = readApiMode();
  const stream = useParkStream();

  // Перезагрузка — счётчиком попыток, а не отдельной функцией: запрос описан в одном месте,
  // и повторный ответ не сможет обновить уже размонтированный компонент.
  useEffect(() => {
    if (mode === 'http') {
      // Поток сам присылает снапшот и изменения: отдельный запрос только дублировал бы данные.
      return;
    }

    let active = true;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await clientRef.current.getPark();
        if (active) {
          setScooters(snapshot.scooters);
        }
      } catch (caught) {
        if (active) {
          // Текст берём из ошибки клиента: он уже сформулирован для пользователя (docs/BRAND.md).
          setError(
            caught instanceof ApiClientError ? caught.message : 'Не удалось загрузить самокаты',
          );
          setScooters([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt, mode]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return useMemo(() => {
    if (mode === 'http') {
      return {
        scooters: stream.scooters,
        loading: !stream.ready,
        error: null,
        live: stream.connected,
        changeTick: stream.changeTick,
        reload,
      };
    }
    return { scooters, loading, error, live: false, changeTick: 0, reload };
  }, [
    mode,
    stream.scooters,
    stream.ready,
    stream.connected,
    stream.changeTick,
    scooters,
    loading,
    error,
    reload,
  ]);
}
