# Задание воркеру · S2-mock · генератор мок-данных `mock/*.json`

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\scripts\generate-mock.mjs` — генератор (Node ESM, без зависимостей, детерминированный)
2. `E:\Work\transport-sharing\shared\tests\mock.test.ts` — тесты мок-данных

и **запустить генератор**, чтобы он создал каталог `E:\Work\transport-sharing\mock\` с файлами:

```
mock/service-zone.json   mock/users.json      mock/scooters.json
mock/rides.json          mock/invoices.json   mock/emails.json
```

## Что НЕ трогать

- Не менять ничего в `shared/src/` и в других файлах `shared/tests/`, кроме нового `mock.test.ts`.
- Не менять `shared/package.json`, `shared/tsconfig.json`, `vitest.config.ts`, корневой `eslint.config.js`,
  `scripts/collect-savings.mjs`, `scripts/check-pricing.mjs`.
- Не создавать других файлов (кроме перечисленных выше JSON, которые создаёт сам генератор).

## Контекст

`mock/*.json` — единый источник данных: на стадии фронта (S3–S7) их фетчит фронт как статику,
на стадии бэкенда (S8) из них сидируется PostgreSQL. Поэтому они обязаны проходить zod-схемы из
`shared/src/schemas.ts` и быть согласованными между собой.

Читать только: этот файл задания, `shared/src/domain.ts`, `shared/src/schemas.ts`,
`shared/src/constants.ts`, `shared/src/money.ts`, `shared/src/zone.ts`, `shared/src/time.ts`.

Node 22+ умеет импортировать `.ts` напрямую (type stripping) — проверено в этом проекте,
`scripts/check-pricing.mjs` уже так делает: `import { calcRidePrice } from '../shared/src/money.ts'`.
Генератор обязан быть **детерминированным**: `node scripts/generate-mock.mjs` дважды подряд даёт
байт-в-байт одинаковые файлы (mulberry32 с фиксированным seed).

## Состав данных (жёсткие требования)

| Файл | Содержимое |
|---|---|
| `service-zone.json` | `{ "name": "Бишкек, центр", "polygon": [[lat, lng], ...] }` — полигон из `SERVICE_ZONE` в `constants.ts`, 8 точек |
| `users.json` | 6 пользователей: `id` (uuid), `email`, `name`, `createdAt`, `updatedAt`. Демо-учётка обязана быть: `demo@sharing.kg` / пароль `demo1234` (сам пароль в файле **не хранится** — его хеширует сид бэкенда) |
| `scooters.json` | **40** самокатов: `id`, `code` (`SC-001`…`SC-040`), `model` (из `FLEET.models`), `status`, `batteryPct`, `lat`, `lng`, `lastSeenAt`, `createdAt`, `updatedAt` |
| `rides.json` | **25** завершённых поездок: `id`, `userId`, `scooterId`, `bookingId`, `status: "finished"`, `startedAt`, `finishedAt`, `endReason`, `distanceM`, `totalAmount`, `currency`, `createdAt`, `updatedAt` |
| `invoices.json` | по одному счёту на каждую поездку (25): `id`, `rideId`, `userId`, `amount`, `currency`, `breakdown`, `issuedAt`, `createdAt` |
| `emails.json` | по одному письму на каждую поездку (25): `id`, `userId`, `toEmail`, `subject`, `body`, `dedupeKey`, `sentAt`, `createdAt` |

Требования к правдоподобию:
- Все 40 самокатов **внутри полигона зоны** (проверять `isInsideZone`), распределены по центру Бишкека.
- `status` распределён так: примерно 24 `free`, 6 `reserved`, 5 `in_ride`, 5 `unavailable`.
- **Не менее 10 самокатов** (≥ 25 %) с `batteryPct < LOW_BATTERY_THRESHOLD` (порог 20) — и все они
  обязаны быть в статусе `unavailable` (требование B9: низкий заряд не показывается свободным).
- `batteryPct` — целое 0..100; у `in_ride` — от 25 до 90.
- Поездки: длительности от 3 до 40 минут, у части поездок есть паузы (в `breakdown` видно `pauseMinutes > 0`).
- Все суммы — **целые в тыйынах** и **обязаны совпадать** с пересчётом:
  `calcRidePrice(ride, pauses, finishedAtMs, DEFAULT_TARIFF)` из `shared/src/money.ts`.
  В `invoices.json` пишется тот же `breakdown`, что вернула функция.
- `emails.json`: у письма `dedupeKey = 'invoice:' + rideId` (одно письмо на поездку), тема вида
  `Счёт за поездку SC-007`, тело — сумма в сомах и минуты езды/паузы.
- `userId`/`scooterId`/`rideId` — согласованы: ссылки указывают на существующие записи.
- Все timestamps — ISO-8601 UTC (`toIso` из `shared/src/time.ts`), `updatedAt >= createdAt`,
  поездки за последние 30 дней, `sentAt` письма = `issuedAt` счёта.

## Обязательные тесты `shared/tests/mock.test.ts` (минимум 15)

1. Все шесть файлов существуют и парсятся как JSON.
2. Каждый файл (поэлементно) проходит соответствующую zod-схему из `schemas.ts`.
3. Ровно 40 самокатов, 6 пользователей, 25 поездок, 25 счетов, 25 писем, у зоны 8 точек.
4. Все самокаты внутри зоны (`isInsideZone`), `code` уникальны и идут от `SC-001` до `SC-040`.
5. Не менее 10 самокатов с `batteryPct < 20`, и **все** они `unavailable`; ни один `free` не имеет заряд < 20.
6. `batteryPct` — целое в диапазоне 0..100 у всех самокатов.
7. `totalAmount` каждой поездки = `breakdown.total` её счёта.
8. `breakdown` пересчитан независимо: для каждой поездки вызвать `calcRidePrice` с теми же
   интервалами и тарифом и сверить с записанным `breakdown` (расхождений быть не должно).
9. Все суммы целые (`Number.isInteger`), валюта везде `KGS`.
10. Ссылочная целостность: `ride.userId` и `ride.scooterId` существуют; у каждого счёта есть поездка;
    у каждой поездки есть ровно один счёт и ровно одно письмо.
11. `dedupeKey` уникальны, формат `invoice:<rideId>`.
12. `toEmail` писем совпадает с email пользователя поездки.
13. `updatedAt >= createdAt` у всех записей; `finishedAt > startedAt` у поездок.
14. Детерминизм: вызов `generateMock()` из генератора (экспортируй функцию) дважды с одним seed
    даёт глубоко равные объекты.
15. Демо-пользователь `demo@sharing.kg` присутствует.

## Ограничения

- **Запрещены приведения типов**: `as`, `as any`, `as unknown as`, `<T>value`, `value!`,
  `@ts-ignore`, `@ts-expect-error`. Единственное исключение — `as const`.
  Для чтения JSON-файлов в тестах: `JSON.parse` → сразу `.parse()` схемой (не `as`).
- **Запрещён `any`**.
- Никаких новых зависимостей.
- Работать строго в целевых путях, без папки scratch и без `cp`.
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.
- Файлы `mock/*.json` пишет генератор, а не ты вручную. Если кириллица в JSON портится при записи —
  писать через `JSON.stringify(value, null, 2)` и `writeFileSync` с `'utf8'`.

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing
node scripts/generate-mock.mjs          # создаёт mock/*.json, печатает сводку (сколько записей)
node scripts/generate-mock.mjs          # повторный запуск — файлы байт-в-байт те же (проверить через md5)
md5sum mock/*.json                      # до и после повторного запуска — совпадают

cd shared
npx tsc --noEmit -p tsconfig.json       # exit 0
npx vitest run tests/mock.test.ts       # все тесты зелёные, видно количество
npx eslint ../scripts/generate-mock.mjs tests/mock.test.ts   # 0 ошибок по этим файлам
```

## Отчёт

Короткий: список созданных файлов, сырой вывод команд выше, сводка по составу данных
(статусы парка, сколько с низким зарядом, диапазон сумм счетов).
