#!/usr/bin/env bash
# demo.sh — воспроизводимый сценарий приёмки.
#
# Поднимает стек в контейнерах и прогоняет два сценария снаружи, через тот же адрес, что видит
# браузер: состояние парка и поток событий, затем двух клиентов одновременно.
#
# Запуск: bash scripts/demo.sh
set -euo pipefail

BASE="${BASE:-http://localhost:8088}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== 1. Сборка и запуск трёх контейнеров ==="
docker compose up -d --build
echo

echo "=== 2. Состояние контейнеров ==="
docker compose ps --format '{{.Service}}: {{.Status}}'
echo

echo "=== 3. Ожидание готовности фронта ==="
for attempt in $(seq 1 60); do
  if curl -fsS -o /dev/null "$BASE/api/health"; then
    echo "фронт отвечает на $BASE (попытка $attempt)"
    break
  fi
  sleep 2
done
echo

echo "=== 4. Стек снаружи: страница, API через прокси, поток событий ==="
(cd backend && npx tsx scripts/probe-container.ts "$BASE")
echo

echo "=== 5. Два клиента одновременно ==="
(cd backend && npx tsx scripts/probe-two-clients.ts "$BASE")
echo

echo "=== 6. Таблицы базы ==="
docker compose exec -T db psql -U sharing -d sharing -c '\dt'
echo

echo "Готово. Откройте $BASE в браузере; демонстрационный доступ: demo@sharing.kg / demo1234"
