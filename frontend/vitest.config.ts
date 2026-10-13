import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Тесты фронта. Пакет `shared` подключён и через npm workspaces, и явным alias:
 * alias совпадает с paths в tsconfig.json, поэтому редактор и сборка видят одно и то же.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sharing/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    reporters: ['default'],
  },
});
