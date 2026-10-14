#!/usr/bin/env bash
# Сброс демонстрационной базы контейнеров к исходному состоянию.
#
# Зачем: живая база переживает прогоны и ручные проверки. Самокаты разряжаются, брони и поездки
# остаются открытыми, и в какой-то момент в парке не остаётся ни одного свободного самоката —
# тогда падают сценарии, которым нужен свободный самокат, хотя код исправен. Сид идемпотентный
# (не перезаписывает существующие строки), поэтому заряд самокатов и открытые поездки сам он не
# вернёт: перед наполнением данные нужно очистить.
set -euo pipefail

cd "$(dirname "$0")/.."

echo 'Очищаю данные демонстрационной базы...'
docker exec sharing-db psql -U sharing -d sharing -v ON_ERROR_STOP=1 -c \
  'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE' > /dev/null

echo 'Наполняю заново из mock-данных...'
docker compose run --rm --no-deps db-seed > /dev/null 2>&1 || docker compose up -d db-seed

echo 'Готово: парк, аккаунты и тарифы в исходном состоянии.'
