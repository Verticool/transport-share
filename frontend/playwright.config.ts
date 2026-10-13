import { defineConfig, devices } from '@playwright/test';

/**
 * Настройки e2e-прогона.
 *
 * Браузер — установленный в системе Edge (`channel`): отдельный Chromium не скачивается, потому что
 * проверяем поведение, а не движок. Дев-сервер поднимается сам, но если он уже запущен — берётся он же.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'msedge',
    locale: 'ru-RU',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
