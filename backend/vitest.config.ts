import { defineConfig } from 'vitest/config';

/**
 * Тесты бэкенда.
 *
 * Тесты, которым нужна база, включаются переменной `TEST_DATABASE_URL`: без неё они пропускаются,
 * чтобы `npm test` работал и без поднятого PostgreSQL. Проверки на живой базе — в `tests/db/`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'threads',
    fileParallelism: false,
  },
});
