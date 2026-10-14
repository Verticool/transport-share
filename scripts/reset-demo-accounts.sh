#!/usr/bin/env bash
# Приведение демо-аккаунтов в спокойное состояние перед живым прогоном.
#
# Живая база контейнеров переживает прогоны: после сценария у пользователя может остаться бронь
# или незакрытая поездка (в том числе вне зоны, где поездку нельзя закрыть сразу). Каждый живой
# сценарий начинается с приведения аккаунта в порядок, но после ручных прогонов состояние может
# остаться — этот скрипт закрывает хвосты, чтобы наборы не падали по вине прошлого прогона.
set -euo pipefail

BASE="${BASE_URL:-http://localhost:8088}"

clean_account() {
  local email="$1" password="$2"
  local token
  token=$(curl -sS -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  if [ -z "$token" ]; then
    echo "$email: вход не удался"
    return 0
  fi

  local booking
  booking=$(curl -sS "$BASE/api/bookings/active" -H "authorization: Bearer $token" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$booking" ]; then
    curl -sS -X DELETE "$BASE/api/bookings/$booking" -H "authorization: Bearer $token" > /dev/null
    echo "$email: бронь $booking снята"
  fi

  local ride
  ride=$(curl -sS "$BASE/api/rides/active" -H "authorization: Bearer $token" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$ride" ]; then
    # Сначала возвращаем самокат в зону: вне зоны сервер не даёт закрыть поездку.
    curl -sS -X POST "$BASE/api/rides/$ride/push-to-zone" -H "authorization: Bearer $token" > /dev/null
    curl -sS -X POST "$BASE/api/rides/$ride/finish" -H "authorization: Bearer $token" > /dev/null
    echo "$email: поездка $ride закрыта"
  fi
}

clean_account 'demo@sharing.kg' 'demo1234'
clean_account 'demo2@sharing.kg' 'demo1234'
echo 'аккаунты в спокойном состоянии'
