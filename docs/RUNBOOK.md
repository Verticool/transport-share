# RUNBOOK.md — предварительные требования и локальный запуск (требование ТЗ №8, №9)

## 1. Предварительные требования

| Компонент | Минимум | Проверка |
|---|---|---|
| Docker Engine / Docker Desktop | 24+ с Compose v2 | `docker --version && docker compose version` |
| Оперативная память | 8 ГБ свободно (Postgres + Node + сборка Vite) | — |
| Свободные порты | `8088` (фронт), `5434` (Postgres), `3000`/`5173` — только для dev-режима | `netstat -ano \| findstr 8088` |
| Свободное место | ~1.5 ГБ (образы node, nginx, postgres) | `docker system df` |
| Браузер | любой современный; Edge — для e2e | — |

Опционально (только для разработки без Docker): Node.js 22 LTS, npm 10+.
Ничего больше не требуется — внешних сервисов, ключей и API-токенов нет.

## 2. Запуск одной командой (основной путь)

```bash
git clone <repo> transport-sharing && cd transport-sharing
cp .env.example .env          # дефолты рабочие, менять не обязательно
docker compose up --build     # первый запуск ~2–4 мин: сборка фронта, образа бэка, initdb
```
Открыть: **http://localhost:8088**

Демонстрационный доступ (пароль у всех — `demo1234`): `demo@sharing.kg` — с историей поездок и
счетами; `demo2@sharing.kg` — второй вход с теми же правами без истории (удобен, когда нужно два
браузера); `alan@example.com` и ещё трое — остальные пользователи с данными.

Что происходит при старте (порядок задан `depends_on`):
1. `db` поднимает PostgreSQL 17 с пользователем и базой `sharing`, ждёт `pg_isready` (healthcheck).
2. `db-migrate` (одноразовый) применяет SQL-миграции и завершается.
3. `db-seed` (одноразовый) выполняет идемпотентный сид из `mock/*.json` и завершается.
4. `backend` стартует после успешного сида: Fastify на 8080, тик симулятора парка и тик контроля
   брони. Наружу порт не публикуется.
5. `frontend` (nginx) отдаёт собранный бандл и проксирует `/api` и `/ws` на `backend`.

Остановка: `docker compose down` (данные сохраняются в томе `db-data`).
Полный сброс: `docker compose down -v` (том удаляется, схема и сид применятся заново).

## 3. Dev-режим без Docker (быстрая итерация)

```bash
npm install                    # workspaces: shared, frontend, backend
docker compose up -d db        # только БД (или свой локальный PostgreSQL 17)
cp .env.example .env
npm run migrate -w backend && npm run seed -w backend
npm run dev -w backend         # Fastify на :8080
VITE_API_MODE=http npm run dev -w frontend   # Vite на :5173, /api и /ws проксируются на :8080
```

Фронт можно поднять вообще без бэкенда: без `VITE_API_MODE` (или `VITE_API_MODE=mock`) данные
берутся из `mock/*.json`, а состояние «сервера» живёт в памяти вкладки — это режим стадий S2–S7,
он остаётся для быстрого показа интерфейса.

Сквозные проверки по реальному стеку (фронт + сервер + база) — отдельный конфиг: он сам поднимает
сервер и Vite на :5174, а перед прогоном приводит к исходному состоянию **тестовую** базу.

```bash
# у тестов своя база: проверки очищают таблицы и не должны трогать данные приложения
TEST_DATABASE_URL=postgres://sharing:sharing@localhost:5433/sharing_test \
  npx playwright test --config=playwright.live.config.ts -w frontend
```

Та же проверка против уже собранных контейнеров (проверяем то, что сдаём; база при этом не
сбрасывается, а сценарии сами приводят аккаунт в спокойное состояние):

```bash
BASE_URL=http://localhost:8088 npx playwright test --config=playwright.live.config.ts -w frontend
```

Тестовая база создаётся автоматически при первом запуске тома (`docker/postgres/init-test-db.sql`).
Если том уже существует, создать её вручную:

```bash
docker compose exec db psql -U sharing -d postgres -c 'CREATE DATABASE sharing_test OWNER sharing'
DATABASE_URL=postgres://sharing:sharing@localhost:5433/sharing_test npm run migrate -w backend
```

Сброс тестовой базы вручную: `DATABASE_URL=...sharing_test npm run db:reset-test -w backend`.
Руководило простое правило: **на рабочей базе (sharing) проверки не запускать** — они стирают
сессии и незакрытые поездки живых пользователей.

## 4. Проверка работоспособности (доказуемость)

```bash
npm run check                  # typecheck + lint + tests по всем воркспейсам
npm run test:e2e               # Playwright (channel: msedge), два клиента
docker compose ps              # все три сервиса healthy
curl -s localhost:8088/api/health | jq   # {status, server_time, db: 'up', scooters: N}
```

## 5. Память и лимиты (диспетчер задач врёт про llama-server)

Проверка состояния памяти — утилита **вне репозитория**, рядом с локальным стеком:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File E:/llama.cpp/ram-guard.ps1
# код возврата: 0 — норма, 1 — предупреждение, 2 — критично
```

Что смотреть: **commit charge**, а не цифру «Память» из диспетчера задач. Модель
(`KAT-Coder-V2.5-Dev-APEX-Compact.gguf`, 16.5 ГБ) подгружена в llama-server через mmap,
это file-backed страницы, и в колонке «Память» они не учитываются — там видно 7-8 ГБ,
тогда как реально процесс держит ~28 ГБ commit (модель + host-буферы CUDA + workspace cuBLAS).

Ориентиры на этой машине (RAM 32 ГБ, pagefile 15.2 ГБ → лимит commit 47.2 ГБ):
- commit до 90 % и ≥ 3 ГБ свободной физической — норма;
- 90-94 % или < 3 ГБ свободной — не запускать тяжёлое параллельно (Docker Desktop/WSL2
  легко добавляет 2-8 ГБ, браузер с десятками вкладок — заметно больше);
- ≥ 94 % — не запускать ничего нового.

Если памяти не хватает, порядок действий: не держать одновременно воркеры и Docker Desktop →
держать не более одного воркера вместо двух → при следующем перезапуске llama-server снизить
`-c 262144` → `-c 131072` и `-np 4` → `-np 2` (замерить до/после) → в последнюю очередь
увеличить pagefile.

Отдельно про число слотов: **профиль запуска модели — `-np 2`** (по 131 072 токена на слот).
С четырьмя слотами воркеры-сабагенты получали по ~65k, набирали промпт больше и падали с
`request too large`; заодно четыре слота держали на 7.7 ГБ больше commit (замер: private 27.8 ГБ
при `-np 4` против 20.1 ГБ при `-np 2`). Профиль зафиксирован в `E:\llama.cpp\start-kat.cmd`.

## 6. Типовые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `docker compose up` падает на `db` | порт 5434 занят | поменять `DB_PORT` в `.env` |
| Фронт открывается, `/api/health` 502 | `backend` ещё применяет миграции | подождать 10–20 с, `docker compose logs -f backend` |
| WS не подключается | прокси не передаёт заголовки Upgrade | проверить блок `location /ws` в `frontend/nginx.conf` (в репо) |
| Пустая карта | сид не выполнился | `docker compose exec backend npm run seed`, проверить `SEED_ON_START` |
| Данные «застряли» в старом состоянии | остался том прошлого запуска | `docker compose down -v && docker compose up --build` |

## Если правки не видны в браузере

Фронт в контейнере раздаётся nginx: `index.html` отдаётся с `Cache-Control: no-cache`, файлы
сборки (`/assets/*.js`, имена с хешем) — `public, immutable`. Проверить одной командой:

```
curl -sI http://localhost:8088/ | grep -i cache        # ожидаем no-cache, must-revalidate
```

Если видите старую сборку — сначала пересоберите образ (`docker compose up -d --build frontend`),
затем обновите страницу. Кэш браузера чистится жёсткой перезагрузкой (Ctrl+Shift+R).
