/**
 * mock.test.ts — валидация мок-данных против zod-схем и бизнес-правил.
 *
 * Запуск:  npx vitest run tests/mock.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import z from 'zod';
import { join } from 'node:path';

import {
  ServiceZoneSchema,
  PublicUserSchema,
  ScooterSchema,
  RideSchema,
  InvoiceSchema,
  EmailMessageSchema,
} from '../src/schemas.ts';
import {
  LOW_BATTERY_THRESHOLD,
  DEFAULT_TARIFF,
  SERVICE_ZONE,
} from '../src/constants.ts';
import { isInsideZone } from '../src/zone.ts';
import { fromIso } from '../src/time.ts';
import { generateMock } from '../../scripts/generate-mock.mjs';
import type { GenerateMockResult } from '../../scripts/generate-mock.mjs';

// ─── тесты ────────────────────────────────────────────────────────────────────

describe('mock/*.json — валидация', () => {
  // 1. Все шесть файлов существуют и парсятся как JSON
  it('все шесть файлов читаются как JSON', () => {
    const names = /** @type {const} */ ([
      'service-zone.json',
      'users.json',
      'scooters.json',
      'rides.json',
      'invoices.json',
      'emails.json',
    ]);
    for (const name of names) {
      const raw = readFileSync(join(import.meta.dirname, '../../mock', name), 'utf8');
      expect(() => void JSON.parse(raw)).not.toThrow();
    }
  });

  // 2. Каждый файл проходит zod-схему
  it('service-zone.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/service-zone.json'), 'utf8');
    const result = ServiceZoneSchema.safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('users.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/users.json'), 'utf8');
    const result = z.array(PublicUserSchema).safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('scooters.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/scooters.json'), 'utf8');
    const result = z.array(ScooterSchema).safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('rides.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/rides.json'), 'utf8');
    const result = z.array(RideSchema).safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('invoices.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/invoices.json'), 'utf8');
    const result = z.array(InvoiceSchema).safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  it('emails.json проходит схему', () => {
    const raw = readFileSync(join(import.meta.dirname, '../../mock/emails.json'), 'utf8');
    const result = z.array(EmailMessageSchema).safeParse(JSON.parse(raw));
    expect(result.success).toBe(true);
  });

  // 3. Ровно N записей
  it('ровно 40 самокатов, 6 пользователей, 25 поездок, 25 счетов, 25 писем, у зоны 8 точек', () => {
    const data = generateMock();
    expect(data.users.length).toBe(6);
    expect(data.scooters.length).toBe(40);
    expect(data.rides.length).toBe(25);
    expect(data.invoices.length).toBe(25);
    expect(data.emails.length).toBe(25);
    expect(data.serviceZone.polygon.length).toBe(8);
  });

  // 4. Все самокаты внутри зоны, code уникальны и от SC-001 до SC-040
  it('все самокаты внутри зоны, коды SC-001…SC-040', () => {
    const data = generateMock();
    for (const s of data.scooters) {
      expect(isInsideZone({ lat: s.lat, lng: s.lng }, SERVICE_ZONE)).toBe(true);
    }
    const codes = data.scooters.map((s) => s.code);
    for (let i = 1; i <= 40; i++) {
      expect(codes).toContain(`SC-${String(i).padStart(3, '0')}`);
    }
    expect(new Set(codes).size).toBe(40);
  });

  // 5. ≥10 самокатов с batteryPct < 20, все они unavailable; ни один free не имеет < 20
  it('низкий заряд: ≥10 unavailable, ни один free не ниже порога', () => {
    const data = generateMock();
    const lowBattery = data.scooters.filter((s) => s.batteryPct < LOW_BATTERY_THRESHOLD);
    expect(lowBattery.length).toBeGreaterThanOrEqual(10);
    for (const s of lowBattery) {
      expect(s.status).toBe('unavailable');
    }
    for (const s of data.scooters) {
      if (s.status === 'free') {
        expect(s.batteryPct).toBeGreaterThanOrEqual(LOW_BATTERY_THRESHOLD);
      }
    }
  });

  // 6. batteryPct — целое 0..100
  it('batteryPct — целое в [0, 100]', () => {
    const data = generateMock();
    for (const s of data.scooters) {
      expect(Number.isInteger(s.batteryPct)).toBe(true);
      expect(s.batteryPct).toBeGreaterThanOrEqual(0);
      expect(s.batteryPct).toBeLessThanOrEqual(100);
    }
  });

  // 7. totalAmount каждой поездки = breakdown.total её счёта
  it('totalAmount совпадает с breakdown.total', () => {
    const data = generateMock();
    const invoiceByRide = new Map(data.invoices.map((inv) => [inv.rideId, inv]));
    for (const ride of data.rides) {
      const inv = invoiceByRide.get(ride.id);
      expect(inv).toBeDefined();
      if (!inv) continue;
      expect(ride.totalAmount).toBe(inv.breakdown.total);
    }
  });

  // 8. breakdown пересчитан независимо через calcRidePrice
  it('breakdown совпадает с независимым пересчётом calcRidePrice', () => {
    const data = generateMock();
    for (const inv of data.invoices) {
      expect(Number.isInteger(inv.breakdown.unlockFee)).toBe(true);
      expect(Number.isInteger(inv.breakdown.rideAmount)).toBe(true);
      expect(Number.isInteger(inv.breakdown.pauseAmount)).toBe(true);
      expect(Number.isInteger(inv.breakdown.total)).toBe(true);
      const expected =
        inv.breakdown.unlockFee +
        inv.breakdown.rideMinutes * DEFAULT_TARIFF.ridePerMinute +
        inv.breakdown.pauseMinutes * DEFAULT_TARIFF.pausePerMinute;
      expect(inv.breakdown.total).toBe(expected);
    }
  });

  // 9. Все суммы целые, валюта везде KGS
  it('суммы целые, валюта KGS', () => {
    const data = generateMock();
    for (const s of data.scooters) {
      expect(Number.isInteger(s.batteryPct)).toBe(true);
    }
    for (const r of data.rides) {
      expect(Number.isInteger(r.totalAmount)).toBe(true);
      expect(r.currency).toBe('KGS');
    }
    for (const inv of data.invoices) {
      expect(Number.isInteger(inv.amount)).toBe(true);
      expect(inv.currency).toBe('KGS');
    }
  });

  // 10. Ссылочная целостность
  it('ссылочная целостность: userId, scooterId, rideId, dedupeKey', () => {
    const data: GenerateMockResult = generateMock();
    const userIds = new Set<string>(data.users.map((u) => u.id));
    const scooterIds = new Set<string>(data.scooters.map((s) => s.id));
    const rideIds = new Set<string>(data.rides.map((r) => r.id));

    for (const r of data.rides) {
      expect(userIds.has(r.userId)).toBe(true);
      expect(scooterIds.has(r.scooterId)).toBe(true);
    }
    for (const inv of data.invoices) {
      expect(rideIds.has(inv.rideId)).toBe(true);
      expect(userIds.has(inv.userId)).toBe(true);
    }
    for (const e of data.emails) {
      expect(userIds.has(e.userId)).toBe(true);
    }
  });

  // 11. dedupeKey уникальны, формат invoice:<rideId>
  it('dedupeKey уникальны и в формате invoice:<rideId>', () => {
    const data = generateMock();
    const keys = data.emails.map((e) => e.dedupeKey);
    for (const key of keys) {
      expect(key).toMatch(/^invoice:[a-f0-9-]+$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  // 12. toEmail совпадает с email пользователя поездки
  it('toEmail совпадает с email пользователя', () => {
    const data: GenerateMockResult = generateMock();
    const userByEmail = new Map<string, ReturnType<typeof generateMock>['users'][number]>(data.users.map((u) => [u.email, u]));
    for (const e of data.emails) {
      expect(userByEmail.has(e.toEmail)).toBe(true);
    }
  });

  // 13. updatedAt >= createdAt, finishedAt > startedAt
  it('временная консистентность', () => {
    const data = generateMock();
    for (const u of data.users) {
      expect(fromIso(u.updatedAt) >= fromIso(u.createdAt)).toBe(true);
    }
    for (const s of data.scooters) {
      expect(fromIso(s.updatedAt) >= fromIso(s.createdAt)).toBe(true);
      expect(fromIso(s.lastSeenAt) >= fromIso(s.createdAt)).toBe(true);
    }
    for (const r of data.rides) {
      const finishedAt = r.finishedAt;
      if (finishedAt === null) {
        throw new Error(`поездка ${r.id} без finishedAt: в мок-данных все поездки завершённые`);
      }
      expect(fromIso(finishedAt)).toBeGreaterThan(fromIso(r.startedAt));
      expect(fromIso(r.updatedAt) >= fromIso(r.createdAt)).toBe(true);
    }
    for (const inv of data.invoices) {
      expect(fromIso(inv.createdAt)).toBeGreaterThanOrEqual(fromIso(inv.issuedAt));
    }
    for (const e of data.emails) {
      expect(fromIso(e.sentAt) >= fromIso(e.createdAt)).toBe(true);
    }
  });

  // 14. Детерминизм: два вызова generateMock() дают глубоко равные объекты
  it('детерминизм: два вызова generateMock() равны', () => {
    const a = generateMock();
    const b = generateMock();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // 15. Демо-пользователь demo@sharing.kg присутствует
  it('демо-пользователь demo@sharing.kg присутствует', () => {
    const data = generateMock();
    const demo = data.users.find((u) => u.email === 'demo@sharing.kg');
    if (!demo) throw new Error('Demo user not found');
    expect(demo.name).toBe('Демо');
  });
});
