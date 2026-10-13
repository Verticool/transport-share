import { defineConfig, devices } from '@playwright/test';

/**
 * Прогон e2e по реальному стеку: фронт + настоящий сервер + PostgreSQL.
 *
 * Отличия от основного конфига: фронт поднимается с `VITE_API_MODE=http` (данные приходят с
 * сервера, а не из моков), а сервер стартует рядом и подключается к базе из `DATABASE_URL`.
 */
const DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://sharing:sharing@localhost:5433/sharing';
const FRONTEND_PORT = 5174;

export default defineConfig({
  testDir: './e2e-live',
  // База приводится к исходному состоянию до прогона: проверки оформляют брони и закрывают поездки.
  globalSetup: './e2e-live/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    // `localhost`, а не 127.0.0.1: dev-сервер Vite слушает localhost (IPv6 ::1) и на IPv4 не отвечает.
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    channel: 'msedge',
    locale: 'ru-RU',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'edge-live', use: { ...devices['Desktop Edge'] } }],
  webServer: [
    {
      // Сервер поднимает тот же код, что и в контейнере; база уже поднята compose-ом.
      // Команда выполняется из корня монорепозитория: workspace-скрипты там и живут.
      command: 'npm run dev -w backend',
      cwd: '..',
      url: 'http://127.0.0.1:8080/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        MOCK_DIR: 'mock',
        PORT: '8080',
        LOG_LEVEL: 'warn',
        // Тики чаще, чем в проде: тест не должен ждать 5 секунд до снятия брони.
        SIM_TICK_MS: '500',
        BOOKING_TICK_MS: '1000',
      },
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_API_MODE: 'http',
        VITE_DEV_API_TARGET: 'http://127.0.0.1:8080',
      },
    },
  ],
});
