import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Формат идентификаторов в мок-данных.
 *
 * Тест появился после найденного дефекта: генератор выдавал 8-6-6-16 вместо канонических
 * 8-4-4-4-12, и фронт этого не замечал — для него идентификатор просто строка. Первый же перенос
 * в PostgreSQL это вскрыл. Проверка держит связь «мок-данные пригодны для базы», чтобы дефект
 * не вернулся при перегенерации.
 */
const here = dirname(fileURLToPath(import.meta.url));
const mockDir = join(here, '..', '..', '..', 'mock');

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readRows(name: string): Promise<Record<string, unknown>[]> {
  const parsed: unknown = JSON.parse(await readFile(join(mockDir, name), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${name}: ожидался массив записей`);
  }
  return parsed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null);
}

/** Поля, которые ссылаются на другие записи, тоже обязаны быть UUID: их проверяет внешний ключ. */
const REFERENCE_FIELDS = ['id', 'userId', 'scooterId', 'rideId'] as const;

describe('идентификаторы мок-данных', () => {
  it('все идентификаторы и ссылки — канонические UUID версии 4', async () => {
    const files = ['users.json', 'scooters.json', 'rides.json', 'invoices.json', 'emails.json'];

    const bad: string[] = [];
    let checked = 0;

    for (const file of files) {
      for (const row of await readRows(file)) {
        for (const field of REFERENCE_FIELDS) {
          const value = row[field];
          if (typeof value !== 'string') {
            continue;
          }
          checked += 1;
          if (!UUID_V4.test(value)) {
            bad.push(`${file}: ${field}=${value}`);
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });

  it('ссылки указывают на существующие записи', async () => {
    const users = new Set((await readRows('users.json')).map((row) => String(row['id'])));
    const scooters = new Set((await readRows('scooters.json')).map((row) => String(row['id'])));
    const rides = new Set((await readRows('rides.json')).map((row) => String(row['id'])));

    for (const ride of await readRows('rides.json')) {
      expect(users.has(String(ride['userId']))).toBe(true);
      expect(scooters.has(String(ride['scooterId']))).toBe(true);
    }
    for (const invoice of await readRows('invoices.json')) {
      expect(rides.has(String(invoice['rideId']))).toBe(true);
      expect(users.has(String(invoice['userId']))).toBe(true);
    }
    for (const email of await readRows('emails.json')) {
      expect(users.has(String(email['userId']))).toBe(true);
    }
  });
});
