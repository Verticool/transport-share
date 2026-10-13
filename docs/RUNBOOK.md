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

Что происходит при старте:
1. `db` поднимает PostgreSQL 17, создаёт `sharing` и пользователя из `.env`, ждёт `pg_isready` (healthcheck).
2. `backend` ждёт `db: service_healthy`, применяет SQL-миграции (`npm run migrate`), выполняет
   идемпотентный сид из `mock/*.json` (`SEED_ON_START=true`), поднимает Fastify на 3000, запускает
   тик симулятора парка и тик контроля брони.
3. `frontend` (nginx) отдаёт собранный бандл и проксирует `/api` и `/ws` на `backend`.

Остановка: `docker compose down` (данные сохраняются в томе `db_data`).
Полный сброс: `docker compose down -v` (том удаляется, сид выполнится заново).

## 3. Dev-режим без Docker (быстрая итерация)

```bash
npm install                    # workspaces: shared, frontend, backend
docker compose up -d db        # только БД (или свой локальный PostgreSQL 17)
cp .env.example .env
npm run migrate -w backend && npm run seed -w backend
npm run dev -w backend         # Fastify на :3000
npm run dev -w frontend        # Vite на :5173, /api и /ws проксируются на :3000
```

Фронт можно поднять вообще без бэкенда: `VITE_API_MODE=mock` — данные берутся из `mock/*.json`,
это режим стадий S2–S7 (фронт закрыт и доказуем без сервера).

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

## 6. Типовые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `docker compose up` падает на `db` | порт 5434 занят | поменять `DB_PORT` в `.env` |
| Фронт открывается, `/api/health` 502 | `backend` ещё применяет миграции | подождать 10–20 с, `docker compose logs -f backend` |
| WS не подключается | прокси не передаёт заголовки Upgrade | проверить блок `location /ws` в `frontend/nginx.conf` (в репо) |
| Пустая карта | сид не выполнился | `docker compose exec backend npm run seed`, проверить `SEED_ON_START` |
| Данные «застряли» в старом состоянии | остался том прошлого запуска | `docker compose down -v && docker compose up --build` |
