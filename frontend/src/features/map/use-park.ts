import type { Scooter } from '@sharing/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError, createApiClient, type ApiClient } from '../../lib/api';

export interface ParkState {
  scooters: Scooter[];
  loading: boolean;
  /** Текст ошибки для интерфейса; null — данные загружены. */
  error: string | null;
  reload: () => void;
}

/**
 * Данные парка для экрана карты.
 *
 * Клиент передаётся параметром (в тестах — подменённый), иначе создаётся один раз на компонент:
 * новый клиент на каждый рендер означал бы новый запрос на каждую перерисовку.
 */
export function usePark(client?: ApiClient): ParkState {
  const clientRef = useRef<ApiClient>(client ?? createApiClient());
  const [attempt, setAttempt] = useState(0);
  const [scooters, setScooters] = useState<Scooter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Перезагрузка — счётчиком попыток, а не отдельной функцией: запрос описан в одном месте,
  // и повторный ответ не сможет обновить уже размонтированный компонент.
  useEffect(() => {
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
  }, [attempt]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { scooters, loading, error, reload };
}
