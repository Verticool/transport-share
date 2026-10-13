import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool } from 'pg';

import { withTransaction } from './pool';

/** Применённая миграция: версия, контрольная сумма файла и время применения. */
export interface AppliedMigration {
  version: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationFile {
  version: string;
  sql: string;
  checksum: string;
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Читает миграции из каталога.
 *
 * Имена файлов задают порядок (`001_init.sql`, `002_...`): сортировка по имени — это и есть порядок
 * применения. Файл, который изменили после применения, будет пойман по контрольной сумме.
 */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort((left, right) => left.localeCompare(right, 'en'));

  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({
      version: file.replace(/\.sql$/, ''),
      sql,
      checksum: checksumOf(sql),
    });
  }
  return migrations;
}

/**
 * Применяет неприменённые миграции.
 *
 * Каждая миграция — в своей транзакции: упавшая миграция не оставляет половину схемы. Уже
 * применённые проверяются по контрольной сумме: если файл изменили задним числом, это ошибка,
 * а не повод молча пропустить расхождение.
 */
export async function migrate(
  pool: Pool,
  migrations: readonly MigrationFile[],
  log: (message: string) => void = () => undefined,
): Promise<AppliedMigration[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<{ version: string; checksum: string; applied_at: Date }>(
    'SELECT version, checksum, applied_at FROM schema_migrations',
  );
  const byVersion = new Map(applied.rows.map((row) => [row.version, row]));

  const justApplied: AppliedMigration[] = [];
  for (const migration of migrations) {
    const already = byVersion.get(migration.version);
    if (already !== undefined) {
      if (already.checksum !== migration.checksum) {
        throw new Error(
          `Миграция ${migration.version} уже применена, но файл изменился: ` +
            'создайте новую миграцию вместо правки применённой',
        );
      }
      continue;
    }

    const appliedAt = await withTransaction(pool, async (client) => {
      await client.query(migration.sql);
      const inserted = await client.query<{ applied_at: Date }>(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) RETURNING applied_at',
        [migration.version, migration.checksum],
      );
      return inserted.rows[0]?.applied_at ?? new Date();
    });

    log(`применена миграция ${migration.version}`);
    justApplied.push({
      version: migration.version,
      checksum: migration.checksum,
      appliedAt: appliedAt.toISOString(),
    });
  }

  return justApplied;
}
