import { isAbsolute, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Каталог мок-данных.
 *
 * `MOCK_DIR` задаётся либо абсолютным путём (так делает docker-compose: `/app/mock`), либо
 * относительно корня репозитория (так удобно локально). Раньше путь считался от каталога
 * `backend`, из-за чего значение `../mock` уводило в родителя проекта — источник данных
 * оказывался за пределами репозитория.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function resolveMockDir(raw: string): string {
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}
