# Задание воркеру · S1-schemas · `shared/src/schemas.ts` (zod) + тесты

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\shared\src\schemas.ts`
2. `E:\Work\transport-sharing\shared\tests\schemas.test.ts`

## Что НЕ трогать

- Не менять `shared/src/domain.ts`, `constants.ts`, `time.ts`, `money.ts`, `zone.ts`, `ws-protocol.ts`, `index.ts`.
- Не менять `package.json`, `tsconfig.json`, `vitest.config.ts`, корневой `eslint.config.js`.
- Не трогать `shared/tests/time.test.ts`, `shared/tests/zone.test.ts`, `shared/tests/money.test.ts`
  (их параллельно правит другой воркер).
- Не создавать других файлов.

## Контекст

Проект: сервис шеринга самокатов. Пакет `shared` (`@sharing/shared`) — ESM TypeScript, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, импорты с расширением `.ts`.
Zod **4** уже установлен (`import { z } from 'zod'`).

Этот файл — единственное место, где описаны схемы валидации входящих данных. По рулсету `RULES.md §F.3`
всё, что приходит извне (HTTP body/query/params, ws-сообщения, строки из БД, содержимое `mock/*.json`,
переменные окружения), проходит через эти схемы; внутри системы ходят уже провалидированные типы.

Читать только: этот файл задания, `shared/src/domain.ts`, `shared/src/ws-protocol.ts`, `shared/src/constants.ts`.

## Что должно быть в schemas.ts

### 1. Примитивы и литералы статусов

```ts
export const IsoSchema: z.ZodString;              // ISO-8601 с Z на конце, проверять через z.iso.datetime() или refine
export const MinorSchema: z.ZodNumber;            // целое >= 0 (деньги в тыйынах)
export const LatLngSchema: z.ZodObject<...>;      // { lat: number -90..90, lng: number -180..180 }
export const ScooterStatusSchema;                 // z.enum(SCOOTER_STATUSES) — литералы из domain.ts
export const BookingStatusSchema;
export const RideStatusSchema;
export const EndReasonSchema;
```

### 2. Доменные объекты (должны быть совместимы с типами из `domain.ts`)

```ts
export const PublicUserSchema;   // id, email, name, createdAt, updatedAt
export const ScooterSchema;      // id, code, model, status, batteryPct 0..100 (int), lat, lng, lastSeenAt, createdAt, updatedAt
export const BookingSchema;
export const RidePauseSchema;
export const RideSchema;
export const InvoiceBreakdownSchema;   // unlockFee, rideMinutes, rideAmount, pauseMinutes, pauseAmount, total — все int >= 0
export const InvoiceSchema;
export const EmailMessageSchema;
export const ServiceZoneSchema;        // { name, polygon: [number, number][] (>= 3 точки) }
export const RidePointSchema;
export const ApiErrorSchema;           // { code, message, details? }
export const ServerTimeSchema;         // { serverTime: Iso } — единый ответ с серверным временем
```

### 3. Входные данные ручек (тела запросов)

```ts
export const RegisterRequestSchema;      // email (валидный), password (>= 8 символов), name (1..80)
export const LoginRequestSchema;         // email, password
export const CreateBookingRequestSchema; // { scooterId: uuid }
export const RideIdParamsSchema;         // { rideId: uuid }
export const FinishRideRequestSchema;    // { lat, lng }
export const RidesQuerySchema;           // { limit?: int 1..100 = 20, offset?: int >= 0 = 0 }
export const PaginatedSchema;            // фабрика: paginated(схемаЭлемента) → { items, total, limit, offset }
```

### 4. WS-протокол (дискриминированные объединения по `type`)

```ts
export const ClientMessageSchema;  // тип из ws-protocol.ts, дискриминатор 'type'
export const ServerMessageSchema;  // все варианты ServerMessage, дискриминатор 'type'
export function parseClientMessage(input: unknown): ClientMessage;   // парсит, кидает ZodError с понятным текстом
export function parseServerMessage(input: unknown): ServerMessage;
```

### 5. Хелперы

```ts
/** Парсит и возвращает типизированное значение; для данных, где ошибка означает баг (сид, конфиг). */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, what: string): T;

/** Безопасный разбор для пользовательского ввода; возвращает { ok: true, value } | { ok: false, error: string }. */
export function safeParseResult<T>(schema: z.ZodType<T>, input: unknown):
  | { ok: true; value: T }
  | { ok: false; error: string };
```

## Обязательные требования

- **Схемы и типы обязаны совпадать.** Для каждой доменной схемы в тесте проверяется совместимость
  через типовую аннотацию (без приведений): `const scooterSchema: z.ZodType<Scooter> = ScooterSchema;`
  — компилятор сам поймает расхождение.
- **Никаких приведений типов** (`as`, `as unknown as`, `<T>`, `!`, `@ts-ignore`, `@ts-expect-error`),
  никакого `any`. Единственное исключение — `as const`.
- Схемы не мутируют входные объекты; лишние ключи zod по умолчанию отбрасывает — так и оставить.
- Ошибки валидации должны быть человекочитаемыми: `parseOrThrow` добавляет в сообщение, что именно парсили.

## Обязательные тесты (минимум 25)

1. Каждый доменный объект: валидный пример проходит; пример с неверным типом поля, с отсутствующим
   обязательным полем и с неверным значением enum — падает.
2. `batteryPct`: 0 и 100 проходят, −1 и 101 падают.
3. `MinorSchema`: 0 и 3100 проходят, 31.5 и −1 падают (деньги — целые).
4. `IsoSchema`: `'2026-10-13T10:00:00.000Z'` проходит, `'13.10.2026'` и `'2026-10-13T10:00:00'` (без Z) падают.
5. `LatLngSchema`: координаты центра Бишкека (42.8746, 74.5698) проходят, lat 95 и lng 200 падают.
6. `RegisterRequestSchema`: короткий пароль (7 символов) падает, невалидный email падает, валидный проходит.
7. `RidesQuerySchema`: без параметров даёт `limit = 20, offset = 0`; `limit = 101` падает; строки `'10'`
   коэрсятся в число (если решите поддержать query-строки — тогда явно через `z.coerce.number()`).
8. `paginated(ScooterSchema)`: валидная страница проходит, отрицательный `total` падает.
9. WS: валидный `{ type: 'ping', at: 1791899135000 }` проходит; неизвестный `type` падает;
   `{ type: 'park.delta' }` без `changes` падает; `parseServerMessage` на валидном снапшоте возвращает
   объект с нужным `type`; на мусоре (`null`, `'строка'`, `{}`) — бросает.
10. `safeParseResult`: на валидных данных `ok: true` с типизированным `value`, на невалидных — `ok: false`
    и непустая строка `error` (без исключений наружу).
11. `parseOrThrow`: сообщение об ошибке содержит переданный `what`.
12. Дискриминированный union: серверное сообщение типа `ride.tick` не проходит валидацию как `booking.expired`
    (проверка, что схема реально различает варианты, а не принимает всё подряд).

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json      # exit 0
npx vitest run tests/schemas.test.ts   # все тесты зелёные, видно количество
npx eslint src/schemas.ts tests/schemas.test.ts   # без ошибок по этим двум файлам
```

**Важно:** в пакете сейчас есть известные ошибки `@typescript-eslint/no-non-null-assertion` в
`src/zone.ts`, `tests/time.test.ts`, `tests/zone.test.ts` — их исправляет другой воркер параллельно.
Эти файлы не трогать; ошибки в них — не твоя ответственность.

## Ограничения среды

- Терминал — git-bash (MSYS); нативные программы не понимают пути `/e/...` — сначала `cd`.
- Никогда не использовать `python -c "..."`.
- Работать строго в целевых путях, без папки scratch и без `cp`.
- Читать только перечисленные файлы (раздутый контекст приводит к зависанию модели).
- Браузера нет и он не нужен.

## Отчёт

Короткий: список созданных файлов, сколько схем, сырой вывод трёх команд, какие граничные случаи покрыты.
