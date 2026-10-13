import Fastify from 'fastify';

import type { AppEnv } from './config/env';
import { HealthSchema, readHealth, type HealthDb, type HealthDeps } from './routes/health';
export interface BuildAppOptions {
  env: AppEnv;
  /** Доступ к базе: проверке доступности нужен только запрос, остальным ручкам — пул (см. S9). */
  db: HealthDb;
  /** Часы: инъекция для тестов, чтобы время в ответах было предсказуемым. */
  now?: () => number;
  /** Логи: в тестах выключаются, в работе пишутся pino в stdout. */
  logger?: boolean;
}

/**
 * Собирает приложение Fastify.
 *
 * Отдельная функция (а не запуск внутри) нужна тестам: `app.inject` работает с тем же
 * экземпляром, что и в проде, — ручки проверяются без открытия порта.
 *
 * CORS не подключается осознанно: и в разработке (прокси Vite), и в контейнерах (прокси nginx)
 * фронт и бэкенд живут на одном источнике, поэтому браузер не делает предварительных запросов.
 */
export function buildApp(options: BuildAppOptions) {
  const now = options.now ?? (() => Date.now());
  const deps: HealthDeps = {
    db: options.db,
    version: '0.1.0',
    startedAtMs: now(),
    now,
  };

  const app = Fastify({
    logger: options.logger === false ? false : { level: options.env.LOG_LEVEL },
    disableRequestLogging: options.env.NODE_ENV === 'test',
  });

  app.get('/api/health', async (_request, reply) => {
    const { health, ok } = await readHealth(deps);
    // Схема ответа — контракт: если поля разойдутся с фронтом, это поймается тестом, а не глазами.
    const parsed = HealthSchema.parse(health);
    return reply.code(ok ? 200 : 503).send(parsed);
  });

  return app;
}
