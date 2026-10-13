import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScooterSchema, ServiceZoneSchema } from '@sharing/shared';

import { ApiClientError } from '../src/lib/api/types';
import { MockApiClient } from '../src/lib/api/mock-client';
import { readMockFile, stubFetch } from './helpers/mock-files';

/**
 * Тесты клиента данных проверяют две вещи сразу: что отдаёт наша статика (файл читается как есть)
 * и как клиент ведёт себя при сбоях — обрыв сети, 404, ответ, не проходящий схему.
 * Работа с файлами моков и подмена сети — в `helpers/mock-files.ts`, общем для тестов данных.
 */
const fast = { minDelayMs: 0, maxDelayMs: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MockApiClient', () => {
  it('возвращает 40 самокатов и серверное время в UTC', async () => {
    stubFetch(readMockFile('scooters.json'));
    const snapshot = await new MockApiClient(fast).getPark();

    expect(snapshot.scooters).toHaveLength(40);
    expect(snapshot.serverTime.endsWith('Z')).toBe(true);
    expect(Number.isNaN(Date.parse(snapshot.serverTime))).toBe(false);
  });

  it('запрашивает данные относительным путём — одинаково в dev и в сборке', async () => {
    stubFetch(readMockFile('scooters.json'));
    await new MockApiClient(fast).getPark();

    expect(fetch).toHaveBeenCalledWith('/scooters.json');
  });

  it('каждый самокат из ответа проходит схему домена', async () => {
    stubFetch(readMockFile('scooters.json'));
    const snapshot = await new MockApiClient(fast).getPark();

    for (const scooter of snapshot.scooters) {
      expect(ScooterSchema.safeParse(scooter).success).toBe(true);
    }
  });

  it('сортирует самокаты по коду: порядок не зависит от порядка в файле', async () => {
    stubFetch(readMockFile('scooters.json'));
    const snapshot = await new MockApiClient(fast).getPark();

    const codes = snapshot.scooters.map((scooter) => scooter.code);
    expect(codes).toEqual([...codes].sort((left, right) => left.localeCompare(right, 'en')));
  });

  it('отдаёт зону обслуживания из 8 точек и проверяет её схемой', async () => {
    stubFetch(readMockFile('service-zone.json'));
    const zone = await new MockApiClient(fast).getZone();

    expect(zone.polygon).toHaveLength(8);
    expect(ServiceZoneSchema.safeParse(zone).success).toBe(true);
  });

  it('превращает ответ 404 в ошибку сети с кодом network', async () => {
    stubFetch('Не найдено', 404);

    await expect(new MockApiClient(fast).getPark()).rejects.toMatchObject({ code: 'network' });
  });

  it('превращает обрыв сети в ошибку с кодом network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(new MockApiClient(fast).getPark()).rejects.toMatchObject({ code: 'network' });
  });

  it('отклоняет ответ, не проходящий схему, с кодом invalid_payload', async () => {
    stubFetch('[{"id":"не-самокат"}]');

    const client = new MockApiClient(fast);
    await expect(client.getPark()).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.getPark()).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('соблюдает задержку, чтобы интерфейс проверялся с состоянием загрузки', async () => {
    stubFetch(readMockFile('scooters.json'));
    const start = performance.now();
    await new MockApiClient({ minDelayMs: 30, maxDelayMs: 30 }).getPark();

    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
  });
});
