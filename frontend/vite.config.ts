import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * В dev и в Docker фронт и бэк живут на одном origin: dev-сервер проксирует /api и /ws,
 * nginx в контейнере делает то же самое. Поэтому CORS не нужен ни в одном режиме,
 * а фронт всегда обращается к относительным путям.
 *
 * Мок-данные берутся из корневого каталога mock/ (общий источник с бэкендом) и подключаются как
 * publicDir: файлы отдаются статикой по /<имя>.json. Это нужно только в режиме моков — в режиме
 * сервера состояние приходит из API, и раскладывать те же данные файлами в собранной статике
 * незачем (проверяется сборкой контейнера).
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
  publicDir:
    (process.env['VITE_API_MODE'] ?? 'mock') === 'http'
      ? false
      : fileURLToPath(new URL('../mock', import.meta.url)),
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
