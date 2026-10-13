# Сборка фронта и раздача статики.
#
# Два шага: сборка (Node) и запуск (nginx). Так в образ не попадают ни исходники, ни dev-зависимости
# — наружу смотрит только собранная статика и прокси на бэкенд. Это тот же принцип, что и у бэкенда:
# в контейнере лежит ровно то, что нужно для работы.

# ─── шаг 1: сборка ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Сначала манифесты: пока они не меняются, слой с зависимостями берётся из кэша.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci

COPY shared shared
COPY frontend frontend
COPY mock mock

# Режим данных задаётся при сборке: собранная статика обращается к серверу по сети,
# а не к мок-файлам (они остаются для быстрого запуска без базы).
ARG VITE_API_MODE=http
ENV VITE_API_MODE=${VITE_API_MODE}
RUN npm run build -w frontend

# ─── шаг 2: раздача ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine уже имеет свой healthcheck-совместимый образ; проверку задаёт compose.
