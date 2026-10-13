import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnv } from '../config/env';
import { createPool } from './pool';
import { seed } from './seed';

/**
 * Наполнение базы мок-данными: `npm run seed`.
 * В docker-compose вызывается одноразовым сервисом после миграций; повторный запуск безопасен.
 */
const here = dirname(fileURLToPath(import.meta.url));
const env = readEnv();
const mockDir = resolve(join(here, '..', '..'), env.MOCK_DIR);

const pool = createPool(env);

try {
  const report = await seed(pool, mockDir, (message) => {
    process.stdout.write(`${message}\n`);
  });
  process.stdout.write(`сид завершён: ${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`ошибка сида: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
