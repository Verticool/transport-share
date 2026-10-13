import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpApiClient } from '../src/lib/api/http-client';
import { ApiClientError } from '../src/lib/api/types';

/**
 * Проверки клиента сервера.
 *
 * Разбираются случаи, которые на живом стенде вели себя неверно: снятие брони уходило с типом
 * содержимого без тела (сервер отвечал отказом), а продление сессии не проверялось вовсе.
 */
interface Call {
  url: string;
  init: RequestInit;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function installFetch(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    // Адрес приходит и строкой, и объектом запроса: приводим к строке явно.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) {
      return Promise.reject(new Error('неожиданный запрос: ответ не задан'));
    }
    return Promise.resolve(next());
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP-клиент', () => {
  it('снятие брони уходит без типа содержимого: тело не отправляется, сервер не отклоняет запрос', async () => {
    const calls = installFetch([() => new Response(null, { status: 204 })]);
    const client = new HttpApiClient({ baseUrl: '' });

    await client.cancelBooking('booking-1', 'tk-access');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.init.method).toBe('DELETE');
    expect(call?.init.body).toBeUndefined();
    const headers = new Headers(call?.init.headers);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer tk-access');
  });

  it('создание брони отправляет тело и тип содержимого', async () => {
    const calls = installFetch([
      () =>
        jsonResponse(201, {
          booking: {
            id: '11111111-1111-4111-8111-111111111111',
            userId: '22222222-2222-4222-8222-222222222222',
            scooterId: '33333333-3333-4333-8333-333333333333',
            status: 'active',
            reservedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-01T00:15:00.000Z',
            notifiedAt: null,
            closedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          serverTime: '2026-01-01T00:00:00.000Z',
        }),
    ]);
    const client = new HttpApiClient({ baseUrl: '' });

    await client.createBooking('33333333-3333-4333-8333-333333333333', 'tk-access');

    const [call] = calls;
    const headers = new Headers(call?.init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(call?.init.body).toBe(JSON.stringify({ scooterId: '33333333-3333-4333-8333-333333333333' }));
  });

  it('истёкший доступ продлевается один раз, запрос повторяется с новым токеном', async () => {
    const calls = installFetch([
      () => jsonResponse(401, { code: 'unauthorized', message: 'Токен истёк' }),
      () =>
        jsonResponse(200, {
          user: {
            id: '22222222-2222-4222-8222-222222222222',
            email: 'demo@sharing.kg',
            name: 'Демо',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          token: 'tk-access-2',
          refreshToken: 'rt-2',
          expiresAt: '2026-01-01T00:05:00.000Z',
        }),
      () => new Response(null, { status: 204 }),
    ]);
    const refreshed: string[] = [];
    const client = new HttpApiClient({
      baseUrl: '',
      onTokenRefreshed: (session) => refreshed.push(session.token),
    });
    client.rememberRefreshToken('rt-1');

    await client.cancelBooking('booking-1', 'tk-access-1');

    expect(calls.map((call) => call.url)).toEqual([
      '/api/bookings/booking-1',
      '/api/auth/refresh',
      '/api/bookings/booking-1',
    ]);
    const retry = calls[2];
    const headers = new Headers(retry?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer tk-access-2');
    expect(refreshed).toEqual(['tk-access-2']);
  });

  it('без токена обновления повтор не выполняется: клиент не выдумывает сессию', async () => {
    const calls = installFetch([() => jsonResponse(401, { code: 'unauthorized', message: 'Нет доступа' })]);
    const client = new HttpApiClient({ baseUrl: '' });

    await expect(client.getInvoices('tk-stale')).rejects.toBeInstanceOf(ApiClientError);
    expect(calls).toHaveLength(1);
  });

  it('занятый самокат — конфликт, а не пустая ошибка', async () => {
    installFetch([() => jsonResponse(409, { code: 'conflict', message: 'У вас уже есть активная бронь' })]);
    const client = new HttpApiClient({ baseUrl: '' });

    await expect(client.createBooking('33333333-3333-4333-8333-333333333333', 'tk')).rejects.toMatchObject({
      code: 'conflict',
      message: 'У вас уже есть активная бронь',
    });
  });

  it('ответ, не совпавший с контрактом, не превращается в пустые данные', async () => {
    installFetch([() => jsonResponse(200, { scooters: 'это не список' })]);
    const client = new HttpApiClient({ baseUrl: '' });

    await expect(client.getPark()).rejects.toThrowError();
  });

  it('недоступная сеть отличается от отказа сервера', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const client = new HttpApiClient({ baseUrl: '' });

    await expect(client.getPark()).rejects.toMatchObject({ code: 'network' });
  });
});
