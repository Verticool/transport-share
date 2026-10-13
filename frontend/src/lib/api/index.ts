import { MockApiClient } from './mock-client';
import type { ApiClient } from './types';

export { ApiClientError } from './types';
export type { ApiClient, ParkSnapshot } from './types';

/**
 * Клиент данных интерфейса.
 *
 * На стадиях S3–S10 источник — мок-данные: тот же интерфейс `ApiClient`, но ответы приходят
 * статикой. Когда появится бэкенд (S11), здесь появится выбор режима (`VITE_API_MODE`),
 * а компоненты останутся без правок — они знают только интерфейс.
 */
export function createApiClient(): ApiClient {
  return new MockApiClient();
}
