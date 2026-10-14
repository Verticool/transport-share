import { useSessionStore } from '../../stores/session';
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

/**
 * Клиент сервера, связанный с сессией приложения.
 *
 * Клиент хранит токен обновления у себя, поэтому его нужно и восстановить из сохранённого входа
 * (иначе после перезагрузки страницы продление невозможно, и пользователя выбрасывает на вход),
 * и обновлять при каждом изменении сессии. Продление прозрачное: при истёкшем доступе клиент сам
 * продлевает его и повторяет запрос, а если продлить нечем — приложение сбрасывает авторизацию.
 */
function createHttpClient(): HttpApiClient {
  const client = new HttpApiClient({
    onTokenRefreshed: (tokens) => {
      useSessionStore.getState().updateTokens(tokens);
    },
    onSessionExpired: () => {
      useSessionStore.getState().signOut();
    },
  });
  client.rememberRefreshToken(useSessionStore.getState().refreshToken);
  useSessionStore.subscribe((state, previous) => {
    if (state.refreshToken !== previous.refreshToken) {
      client.rememberRefreshToken(state.refreshToken);
    }
  });
  return client;
}

export function createApiClient(mode: ApiMode = readApiMode()): ApiClient {
  sharedClient ??= mode === 'http' ? createHttpClient() : new MockApiClient();
  return sharedClient;
}

/** Забыть общий экземпляр: нужно тестам, чтобы состояние не протекало между ними. */
export function resetApiClient(): void {
  sharedClient = null;
}
