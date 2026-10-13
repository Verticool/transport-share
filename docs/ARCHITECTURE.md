# ARCHITECTURE.md — архитектура сервиса шеринга самокатов

Статус: черновик к согласованию. Дата: 2026-10-13.

## 1. Что строим

Сервис шеринга электросамокатов: карта с парком (свободен / забронирован / в поездке /
недоступен), бронь на 15 минут, поездка со стартом, паузой и завершением, поминутный тариф
и отдельный тариф паузы, зона обслуживания, кабинет с текущей поездкой, историей и счетами,
серверный симулятор положения и заряда. Город — Бишкек (реальный центр), валюта — сом (KGS).

## 2. Выбор языка бэкенда: Node.js, а не Python/Go

| Критерий | Node.js + TypeScript | Python (FastAPI) | Go |
|---|---|---|---|
| Общий код с фронтом | **Да**: типы и zod-схемы контракта в `shared/`, одна модель домена, расхождения API ловит компилятор | Нет: типы нужно дублировать вручную | Нет |
| Реалтайм (WS-хаб, тик симулятора) | Родная модель событий, `ws` без доп. рантайма | Нужен доп. процесс/ASGI-настройка | Хорош, но избыточен по объёму кода |
| Один образ вместо двух стеков | Один `node:22-alpine` для сборки и рантайма | Python-образ + отдельный node-образ для фронта | + toolchain |
| Скорость разработки с локальным AI-воркером | Воркер обучен на JS/TS-коде, генерация точнее | Сопоставимо | Ниже (шаблонность, ошибки интерфейсов) |

Итог: Node.js 22 LTS + TypeScript + Fastify. Ключевой аргумент — **shared-контракт**:
типы API, zod-схемы валидации, статусы, тарифы и ws-протокол лежат в одном месте и
подключаются и фронтом, и бэком. Это дешевле любой генерации API-клиента и убирает
класс ошибок «фронт ждёт `batteryLevel`, бэк отдаёт `battery`».

## 3. Схема контейнеров (docker compose, 3 контейнера)

```
                     браузер клиента A          браузер клиента B
                            │                          │
             HTTP /api/*   │  WS /ws                  │  HTTP /api/*  WS /ws
                            ▼                          ▼
        ┌──────────────────────────────────────────────────────────┐
        │  frontend  (nginx:alpine, порт 8088 → 80)                 │
        │  собранный Vite-бандл + прокси /api и /ws на backend      │
        └───────────────────────────┬──────────────────────────────┘
                                    │  http://backend:3000
        ┌───────────────────────────▼──────────────────────────────┐
        │  backend  (node:22-alpine, порт 3000)                     │
        │  Fastify REST + ws-хаб + тик симулятора парка + тик       │
        │  брони/поездок; pg-пул; миграции на старте                │
        └───────────────────────────┬──────────────────────────────┘
                                    │  postgres://db:5432
        ┌───────────────────────────▼──────────────────────────────┐
        │  db  (postgres:17-alpine, порт 5434 → 5432)               │
        │  volume db_data (персистентность) + healthcheck pg_isready│
        └──────────────────────────────────────────────────────────┘
```

Правила compose:
- `db` с `healthcheck`, `backend` с `depends_on: db: condition: service_healthy`, `frontend` — после `backend`.
- Один `docker compose up --build` поднимает всё; фронт доступен на `http://localhost:8088`.
- Порты наружу: только `8088` (фронт) и `5434` (БД, для отладки, можно закрыть). Бэкенд наружу не публикуется, фронт-nginx проксирует `/api` и `/ws` — так «клиент-сервер по сети» соблюдено, и CORS не нужен.
- Сид БД: `backend` при старте читает те же `mock/*.json`, что использовал фронт на первой стадии (`SEED_ON_START=true`).

## 4. Структура репозитория

```
transport-sharing/
├─ docker-compose.yml          три сервиса, сети, тома, healthcheck
├─ package.json                npm workspaces: shared, frontend, backend
├─ .env.example                копируется в .env, дефолты рабочие из коробки
├─ docs/                       план, архитектура, рулсет, ADR, статус, приёмка, runbook, evidence/
├─ prompts/                    сырые задания, отданные локальному воркеру (требование A6/A7)
├─ mock/                       сид-данные JSON (общий источник для фронта и бэкенда)
│   scooters.json  users.json  rides.json  invoices.json  emails.json  service-zone.json
├─ shared/                     @sharing/shared — контракт
│   src/domain.ts              типы домена (Scooter, Ride, Booking, Invoice, статусы)
│   src/schemas.ts             zod-схемы запросов/ответов (используются и бэком)
│   src/constants.ts           тарифы, пороги заряда, длительность брони, зона, лимиты
│   src/ws-protocol.ts         типы ws-сообщений (клиент→сервер, сервер→клиент), seq
│   src/money.ts               денежная арифметика в минорных единицах + формат
│   src/time.ts                Clock, расчёт минут/сегментов, formatDuration
├─ frontend/                   React 19 + Vite 8 + TS + Tailwind 4 + shadcn/ui
│   src/app/                   корень, провайдеры, роутер
│   src/components/layout/     шелл: хедер, сайдбар, панели
│   src/components/ui/         shadcn-примитивы
│   src/features/map/          карта, маркеры парка, зона обслуживания, легенда
│   src/features/booking/      бронь, таймер 15 мин, уведомление за 3 мин
│   src/features/ride/         старт/пауза/финиш, живой счётчик, запрет финиша вне зоны
│   src/features/account/      текущая поездка, история, счета, письма
│   src/features/auth/         вход/регистрация
│   src/lib/api/               ApiClient: интерфейс + mock-реализация (json) + http/ws-реализация
│   src/lib/map/               обёртки OpenLayers: создание карты, слои, стили маркеров, геометрия зоны
│   src/lib/simulator/         фронтовый симулятор парка (стадия S2–S7, потом выключается)
│   src/stores/                zustand-стор
│   src/hooks/                 useServerClock, useParkStream, useAuth
├─ backend/                    Fastify 5 + pg + ws
│   src/server.ts              bootstrap: плагины, роуты, ws, тики, graceful shutdown
│   src/routes/*.ts            auth, scooters, bookings, rides, invoices, emails, zone
│   src/services/*.ts          park, booking, ride, pricing, mailer, simulator, zone
│   src/db/pool.ts             pg.Pool + транзакционный helper
│   src/db/migrations/*.sql    собственные SQL-миграции + раннер schema_migrations
│   src/db/seed.ts             загрузка mock/*.json в БД (идемпотентно)
│   src/ws/hub.ts              хаб: подписки, broadcast, seq, снапшот по запросу
│   tests/                     vitest: unit (pricing, zone, booking), integration (inject), ws
└─ frontend/e2e/               Playwright-сценарии на двух контекстах браузера
```

Правило зависимостей (одной строкой, чтобы дерево не поплыло):
`features/*` знают React и стор → `lib/api` и `stores` знают `shared`, не знают React-компонентов →
`components/*` не знают ни стор, ни карту, ни сеть → `shared` не знает ничего, кроме zod.

## 5. Модель данных (PostgreSQL 17)

```
users        id uuid pk, email citext unique, password_hash, name, created_at, updated_at
scooters     id uuid pk, code unique, model, status, battery_pct int, lat, lng double,
             low_battery_flagged bool, last_seen_at, created_at, updated_at
bookings     id uuid pk, user_id fk, scooter_id fk, status (active|expired|cancelled|consumed),
             reserved_at, expires_at, notified_at, closed_at, created_at, updated_at
rides        id uuid pk, user_id fk, scooter_id fk, booking_id fk unique,
             status (active|paused|finished), started_at, finished_at, end_reason,
             distance_m int, total_amount bigint, currency, created_at, updated_at
ride_pauses  id uuid pk, ride_id fk, started_at, ended_at, created_at, updated_at
ride_points  id bigserial pk, ride_id fk, lat, lng, battery_pct, recorded_at   (append-only)
ride_events  id bigserial pk, ride_id fk, scooter_id fk, type, payload jsonb, recorded_at (append-only)
invoices     id uuid pk, ride_id fk unique, user_id fk, breakdown jsonb, amount bigint,
             currency, issued_at, created_at                                  (append-only)
emails       id uuid pk, user_id fk, to_email, subject, body, dedupe_key unique,
             sent_at, created_at                                             (append-only)
```

Инварианты (проверяются тестами на уровне БД, не только кода):
- `CREATE UNIQUE INDEX bookings_one_active_per_scooter ON bookings(scooter_id) WHERE status='active'` — B2.
- `ALTER TABLE invoices ADD CONSTRAINT invoices_ride_unique UNIQUE (ride_id)` — B8 (одно письмо на поездку).
- `CHECK (battery_pct BETWEEN 0 AND 100)`, `CHECK (status IN (...))` — статусы только доменные.
- Все деньги — `bigint`, валюта — отдельная колонка.

## 6. Контракт API (фиксируется до реализации, стадия S1)

REST (JSON, zod-валидация на входе и выходе):
```
POST   /api/auth/register|login|refresh|logout
GET    /api/me
GET    /api/scooters                    список парка + server_time + seq
GET    /api/scooters/:id
GET    /api/zone                        полигон зоны обслуживания
POST   /api/bookings                    {scooterId} → 201 booking | 409 conflict
DELETE /api/bookings/:id                отмена брони пользователем
GET    /api/bookings/active
POST   /api/rides                       {bookingId} → старт поездки
POST   /api/rides/:id/pause | /resume
POST   /api/rides/:id/finish            {lat,lng} → 200 invoice | 422 outside_zone
GET    /api/rides/active
GET    /api/rides                       история (пагинация)
GET    /api/invoices                    счета пользователя
GET    /api/emails                      эмуляция почты: входящие пользователя
GET    /api/health                      версия, время сервера, состояние БД
```

WS `/ws` (JSON-сообщения):
```
клиент → сервер: {type:'subscribe', token?} | {type:'snapshot', sinceSeq?} | {type:'ping'}
сервер → клиент: {type:'snapshot', seq, sent_at, server_time, payload:{scooters, myBooking, myRide}}
                 {type:'park.delta', seq, sent_at, changes:[{id,status,battery,lat,lng,last_seen_at}]}
                 {type:'booking.expiring', expires_at, minutes_left}
                 {type:'booking.expired'} | {type:'ride.finished', invoice}
                 {type:'ride.tick', rideId, elapsed_minutes, amount_so_far, server_time}
                 {type:'error', code, message}
```
Каждое серверное сообщение несёт `seq` + `sent_at`. Клиент игнорирует сообщения с `seq` меньше
последнего применённого — это защита от гонок при реконнекте (B7).

## 6.1 Как фронт получает данные (два источника, S11)

Экраны не знают, откуда приходят данные: они вызывают методы одного интерфейса `ApiClient` и
получают доменные объекты. Источников два, переключаются переменной `VITE_API_MODE`:

| Режим | Что под капотом | Когда используется |
|---|---|---|
| `mock` (по умолчанию) | файлы `mock/*.json` + «сервер» в памяти вкладки (`MockApiClient`) | быстрый показ интерфейса без базы и сервера |
| `http` | сеть: `/api/*` запросами, `/ws` потоком (`HttpApiClient`) | обычная работа: состояние в PostgreSQL, общее для всех клиентов |

Что даёт режим сервера:

- **Ответы проверяются, а не принимаются на веру.** Каждый ответ проходит zod-схему из `shared`:
  расхождение контракта ломает разбор сразу, а не превращается в пустое поле в разметке.
- **Доступ продлевается прозрачно.** Токен доступа короткий; при ответе 401 клиент один раз
  продлевает сессию по токену обновления и повторяет запрос — пользователь этого не замечает.
  Параллельные запросы ждут одно продление, а не устраивают гонку.
- **Состояние парка приходит потоком.** При подписке сервер отдаёт снапшот, дальше только
  изменения; сообщения с номером не больше применённого отбрасываются, поэтому реконнект не может
  откатить состояние назад. Обрыв связи не ломает экран: данные остаются, соединение
  восстанавливается с растущей паузой.
- **Клиент один на приложение.** Иначе разные экраны видели бы разные сессии, а бронь, оформленная
  на карте, была бы не видна в кабинете.
- **Один origin.** Dev-сервер проксирует `/api` и `/ws` на сервер, в контейнере то же делает nginx,
  поэтому CORS не нужен ни в одном режиме и фронт всегда обращается к относительным путям.

## 7. Симулятор транспорта

Серверный тик раз в 1 с (на фронт-стадии — тот же алгоритм в браузере, в `lib/simulator`):
- свободный самокат стоит и медленно теряет 0 % (парк не «тратит» заряд без поездки);
- самокат в поездке: движение к случайной цели в зоне, шум GPS, шаг ~6–12 м/тик при 15 км/ч;
- заряд: −1 % за 60 с езды (порог «низкий заряд» — 20 %, ниже — самокат в `unavailable`, B9);
- при заряде 0 % — автофиниш, `end_reason='battery_depleted'`, письмо с пояснением (B6);
- запись `ride_points` (телеметрия с `recorded_at`) при поездке, `scooters.last_seen_at` — всегда;
- выключенный по флагу симулятор (тесты) → время двигается вручную через инъекцию `Clock`.

## 8. Деньги и тарификация

Тарифы — константы в `shared/src/constants.ts` (правятся в одном месте, описаны в `DOMAIN.md`):
разблокировка 25 сом, езда 6 сом/мин, пауза 2 сом/мин.

Расчёт (чистая функция `calcRidePrice`, покрыта таблицей тестов):
1. Езда разбивается на интервалы между паузами; каждый интервал округляется **вверх** до
   полной минуты отдельно; паузы — так же, отдельным тарифом.
2. Всё в минорных единицах (тыйын): `bigint` в БД, `number` (безопасный) в TS, никакого `float`.
3. `breakdown` попадает в счёт и в письмо: `unlock_fee`, `ride_minutes`, `ride_amount`,
   `pause_minutes`, `pause_amount`, `total`.
4. Граничные случаи в тестах: 0 с, 59 с, 60 с, 61 с, пауза на середине, пауза < 1 мин,
   несколько пауз, поездка ровно 15 минут, автофиниш по заряду, finish вне зоны (не должен списывать).

## 9. Брони и гонки

- Создание брони — одна SQL-транзакция: `UPDATE scooters SET status='reserved' WHERE id=$1 AND status='free' RETURNING *`
  (0 строк → 409 `scooter_not_free`); затем `INSERT bookings` с `expires_at = now() + interval '15 min'`.
  Частичный уникальный индекс ловит гонку на уровне БД (B2).
- Один активный заезд на пользователя: частичный уникальный индекс на `bookings(user_id) WHERE status='active'`
  и `rides(user_id) WHERE status IN ('active','paused')`.
- Тик раз в 5 с закрывает просроченные брони: `expires_at <= now() AND status='active'` → `expired`,
  самокат → `free`; за 3 минуты — событие `booking.expiring` (одно, по `notified_at`).
- Если самокат «не в зоне» или на нём едет кто-то другой — бронь не создаётся.

## 10. Тестовая стратегия (по стадиям)

| Уровень | Инструмент | Что покрывает |
|---|---|---|
| Домен/деньги/зона/время | `vitest` в `shared` | чистые функции: цена, сегменты, попадание в полигон, формат длительности, drift-часы |
| Сервисы бэка | `vitest` + фейковое время | бронь/истечение/уведомление, автофиниш по заряду, идемпотентность писем |
| HTTP-ручки | `vitest` + `app.inject()` | коды ответов, валидация zod, 409 при гонке (два параллельных запроса) |
| БД-инварианты | `vitest` + реальный Postgres в докере | частичные уникальные индексы, триггер `updated_at`, каскады |
| WS | `vitest` + реальный сокет | снапшот, дельты, seq, реконнект без потери состояния |
| Компоненты | `@testing-library/react` | карта/панели на мок-ApiClient: статусы, таймер брони, живой счёт |
| e2e | Playwright (`channel: msedge`) | два клиента: мгновенная синхронизация, гонка за один самокат, автоснятие брони, потеря связи |
| Доказуемость | bash-скрипты в `docs/evidence/` | сырые выводы команд под каждый пункт B1–B9 |

## 11. Что НЕ делаем (осознанно)

- Нет гео-роутинга по дорогам (OSRM) — движение самоката линейное с шумом, задача симулятора в этом.
- Нет PostGIS — проверка зоны ray casting по полигону в `shared`.
- Нет оплаты картой, нет интеграции с платёжным провайдером — счёт формируется, оплата эмулируется.
- Нет push-уведомлений и реального SMTP — почта эмулируется таблицей и экраном «Входящие».
- Нет очередей/брокеров/кэша — тики в процессе бэкенда; при перезапуске состояние восстанавливается из БД.

## 12. Риски

| Риск | Как снимаем |
|---|---|
| Локальный воркер отчитывается «готово», не сделав | Приёмка замером (грep, тесты, браузер) — правилом, см. `AI_USAGE.md` |
| Гонка за самокат не воспроизводится вручную | Тест с двумя параллельными `inject`-запросами + e2e на двух контекстах |
| Рассинхрон часов между клиентами | `server_time` в каждом ответе и ws-сообщении, `useServerClock` |
| Дрейф симулятора при перезапуске бэкенда | Состояние — в БД; симулятор считает позицию от `last_seen_at` |
| Postgres в контейнере теряет данные между запусками | Именованный том `db_data` + идемпотентный сид |
