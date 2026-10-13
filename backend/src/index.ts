import { buildApp } from './app';
import { readEnv } from './config/env';
import { createPool } from './db/pool';

/**
 * Точка входа сервиса.
 *
 * Порядок намеренный: сначала проверяются настройки, потом база — сервис, который поднялся, но
 * не может ответить на запросы, хуже, чем сервис, который сразу сказал, что ему не хватает.
 */
async function main(): Promise<void> {
  const env = readEnv();
  const pool = createPool(env);
  // Пул удовлетворяет `HealthDb`: ручкам нужен только `query(sql)`, транзакции — позже (S9).
  const app = buildApp({ env, db: pool });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'останов сервиса');
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    // Проверка схемы на старте: без применённых миграций сервис работать не сможет.
    const applied = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM schema_migrations',
    );
    const count = Number(applied.rows[0]?.count ?? '0');
    if (count === 0) {
      app.log.error('схема не создана: выполните npm run migrate (в compose это делает db-migrate)');
      process.exit(1);
    }

    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info({ migrationsApplied: count }, 'сервис запущен');
  } catch (error) {
    app.log.error({ err: error }, 'не удалось запустить сервис');
    await pool.end();
    process.exit(1);
  }
}

await main();
