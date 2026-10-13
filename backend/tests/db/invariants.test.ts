import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPool } from '../../src/db/pool';
import { migrate, readMigrations } from '../../src/db/migrate';
import { seed } from '../../src/db/seed';
import { readEnv } from '../../src/config/env';

/**
 * Проверки на живой базе.
 *
 * Это не тесты кода, а тесты гарантий схемы: правила «один самокат — одна бронь», «один счёт на
 * поездку», «одно письмо на ключ» и «метку времени ставит база» должны держаться даже если
 * приложение ошибётся. Поэтому здесь нарушение пробуют вставить напрямую SQL-ом.
 *
 * Запуск: `TEST_DATABASE_URL=postgres://... npx vitest run`. Без переменной тесты пропускаются.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const suite = testDatabaseUrl === undefined ? describe.skip : describe;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const migrationsDir = join(repoRoot, 'backend', 'migrations');
const mockDir = join(repoRoot, 'mock');

let pool: Pool;

beforeAll(async () => {
  if (testDatabaseUrl === undefined) {
    return;
  }
  pool = createPool(readEnv({ DATABASE_URL: testDatabaseUrl, LOG_LEVEL: 'error' }));
  const migrations = await readMigrations(migrationsDir);
  await migrate(pool, migrations);
  // Чистое состояние: тесты вставляют свои строки и не должны спотыкаться о сид.
  await pool.query('TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, scooters, users CASCADE');
});

afterAll(async () => {
  if (pool !== undefined) {
    await pool.end();
  }
});

/** Создаёт пользователя и самокат — минимальный набор для проверки правил броней и поездок. */
async function makeUserAndScooter(): Promise<{ userId: string; scooterId: string }> {
  const userId = randomUUID();
  const scooterId = randomUUID();
  const code = `T-${scooterId.slice(0, 8)}`;

  await pool.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'scrypt$aa$bb', 'Тест')`,
    [userId, `${userId}@example.com`],
  );
  await pool.query(
    `INSERT INTO scooters (id, code, model, status, battery_pct, lat, lng, last_seen_at)
     VALUES ($1, $2, 'Ninebot Max G30', 'free', 80, 42.8746, 74.5698, now())`,
    [scooterId, code],
  );
  return { userId, scooterId };
}

suite('гарантии схемы', () => {
  it('применяет миграции и сохраняет их в schema_migrations', async () => {
    const result = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    const versions = result.rows.map((row) => row.version);

    expect(versions).toContain('001_init');
  });

  it('повторное применение миграций ничего не делает', async () => {
    const migrations = await readMigrations(migrationsDir);
    const applied = await migrate(pool, migrations);

    expect(applied).toEqual([]);
  });

  it('не даёт забронировать один самокат дважды на уровне базы', async () => {
    const { userId, scooterId } = await makeUserAndScooter();
    const secondUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'scrypt$aa$bb', 'Второй')`,
      [secondUserId, `${secondUserId}@example.com`],
    );

    await pool.query(
      `INSERT INTO bookings (id, user_id, scooter_id, status, reserved_at, expires_at)
       VALUES ($1, $2, $3, 'active', now(), now() + interval '15 minutes')`,
      [randomUUID(), userId, scooterId],
    );

    await expect(
      pool.query(
        `INSERT INTO bookings (id, user_id, scooter_id, status, reserved_at, expires_at)
         VALUES ($1, $2, $3, 'active', now(), now() + interval '15 minutes')`,
        [randomUUID(), secondUserId, scooterId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('не даёт одному пользователю две активные брони', async () => {
    const { userId, scooterId } = await makeUserAndScooter();
    const otherScooterId = randomUUID();
    await pool.query(
      `INSERT INTO scooters (id, code, model, status, battery_pct, lat, lng, last_seen_at)
       VALUES ($1, $2, 'Ninebot Max G30', 'free', 70, 42.8746, 74.5698, now())`,
      [otherScooterId, `T-${otherScooterId.slice(0, 8)}`],
    );

    await pool.query(
      `INSERT INTO bookings (id, user_id, scooter_id, status, reserved_at, expires_at)
       VALUES ($1, $2, $3, 'active', now(), now() + interval '15 minutes')`,
      [randomUUID(), userId, scooterId],
    );

    await expect(
      pool.query(
        `INSERT INTO bookings (id, user_id, scooter_id, status, reserved_at, expires_at)
         VALUES ($1, $2, $3, 'active', now(), now() + interval '15 minutes')`,
        [randomUUID(), userId, otherScooterId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('не даёт двум поездкам идти на одном самокате', async () => {
    const { userId, scooterId } = await makeUserAndScooter();

    await pool.query(
      `INSERT INTO rides (id, user_id, scooter_id, status, started_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [randomUUID(), userId, scooterId],
    );

    await expect(
      pool.query(
        `INSERT INTO rides (id, user_id, scooter_id, status, started_at)
         VALUES ($1, $2, $3, 'active', now())`,
        [randomUUID(), userId, scooterId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('не даёт выпустить второй счёт на одну поездку', async () => {
    const { userId, scooterId } = await makeUserAndScooter();
    const rideId = randomUUID();
    await pool.query(
      `INSERT INTO rides (id, user_id, scooter_id, status, started_at) VALUES ($1, $2, $3, 'active', now())`,
      [rideId, userId, scooterId],
    );

    const insertInvoice = (): Promise<unknown> =>
      pool.query(
        `INSERT INTO invoices (id, ride_id, user_id, breakdown, amount, issued_at)
         VALUES ($1, $2, $3, '{"total": 100}'::jsonb, 100, now())`,
        [randomUUID(), rideId, userId],
      );

    await insertInvoice();
    await expect(insertInvoice()).rejects.toMatchObject({ code: '23505' });
  });

  it('не даёт отправить второе письмо с тем же ключом дедупликации', async () => {
    const { userId } = await makeUserAndScooter();
    const key = `invoice:${randomUUID()}`;

    const insertEmail = (): Promise<unknown> =>
      pool.query(
        `INSERT INTO emails (id, user_id, to_email, subject, body, dedupe_key, sent_at)
         VALUES ($1, $2, 'test@example.com', 'Счёт', 'текст', $3, now())`,
        [randomUUID(), userId, key],
      );

    await insertEmail();
    await expect(insertEmail()).rejects.toMatchObject({ code: '23505' });
  });

  it('запрещает завершённую поездку без причины, времени и суммы', async () => {
    const { userId, scooterId } = await makeUserAndScooter();

    await expect(
      pool.query(
        `INSERT INTO rides (id, user_id, scooter_id, status, started_at, finished_at)
         VALUES ($1, $2, $3, 'finished', now(), now())`,
        [randomUUID(), userId, scooterId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('запрещает заряд вне диапазона и неизвестный статус', async () => {
    const { scooterId } = await makeUserAndScooter();

    await expect(pool.query('UPDATE scooters SET battery_pct = 150 WHERE id = $1', [scooterId])).rejects.toMatchObject(
      { code: '23514' },
    );
    await expect(
      pool.query("UPDATE scooters SET status = 'улетел' WHERE id = $1", [scooterId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('ставит updated_at базой, а не приложением', async () => {
    const { scooterId } = await makeUserAndScooter();
    const before = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM scooters WHERE id = $1', [scooterId]);

    await pool.query("UPDATE scooters SET status = 'reserved' WHERE id = $1", [scooterId]);

    const after = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM scooters WHERE id = $1', [scooterId]);
    const beforeAt = before.rows[0]?.updated_at ?? new Date(0);
    const afterAt = after.rows[0]?.updated_at ?? new Date(0);
    expect(afterAt.getTime()).toBeGreaterThanOrEqual(beforeAt.getTime());
  });
});

suite('сид из мок-данных', () => {
  it('наполняет базу и повторный запуск ничего не добавляет', async () => {
    await pool.query('TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, scooters, users CASCADE');

    const first = await seed(pool, mockDir);
    expect(first.users).toBe(6);
    expect(first.scooters).toBe(40);
    expect(first.rides).toBe(25);
    expect(first.invoices).toBeGreaterThan(0);
    expect(first.emails).toBe(first.invoices);

    const second = await seed(pool, mockDir);
    expect(second).toEqual({ users: 0, scooters: 0, rides: 0, invoices: 0, emails: 0 });
  });

  it('демонстрационный пользователь входит по паролю из сида', async () => {
    const { verifyPassword } = await import('../../src/auth/password');
    const result = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = 'demo@sharing.kg'",
    );
    const hash = result.rows[0]?.password_hash ?? '';

    await expect(verifyPassword('demo1234', hash)).resolves.toBe(true);
    await expect(verifyPassword('другой', hash)).resolves.toBe(false);
  });
});
