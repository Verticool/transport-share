import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Подготовка состояния перед сквозными проверками по реальному стеку.
 *
 * База приводится к исходному состоянию до прогона: проверки оформляют брони и закрывают поездки,
 * поэтому без сброса второй прогон начинался бы с чужой активной брони.
 */
export default function globalSetup(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..', '..');
  const databaseUrl =
    process.env['TEST_DATABASE_URL'] ?? 'postgres://sharing:sharing@localhost:5433/sharing';

  // `shell: true` — потому что npm на Windows это файл npm.cmd, а execFileSync без оболочки
  // ищет только исполняемые файлы и падает с ENOENT.
  execFileSync('npm', ['run', 'db:reset-test', '-w', 'backend'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl, MOCK_DIR: 'mock' },
  });
}
