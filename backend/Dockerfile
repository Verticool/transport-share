# Образ бэкенда.
#
# Монорепозиторий: ставим зависимости всех workspace-пакетов, потому что бэкенд использует общий
# пакет контрактов (`shared`) — он собирается из исходников TS и не публикуется в реестр.
# Исходники TS исполняет tsx: сборка в JS на локальном проекте ничего не даёт, а лишний шаг
# «собрать — скопировать — запустить» усложняет отладку.

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --workspaces --include-workspace-root

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY shared ./shared
COPY backend ./backend
COPY mock ./mock

# Порт не публикуется наружу: за него отвечает фронт-контейнер (nginx проксирует /api и /ws).
EXPOSE 8080

CMD ["npm", "run", "start", "-w", "backend"]
