import { z } from 'zod';

/** Ответ проверки доступности: состояние сервиса и базы. */
export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  serverTime: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  db: z.object({
    ok: z.boolean(),
    latencyMs: z.number().nonnegative(),
    // Миграции применены: сервис без схемы бессмысленен, поэтому это часть проверки.
    migrationsApplied: z.number().int().nonnegative(),
  }),
});

export type Health = z.infer<typeof HealthSchema>;

/**
 * Минимум, который нужен проверке от базы.
 *
 * Отдельный тип, а не `Pool`: во-первых, проверке доступности не нужны транзакции и пул целиком,
 * во-вторых, тест подставляет свой объект без приведений типов — а они в проекте запрещены.
 */
export interface HealthDb {
  query(sql: string): Promise<{ rows: { count?: string }[] }>;
}

export interface HealthDeps {
  db: HealthDb;
  version: string;
  startedAtMs: number;
  now: () => number;
}

/**
 * Проверка доступности.
 *
 * Отдаёт 200, когда работает и сервис, и база; 503 — когда база не отвечает. Так healthcheck в
 * docker-compose не признает контейнер готовым раньше времени.
 */
export async function readHealth(deps: HealthDeps): Promise<{ health: Health; ok: boolean }> {
  const startedAt = deps.now();

  // Недоступная база — это состояние сервиса, а не сбой обработчика: поэтому ошибка запроса
  // превращается в «нет связи», а не выбрасывается наружу.
  const result = await deps.db
    .query('SELECT count(*)::text AS count FROM schema_migrations')
    .catch(() => null);

  const dbOk = result !== null;
  const latencyMs = Math.max(0, deps.now() - startedAt);
  const migrationsApplied = result === null ? 0 : Number(result.rows[0]?.count ?? '0');

  const health: Health = {
    status: dbOk ? 'ok' : 'degraded',
    version: deps.version,
    serverTime: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.max(0, (startedAt - deps.startedAtMs) / 1000),
    db: { ok: dbOk, latencyMs, migrationsApplied },
  };

  return { health, ok: dbOk };
}

/** Настройки, нужные проверке доступности: собираются в одном месте для тестов и приложения. */
export function healthDeps(db: HealthDb, version: string, startedAtMs: number, now: () => number): HealthDeps {
  return { db, version, startedAtMs, now };
}
