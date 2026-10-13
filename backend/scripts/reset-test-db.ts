import { readEnv } from '../src/config/env';
import { resolveMockDir } from '../src/db/mock-dir';
import { createPool } from '../src/db/pool';
import { seed } from '../src/db/seed';

/**
 * Сброс тестовой базы к исходному состоянию: `npm run db:reset-test`.
 *
 * Нужен сквозным проверкам: они оформляют брони и закрывают поездки, поэтому второй прогон на
 * «грязной» базе начинался бы с чужой активной брони и проверял не то, что задумано. Скрипт
 * доступен только для локальной базы и не должен запускаться на рабочей (см. RUNBOOK.md).
 */
const env = readEnv();
const mockDir = resolveMockDir(env.MOCK_DIR);

const pool = createPool(env);

try {
  // Полная очистка: сид вставляет данные заново, а прежние записи с теми же почтами и кодами
  // приводили к нарушению уникальности (проверено: повторный сброс падал на users_email_lower_key).
  await pool.query(
    'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE',
  );
  const report = await seed(pool, mockDir, (message) => {
    process.stdout.write(`${message}\n`);
  });
  process.stdout.write(`база сброшена и наполнена: ${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`ошибка сброса: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
