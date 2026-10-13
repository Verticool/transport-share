import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readMigrations } from '../../src/db/migrate';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

/**
 * Миграции читаются с диска: проверяем порядок и устойчивость контрольной суммы — по ней
 * приложение ловит правку уже применённого файла.
 */
describe('чтение миграций', () => {
  it('находит начальную миграцию', async () => {
    const migrations = await readMigrations(migrationsDir);

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.version).toBe('001_init');
  });

  it('сортирует по имени: порядок применения задают имена файлов', async () => {
    const migrations = await readMigrations(migrationsDir);
    const versions = migrations.map((migration) => migration.version);

    expect([...versions].sort((left, right) => left.localeCompare(right, 'en'))).toEqual(versions);
  });

  it('считает контрольную сумму по содержимому файла', async () => {
    const migrations = await readMigrations(migrationsDir);
    const first = migrations[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    const raw = await readFile(join(migrationsDir, '001_init.sql'), 'utf8');
    expect(first.checksum).toBe(createHash('sha256').update(raw, 'utf8').digest('hex'));
  });

  it('в схеме есть гарантии, которые нельзя обеспечить только кодом', async () => {
    const migrations = await readMigrations(migrationsDir);
    const sql = migrations.map((migration) => migration.sql).join('\n');

    // Требование B2: один активный бронь на самокат — частичный уникальный индекс.
    expect(sql).toContain('bookings_one_active_per_scooter');
    // Требование B8: один счёт на поездку, одно письмо на ключ дедупликации.
    expect(sql).toContain('invoices_ride_unique');
    expect(sql).toContain('emails_dedupe_key_unique');
    // Один незавершённый заезд и одна открытая пауза.
    expect(sql).toContain('rides_one_open_per_scooter');
    expect(sql).toContain('ride_pauses_one_open_per_ride');
    // Метку updated_at ставит база.
    expect(sql).toContain('set_updated_at');
    // Деньги целые, батарея в диапазоне.
    expect(sql).toContain('battery_pct BETWEEN 0 AND 100');
    expect(sql).toMatch(/amount\s+bigint/);
  });
});
