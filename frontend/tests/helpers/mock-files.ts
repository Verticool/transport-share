import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import type { ZodType } from 'zod';

/**
 * Общие приспособления для тестов данных: фронт на стадиях S3–S10 читает `mock/*.json` статикой,
 * поэтому тесты отдают ровно те же файлы, что и настоящий dev-сервер.
 *
 * Путь считается от рабочего каталога vitest (это корень фронтенда): в jsdom `import.meta.url`
 * не является file-ссылкой, и `fileURLToPath` там не работает.
 */
const mockDir = resolve(process.cwd(), '../mock');

export function readMockFile(name: string): string {
  return readFileSync(`${mockDir}/${name}`, 'utf-8');
}

/** Читает файл моков через схему: тесты работают с проверенными данными, без приведений типов. */
export function parseMockFile<T>(name: string, schema: ZodType<T>): T {
  const parsed = schema.safeParse(JSON.parse(readMockFile(name)));
  if (!parsed.success) {
    throw new Error(`мок-файл ${name} не проходит схему`);
  }
  return parsed.data;
}

/** Подменяет сеть одним ответом: код клиента работает с настоящим Response, а не с заглушкой. */
export function stubFetch(body: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(body, { status }))),
  );
}

/** Подменяет сеть набором ответов по путям — там, где клиент запрашивает несколько файлов. */
export function stubFetchRoutes(routes: Record<string, string>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const body = routes[url];
      if (body === undefined) {
        return Promise.resolve(new Response('Не найдено', { status: 404 }));
      }
      return Promise.resolve(new Response(body, { status: 200 }));
    }),
  );
}
