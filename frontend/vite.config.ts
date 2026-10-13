import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * В dev и в Docker фронт и бэк живут на одном origin: dev-сервер проксирует /api и /ws,
 * nginx в контейнере делает то же самое. Поэтому CORS не нужен ни в одном режиме,
 * а фронт всегда обращается к относительным путям.
 *
 * Мок-данные на стадиях S3–S7 берутся из корневого каталога mock/ (общий источник с бэкендом):
 * он подключён как publicDir, поэтому файлы отдаются статикой по /<имя>.json и в dev, и в сборке.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_DEV_API_TARGET'] ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env['VITE_DEV_API_TARGET'] ?? 'http://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  publicDir: fileURLToPath(new URL('../mock', import.meta.url)),
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
