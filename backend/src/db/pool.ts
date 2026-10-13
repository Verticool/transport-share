import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import type { AppEnv } from '../config/env';

/**
 * Пул соединений с PostgreSQL.
 *
 * Соединения ограничены по числу: сервис локальный, а «сто соединений на всякий случай» — это
 * гарантированный отказ базы при параллельной работе.
 */
export function createPool(env: AppEnv): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Выполняет работу в транзакции.
 *
 * Откат — на любом исключении, включая программные: половина применённой операции опаснее, чем
 * её отсутствие (например, поездка закрыта, а счёт не выпущен).
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Запрос с типизацией строк результата: `pg` возвращает нетипизированные объекты. */
export async function query<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, [...params]);
}
