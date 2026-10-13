import { MockApiClient } from './mock-client';
import type { ApiClient } from './types';

export { ApiClientError } from './types';
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
 * Клиент данных интерфейса.
 *
 * На стадиях S3–S10 источник — мок-данные: тот же интерфейс `ApiClient`, но ответы приходят
 * статикой. Когда появится бэкенд (S11), здесь появится выбор режима (`VITE_API_MODE`),
 * а компоненты останутся без правок — они знают только интерфейс.
 *
 * Экземпляр один на приложение: мок-клиент играет роль сервера, а сервер один. Иначе разные
 * экраны видели бы разные состояния — например, бронь, оформленная в одном месте, была бы не видна
 * в другом.
 */
let sharedClient: ApiClient | null = null;

export function createApiClient(): ApiClient {
  sharedClient ??= new MockApiClient();
  return sharedClient;
}

/** Забыть общий экземпляр: нужно тестам, чтобы состояние не протекало между ними. */
export function resetApiClient(): void {
  sharedClient = null;
}
