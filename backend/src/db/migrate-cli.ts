import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnv } from '../config/env';
import { migrate, readMigrations } from './migrate';
import { createPool } from './pool';

/**
 * Применение миграций из командной строки: `npm run migrate`.
 * В docker-compose этот же код выполняет одноразовый сервис `db-migrate`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'migrations');

const env = readEnv();
const pool = createPool(env);

try {
  const migrations = await readMigrations(migrationsDir);
  const applied = await migrate(pool, migrations, (message) => {
    process.stdout.write(`${message}\n`);
  });

  if (applied.length === 0) {
    process.stdout.write(`миграции не требуются: применено ${migrations.length}\n`);
  } else {
    process.stdout.write(`применено миграций: ${applied.length}\n`);
  }
} catch (error) {
  process.stderr.write(`ошибка миграций: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
