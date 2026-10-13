import { HttpApiClient } from './http-client';
import { MockApiClient } from './mock-client';
import type { ApiClient } from './types';

export { ApiClientError } from './types';
export { HttpApiClient } from './http-client';
export type {
  ApiClient,
  ApiErrorCode,
  BookingSnapshot,
  Page,
  PageQuery,
  ParkSnapshot,
  RideSnapshot,
  SessionSnapshot,
} from './types';

/**
 * Режим источника данных.
 *
 * `mock` — статика из `mock/*.json` и «сервер» в памяти вкладки: так интерфейс проверялся до
 * появления бэкенда. `http` — настоящий сервер (S11). Переключается переменной окружения, поэтому
 * экраны работают и с моками, и с сервером без правок.
 */
export type ApiMode = 'mock' | 'http';

export function readApiMode(): ApiMode {
  // Доступ через скобки: `import.meta.env` описан как словарь, а прямой доступ к полю запрещён
  // настройкой `noPropertyAccessFromIndexSignature`.
  const raw: unknown = import.meta.env['VITE_API_MODE'];
  return raw === 'http' ? 'http' : 'mock';
}

/**
 * Клиент данных интерфейса.
 *
 * Экземпляр один на приложение: иначе разные экраны видели бы разные сессии и состояния —
 * например, бронь, оформленная на карте, была бы не видна в кабинете.
 */
let sharedClient: ApiClient | null = null;

export function createApiClient(mode: ApiMode = readApiMode()): ApiClient {
  sharedClient ??= mode === 'http' ? new HttpApiClient() : new MockApiClient();
  return sharedClient;
}

/** Забыть общий экземпляр: нужно тестам, чтобы состояние не протекало между ними. */
export function resetApiClient(): void {
  sharedClient = null;
}
