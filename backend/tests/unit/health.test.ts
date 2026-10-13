import { describe, expect, it } from 'vitest';

import { readHealth, type HealthDb } from '../../src/routes/health';

/** Подставная база: возвращает число применённых миграций или падает, как недоступная. */
function fakeDb(options: { migrations?: string; fail?: boolean } = {}): HealthDb {
  return {
    query: (sql: string) => {
      if (options.fail === true) {
        return Promise.reject(new Error('нет связи с базой'));
      }
      expect(sql).toContain('schema_migrations');
      return Promise.resolve({ rows: [{ count: options.migrations ?? '1' }] });
    },
  };
}

describe('проверка доступности', () => {
  it('сообщает о работе и считает применённые миграции', async () => {
    const now = () => Date.parse('2026-10-13T10:00:00.000Z');
    const { health, ok } = await readHealth({
      db: fakeDb({ migrations: '3' }),
      version: '0.1.0',
      startedAtMs: now() - 5_000,
      now,
    });

    expect(ok).toBe(true);
    expect(health.status).toBe('ok');
    expect(health.db).toEqual({ ok: true, latencyMs: 0, migrationsApplied: 3 });
    expect(health.serverTime).toBe('2026-10-13T10:00:00.000Z');
    expect(health.uptimeSeconds).toBe(5);
  });

  it('сообщает о недоступной базе, не падая', async () => {
    const { health, ok } = await readHealth({
      db: fakeDb({ fail: true }),
      version: '0.1.0',
      startedAtMs: 0,
      now: () => 1_000,
    });

    expect(ok).toBe(false);
    expect(health.status).toBe('degraded');
    expect(health.db.ok).toBe(false);
    expect(health.db.migrationsApplied).toBe(0);
  });
});
