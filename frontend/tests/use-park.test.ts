import { SERVICE_ZONE } from '@sharing/shared';
import { makeScooter } from '@sharing/shared/testing/factories';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePark } from '../src/features/map/use-park';
import { ApiClientError, type ApiClient } from '../src/lib/api';
import { makeStubClient } from './helpers/stub-client';

const SCOOTERS = [makeScooter({ id: 'a', code: 'DV-001' }), makeScooter({ id: 'b', code: 'DV-002' })];

/** Клиент для тестов: заглушка со всего интерфейса, переопределён только нужный метод. */
function makeClient(getPark: ApiClient['getPark']): ApiClient {
  return makeStubClient({
    getZone: () => Promise.resolve(SERVICE_ZONE),
    getPark,
  });
}

describe('usePark', () => {
  it('сначала сообщает о загрузке, затем отдаёт данные', async () => {
    const client = makeClient(() =>
      Promise.resolve({ scooters: SCOOTERS, serverTime: '2026-10-13T10:00:00.000Z' }),
    );

    const { result } = renderHook(() => usePark(client));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.scooters).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('превращает ошибку клиента в текст для пользователя', async () => {
    const client = makeClient(() =>
      Promise.reject(new ApiClientError('network', 'Не удалось связаться с источником данных')),
    );

    const { result } = renderHook(() => usePark(client));

    await waitFor(() => {
      expect(result.current.error).toBe('Не удалось связаться с источником данных');
    });
    expect(result.current.scooters).toEqual([]);
  });

  it('на неожиданной ошибке остаётся человеческий текст, а не исключение', async () => {
    const client = makeClient(() => Promise.reject(new Error('boom')));

    const { result } = renderHook(() => usePark(client));

    await waitFor(() => {
      expect(result.current.error).toBe('Не удалось загрузить самокаты');
    });
  });

  it('повторный запрос по reload возвращает данные после сбоя', async () => {
    const getPark = vi
      .fn<ApiClient['getPark']>()
      .mockRejectedValueOnce(new ApiClientError('network', 'Нет связи'))
      .mockResolvedValueOnce({ scooters: SCOOTERS, serverTime: '2026-10-13T10:00:00.000Z' });

    const { result } = renderHook(() => usePark(makeClient(getPark)));

    await waitFor(() => {
      expect(result.current.error).toBe('Нет связи');
    });

    result.current.reload();

    await waitFor(() => {
      expect(result.current.scooters).toHaveLength(2);
    });
    expect(result.current.error).toBeNull();
    expect(getPark).toHaveBeenCalledTimes(2);
  });
});
