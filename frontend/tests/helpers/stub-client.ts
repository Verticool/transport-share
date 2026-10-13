import type { ApiClient } from '../../src/lib/api';

/**
 * Заглушка клиента данных для тестов компонентов и хуков.
 *
 * Зачем отдельный модуль: интерфейс `ApiClient` растёт по стадиям, и каждый его метод обязан
 * быть в тестовом клиенте — иначе тесты падают с ошибкой типов и приходится править их пачками.
 * Здесь весь интерфейс закрыт один раз: неиспользованный метод честно сообщает об этом,
 * а тест переопределяет только те вызовы, которые действительно проверяет.
 */
export function makeStubClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notUsed = (method: string) => (): Promise<never> =>
    Promise.reject(new Error(`тест не должен вызывать ${method}`));

  return {
    getZone: notUsed('getZone'),
    getPark: notUsed('getPark'),
    getActiveBooking: notUsed('getActiveBooking'),
    createBooking: notUsed('createBooking'),
    cancelBooking: notUsed('cancelBooking'),
    getActiveRide: notUsed('getActiveRide'),
    startRide: notUsed('startRide'),
    pauseRide: notUsed('pauseRide'),
    resumeRide: notUsed('resumeRide'),
    finishRide: notUsed('finishRide'),
    login: notUsed('login'),
    logout: notUsed('logout'),
    getMe: notUsed('getMe'),
    getRides: notUsed('getRides'),
    getInvoices: notUsed('getInvoices'),
    getEmails: notUsed('getEmails'),
    ...overrides,
  };
}
