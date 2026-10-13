# ACCEPTANCE.md — доказуемость (требование ТЗ №13)

Каждый пункт получает: **как проверяем**, **чем** (команда), **что видим** — сырой вывод лежит в
`docs/evidence/`. Строка без сырого вывода считается непроверенной.

## A. Требования ТЗ

| # | Требование | Как проверяем | Evidence |
|---|---|---|---|
| A1 | Отдельный backend и frontend, общение по сети | `docker compose ps` — три постоянных контейнера (db, backend, frontend); nginx проксирует `/api` и `/ws`, бэкенд наружу не публикуется | `evidence/S12/docker-acceptance.txt` п.1, п.3 |
| A2 | Backend на допустимом языке | Node 22 LTS + TypeScript + Fastify 5, обоснование выбора — ADR-002 | `evidence/S12/rules-and-stack.txt` (A2), `ARCHITECTURE.md §2` |
| A3 | Frontend на React (не Vue) | `frontend/package.json` → `react ^19.3.0`; поиск `vue`/`@vue` по всем манифестам пуст | `evidence/S12/rules-and-stack.txt` (A3) |
| A4 | Реляционная СУБД, PostgreSQL | `docker compose exec db psql -U sharing -d sharing -c '\dt'` → 11 таблиц | `evidence/S12/docker-acceptance.txt` п.6, `evidence/S8/db-acceptance.txt` |
| A5 | Учётные записи и вход | регистрация и вход на живой базе; без токена защищённые ручки отвечают 401; выход гасит сессию | `evidence/S9/rest-acceptance.txt`, `backend/tests/db/api.test.ts` |
| A6 | Промпты и лог решений | ADR в `DECISIONS.md`, промпты в `prompts/`, правила работы агента в `RULES.md` | `docs/DECISIONS.md`, `prompts/` |
| A7 | Использование AI-агентов раскрыто | `AI_USAGE.md`: что делал агент, что человек, где агент не справился | `docs/AI_USAGE.md` |
| A8 | Предварительные требования | версии Node, Docker, браузера, объём памяти, занятые порты | `RUNBOOK.md §1` |
| A9 | Быстрый локальный запуск | `docker compose up -d --build` с нуля → фронт на `localhost:8088`, база наполнена автоматически | `evidence/S12/docker-acceptance.txt` п.1–3, `scripts/demo.sh` |
| A10 | Внешние сервисы эмулируются | почта — таблица `emails` и экран «Входящие»; платежей нет, счёт формируется | `evidence/S10/billing-acceptance.txt`, `evidence/S6/account-acceptance.txt` |
| A11 | Работает при двух клиентах одновременно | два пользователя снаружи: бронь первого видна второму, перехватить нельзя (409), отмена тоже доходит | `evidence/S12/docker-acceptance.txt` п.4–5 |
| A12 | Честное описание состояния | `STATUS.md`: что работает, что ограничено и что не делали — с причинами | `docs/STATUS.md` |
| A13 | Доказуемость | этот файл + `docs/evidence/S1…S12` — сырые выводы команд, а не пересказ | `docs/evidence/` |

## B. Поведение продукта

| # | Требование | Проверка | Инструмент | Evidence |
|---|---|---|---|---|
| B1 | Состояние на карте меняется у всех сразу | второй клиент видит бронь за 7 мс в контейнерах и 13 мс на dev-стенде (порог 500 мс) | Playwright, два контекста | `evidence/S12/docker-acceptance.txt` п.5, `evidence/S11/live-integration.txt` |
| B2 | Одновременная бронь одного самоката невозможна | два параллельных `POST /api/bookings` → ровно один 201, второй 409; тот же вывод снаружи | vitest на живой базе + скрипт приёмки | `backend/tests/db/api.test.ts`, `evidence/S12/docker-acceptance.txt` п.4 |
| B3 | Бронь снимается через 15 минут, уведомление за 3 | подмена часов: 12:00 → `booking.expiring`, 15:00 → `expired`, самокат `free` | vitest с инъекцией `Clock` | `evidence/S9/rest-acceptance.txt` |
| B4 | Поминутная тарификация, пауза отдельно, копейки не теряются | таблица цен `DOMAIN.md §5` закрыта тестами, пауза тарифицируется отдельно | vitest (домен и сервер) | `evidence/S10/billing-acceptance.txt` |
| B5 | Финиш вне зоны запрещён, граница видна | `POST /api/rides/:id/finish` вне полигона → 422; полигон нарисован в DOM карты | vitest + замер DOM | `evidence/S9/rest-acceptance.txt`, `evidence/S3/map-acceptance.txt` |
| B6 | Заряд кончился → автофиниш и письмо с пояснением | симулятор доводит до 0 % → `endReason=battery_depleted`, письмо объясняет причину | vitest на живой базе | `evidence/S10/billing-acceptance.txt` |
| B7 | Потеря связи: экран и поездка продолжаются | разрыв сети в браузере: список не исчезает, после восстановления поток подключается сам | Playwright (`setOffline`) | `evidence/S11/live-integration.txt`, `evidence/S12/docker-acceptance.txt` п.5 |
| B8 | Одно письмо со счётом на поездку | повторный финиш (в том числе принудительный) → тот же счёт, одно письмо на поездку | vitest | `evidence/S10/billing-acceptance.txt` |
| B9 | Низкий заряд не показывается свободным | самокат ниже порога → `unavailable`, бронь отклоняется | vitest | `evidence/S9/rest-acceptance.txt` |

## C. Типизация и валидация (RULES §F)

Все прогоны — в `evidence/S12/rules-and-stack.txt` (сырой вывод команд).

| # | Требование | Проверка |
|---|---|---|
| F1 | Приведения типов запрещены | поиск `as`-приведений, `@ts-ignore`, `@ts-expect-error` по `shared/src`, `frontend/src`, `backend/src`, тестам и скриптам → совпадений нет |
| F2 | Non-null assertion отсутствует | поиск `!.` и `!)` → совпадений нет |
| F3 | `any` не используется | поиск `: any`, `<any>`, `as any` → совпадений нет |
| F4 | Строгий tsconfig | `tsc --noEmit` в трёх воркспейсах → exit 0 |
| F5 | ESLint type-checked без ошибок | `eslint .` в трёх воркспейсах → замечаний нет |
| F6 | Zod на всех границах | вход ручек, ответы (в том числе в браузере), строки БД, сид, `mock/*.json`, конфиг, сообщения ws: `shared/src/schemas.ts`, `backend/src/repo/rows.ts`, `frontend/src/lib/api/http-client.ts` |
| F7 | Тесты без приведений | правила F1–F3 покрывают и тесты; фикстуры — из `shared/src/testing/factories.ts` |
| F8 | Отключения правил только с причиной | 5 отключений, каждое с комментарием рядом (эффекты, работающие с внешним источником данных) |

## D. Процедура приёмки (как повторить)

```bash
npm install
bash scripts/demo.sh            # поднимает три контейнера и прогоняет сценарии снаружи
npm run check                   # типы, линтер, тесты по всем воркспейсам
npm run test:e2e -w frontend    # интерфейс на мок-данных (8 проверок)
TEST_DATABASE_URL=postgres://sharing:sharing@localhost:5433/sharing \
  npx playwright test --config=frontend/playwright.live.config.ts        # интерфейс на живом сервере
BASE_URL=http://localhost:8088 \
  npx playwright test --config=frontend/playwright.live.config.ts        # то же против контейнеров
```

Что смотреть в выводе: `docker compose ps` — три контейнера `healthy`; `probe-container` — страница,
API через прокси, снапшот потока и `park.delta` после отмены брони; `probe-two-clients` — шаги 1–5
(второй клиент получает 409 на чужую бронь); Playwright печатает время доставки события второму
клиенту в миллисекундах.

Замеры в браузере (геометрия карты, состояния панелей, визуальная оценка по скриншоту) делаются
отдельно — результат попадает в тот же каталог `docs/evidence/` текстом и картинкой.
