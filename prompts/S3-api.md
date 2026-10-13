# Задание воркеру · S3-api · доступ к данным фронта (`ApiClient` + mock-реализация)

## Что сделать

Создать ровно три файла:

1. `E:\Work\transport-sharing\frontend\src\lib\api\types.ts` — интерфейс клиента и ошибка
2. `E:\Work\transport-sharing\frontend\src\lib\api\mock-client.ts` — реализация на мок-данных
3. `E:\Work\transport-sharing\frontend\tests\api.test.ts` — тесты

## Что НЕ трогать

- Ничего в `shared/`, в остальных файлах `frontend/src/` и `frontend/tests/`.
- `frontend/package.json`, `frontend/tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`.
- Не создавать других файлов.

## Контекст

Фронт на стадиях S3–S7 работает без сервера: данные берутся из корневого каталога `mock/`,
который подключён как `publicDir` Vite и отдаётся статикой по `/scooters.json`, `/service-zone.json`.
Интерфейс компонентов не должен знать, откуда данные: экраны ходят только через `ApiClient`,
поэтому позже (S11) mock-реализация заменяется http/ws-реализацией без правок компонентов.

Читать только: этот файл, `frontend/src/config/map.ts`, `shared/src/domain.ts`,
`shared/src/schemas.ts`, `shared/src/constants.ts`, `frontend/vitest.config.ts`, `mock/scooters.json`
(первые 40 строк — форма данных).

## Обязательный контракт

`frontend/src/lib/api/types.ts`:

```ts
import type { Iso, Scooter, ServiceZone } from '@sharing/shared';

/** Снимок парка: список самокатов + серверное время (RULES §D: время считаем от сервера). */
export interface ParkSnapshot {
  scooters: Scooter[];
  /** ISO-8601 UTC; на моках — время клиента, на реальном API — `server_time` из ответа. */
  serverTime: Iso;
}

export interface ApiClient {
  /** Зона обслуживания (полигон). */
  getZone(): Promise<ServiceZone>;
  /** Парк: все самокаты со статусами и зарядом. */
  getPark(): Promise<ParkSnapshot>;
}

/** Ошибка уровня клиента: единый формат для моков и будущего http-клиента. */
export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}
```

`frontend/src/lib/api/mock-client.ts`:

```ts
/** Клиент мок-данных: читает JSON-файлы статики и проверяет их zod-схемами. */
export class MockApiClient implements ApiClient {
  constructor(options?: { baseUrl?: string; minDelayMs?: number; maxDelayMs?: number });
  getZone(): Promise<ServiceZone>;
  getPark(): Promise<ParkSnapshot>;
}
```

## Требования к поведению

1. **Все внешние данные проходят zod-схемы** (`ServiceZoneSchema`, `z.array(ScooterSchema)`) —
   по рулсету §F.3 это граница данных. Никаких `as`, `any` и `JSON.parse(...) as T`.
2. Сетевой/разборочный сбой превращается в `ApiClientError` с кодом:
   - `network` — fetch упал (нет сети, файла нет → `response.ok === false`),
   - `invalid_payload` — данные не прошли схему,
   с человекочитаемым сообщением (тексты — по `docs/BRAND.md`, без технического жаргона и без кодов в тексте).
3. **Имитация задержки сети**: ответ отдаётся через `minDelayMs`…`maxDelayMs` (по умолчанию 120…300 мс),
   чтобы интерфейс проверялся в реальных условиях (состояния загрузки, гонки).
   В тестах задержка отключается (`minDelayMs: 0, maxDelayMs: 0`).
4. `serverTime` в `ParkSnapshot` — ISO-строка с `Z` (использовать `toIso` из `@sharing/shared`).
5. Сортировка самокатов — стабильная: по `code` по возрастанию (чтобы список не «прыгал» между запросами).
6. Никаких глобальных синглтонов, никаких обращений к `localStorage`.

## Обязательные тесты (минимум 8)

`fetch` подменяется через `vi.stubGlobal` (в тесте читаем настоящие файлы через `node:fs`
и отдаём их как тело ответа — так проверяются обе части: схема и форма реального JSON).

1. `getPark()` возвращает 40 самокатов и `serverTime`, заканчивающийся на `Z`.
2. Каждый самокат проходит `ScooterSchema` (проверить через `safeParse` в тесте).
3. Самокаты отсортированы по `code` по возрастанию.
4. `getZone()` возвращает зону с 8 точками и проходит `ServiceZoneSchema`.
5. `fetch` вернул 404 → `ApiClientError` с кодом `network`.
6. `fetch` упал с исключением → `ApiClientError` с кодом `network`.
7. Тело не проходит схему (например, у самоката `batteryPct: 200`) → `ApiClientError` с кодом `invalid_payload`.
8. Задержка соблюдается: с `minDelayMs: 30, maxDelayMs: 30` вызов длится не меньше 25 мс
   (замер через `performance.now()`), а не отдаётся мгновенно.

## Ограничения

- **Запрещены приведения типов** (`as`, `as unknown as`, `<T>`, `!`, `@ts-ignore`, `@ts-expect-error`),
  **запрещён `any`**. Единственное исключение — `as const`.
- Никаких новых зависимостей: `fetch` нативный, схемы и типы — из `@sharing/shared`.
- Импорты: внутри `frontend/src` — относительные пути, типы и схемы — из `@sharing/shared`.
- Работать строго в целевых путях, без scratch и `cp`.
- **Не гонять проверки циклами**: сделай один финальный прогон и приведи его вывод.
  Приёмка и разбор ошибок — на оркестраторе.
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.

## Критерии приёмки (сырой вывод обязателен, один прогон)

```
cd /e/Work/transport-sharing/frontend
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/api.test.ts
```

## Отчёт

Короткий: список файлов, какие сценарии покрыты тестами, сырой вывод двух команд.
