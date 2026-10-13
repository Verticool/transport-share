import type { z } from 'zod';
import { describe, it, expect } from 'vitest';

import {
  IsoSchema,
  MinorSchema,
  LatLngSchema,
  PublicUserSchema,
  ScooterSchema,
  BookingSchema,
  RidePauseSchema,
  RideSchema,
  InvoiceBreakdownSchema,
  InvoiceSchema,
  EmailMessageSchema,
  ServiceZoneSchema,
  ApiErrorSchema,
  ServerTimeSchema,
  RegisterRequestSchema,
  RidesQuerySchema,
  PaginatedSchema,
  ClientMessageSchema,
  ServerMessageSchema,
  parseOrThrow,
  safeParseResult,
} from '../src/schemas.ts';
import type {
  PublicUser,
  Scooter,
  Booking,
  RidePause,
  Ride,
  InvoiceBreakdown,
  Invoice,
  EmailMessage,
  ServiceZone,
  Iso,
} from '../src/domain.ts';

// ─── Совместимость схем с типами domain.ts ────────────────────────────────────

const publicUserSchema: z.ZodType<PublicUser> = PublicUserSchema;
const scooterSchema: z.ZodType<Scooter> = ScooterSchema;
const bookingSchema: z.ZodType<Booking> = BookingSchema;
const ridePauseSchema: z.ZodType<RidePause> = RidePauseSchema;
const rideSchema: z.ZodType<Ride> = RideSchema;
const invoiceBreakdownSchema: z.ZodType<InvoiceBreakdown> = InvoiceBreakdownSchema;
const invoiceSchema: z.ZodType<Invoice> = InvoiceSchema;
const emailMessageSchema: z.ZodType<EmailMessage> = EmailMessageSchema;
const serviceZoneSchema: z.ZodType<ServiceZone> = ServiceZoneSchema;
const serverTimeSchema: z.ZodType<{ serverTime: Iso }> = ServerTimeSchema;

describe('type compatibility', () => {
  it('PublicUserSchema is ZodType<PublicUser>', () => { expect(publicUserSchema).toBeDefined(); });
  it('ScooterSchema is ZodType<Scooter>', () => { expect(scooterSchema).toBeDefined(); });
  it('BookingSchema is ZodType<Booking>', () => { expect(bookingSchema).toBeDefined(); });
  it('RidePauseSchema is ZodType<RidePause>', () => { expect(ridePauseSchema).toBeDefined(); });
  it('RideSchema is ZodType<Ride>', () => { expect(rideSchema).toBeDefined(); });
  it('InvoiceBreakdownSchema is ZodType<InvoiceBreakdown>', () => { expect(invoiceBreakdownSchema).toBeDefined(); });
  it('InvoiceSchema is ZodType<Invoice>', () => { expect(invoiceSchema).toBeDefined(); });
  it('EmailMessageSchema is ZodType<EmailMessage>', () => { expect(emailMessageSchema).toBeDefined(); });
  it('ServiceZoneSchema is ZodType<ServiceZone>', () => { expect(serviceZoneSchema).toBeDefined(); });
  it('ServerTimeSchema is ZodType<{ serverTime: Iso }>', () => { expect(serverTimeSchema).toBeDefined(); });
});

describe('доменные объекты', () => {
  it('PublicUserSchema: валидный пример проходит', () => {
    const result = PublicUserSchema.safeParse({
      id: 'u1', email: 'a@b.co', name: 'X',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('PublicUserSchema: отсутствует обязательное поле — падает', () => {
    const result = PublicUserSchema.safeParse({ id: 'u1' });
    expect(result.success).toBe(false);
  });

  it('PublicUserSchema: неверный тип поля — падает', () => {
    const result = PublicUserSchema.safeParse({
      id: 'u1', email: 'not-an-email', name: 'X',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('ScooterSchema: валидный пример проходит', () => {
    const result = ScooterSchema.safeParse({
      id: 's1', code: 'SC-001', model: 'Ninebot',
      status: 'free', batteryPct: 80,
      lat: 42.8746, lng: 74.5698,
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('ScooterSchema: absent required field — fails', () => {
    const result = ScooterSchema.safeParse({ id: 's1' });
    expect(result.success).toBe(false);
  });

  it('BookingSchema: валидный пример проходит', () => {
    const result = BookingSchema.safeParse({
      id: 'b1', userId: 'u1', scooterId: 's1',
      status: 'active',
      reservedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:15:00.000Z',
      notifiedAt: null, closedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('RidePauseSchema: absent required field — fails', () => {
    const result = RidePauseSchema.safeParse({ id: 'rp1' });
    expect(result.success).toBe(false);
  });

  it('RideSchema: валидный пример проходит', () => {
    const result = RideSchema.safeParse({
      id: 'r1', userId: 'u1', scooterId: 's1', bookingId: 'b1',
      status: 'finished',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:10:00.000Z',
      endReason: 'user',
      distanceM: 1200,
      totalAmount: 8500,
      currency: 'KGS',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('InvoiceSchema: валидный пример проходит', () => {
    const result = InvoiceSchema.safeParse({
      id: 'i1', rideId: 'r1', userId: 'u1',
      amount: 8500, currency: 'KGS',
      breakdown: { unlockFee: 2500, rideMinutes: 10, rideAmount: 6000, pauseMinutes: 0, pauseAmount: 0, total: 8500 },
      issuedAt: '2026-01-01T00:10:00.000Z',
      createdAt: '2026-01-01T00:10:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('EmailMessageSchema: валидный пример проходит', () => {
    const result = EmailMessageSchema.safeParse({
      id: 'e1', userId: 'u1', toEmail: 'a@b.co',
      subject: 'Hi', body: 'Hello',
      dedupeKey: 'd1',
      sentAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('ServiceZoneSchema: polygon >= 3 точек проходит', () => {
    const result = ServiceZoneSchema.safeParse({
      name: 'Test',
      polygon: [[0, 0], [1, 0], [0, 1]],
    });
    expect(result.success).toBe(true);
  });

  it('ServiceZoneSchema: polygon < 3 точек падает', () => {
    const result = ServiceZoneSchema.safeParse({
      name: 'Test',
      polygon: [[0, 0], [1, 0]],
    });
    expect(result.success).toBe(false);
  });

  it('ApiErrorSchema: валидный пример проходит', () => {
    const result = ApiErrorSchema.safeParse({ code: 'ERR', message: 'bad' });
    expect(result.success).toBe(true);
  });

  it('ApiErrorSchema: optional details — проходит', () => {
    const result = ApiErrorSchema.safeParse({ code: 'ERR', message: 'bad', details: { field: 'value' } });
    expect(result.success).toBe(true);
  });

  it('ServerTimeSchema: валидный пример проходит', () => {
    const result = ServerTimeSchema.safeParse({ serverTime: '2026-01-01T00:00:00.000Z' });
    expect(result.success).toBe(true);
  });
});

describe('batteryPct', () => {
  it('0 проходит', () => { expect(ScooterSchema.safeParse({ ...scooterSample(), batteryPct: 0 }).success).toBe(true); });
  it('100 проходит', () => { expect(ScooterSchema.safeParse({ ...scooterSample(), batteryPct: 100 }).success).toBe(true); });
  it('-1 падает', () => { expect(ScooterSchema.safeParse({ ...scooterSample(), batteryPct: -1 }).success).toBe(false); });
  it('101 падает', () => { expect(ScooterSchema.safeParse({ ...scooterSample(), batteryPct: 101 }).success).toBe(false); });
});

describe('MinorSchema', () => {
  it('0 проходит', () => { expect(MinorSchema.safeParse(0).success).toBe(true); });
  it('3100 проходит', () => { expect(MinorSchema.safeParse(3100).success).toBe(true); });
  it('31.5 падает (не целое)', () => { expect(MinorSchema.safeParse(31.5).success).toBe(false); });
  it('-1 падает', () => { expect(MinorSchema.safeParse(-1).success).toBe(false); });
});

describe('IsoSchema', () => {
  it('2026-10-13T10:00:00.000Z проходит', () => { expect(IsoSchema.safeParse('2026-10-13T10:00:00.000Z').success).toBe(true); });
  it('13.10.2026 падает', () => { expect(IsoSchema.safeParse('13.10.2026').success).toBe(false); });
  it('2026-10-13T10:00:00 (без Z) падает', () => { expect(IsoSchema.safeParse('2026-10-13T10:00:00').success).toBe(false); });
});

describe('LatLngSchema', () => {
  it('центр Бишкека проходит', () => {
    const result = LatLngSchema.safeParse({ lat: 42.8746, lng: 74.5698 });
    expect(result.success).toBe(true);
  });
  it('lat 95 падает', () => { expect(LatLngSchema.safeParse({ lat: 95, lng: 0 }).success).toBe(false); });
  it('lng 200 падает', () => { expect(LatLngSchema.safeParse({ lat: 0, lng: 200 }).success).toBe(false); });
});

describe('RegisterRequestSchema', () => {
  it('короткий пароль (7 символов) падает', () => {
    const result = RegisterRequestSchema.safeParse({ email: 'a@b.co', password: '1234567', name: 'X' });
    expect(result.success).toBe(false);
  });
  it('невалидный email падает', () => {
    const result = RegisterRequestSchema.safeParse({ email: 'not-email', password: '12345678', name: 'X' });
    expect(result.success).toBe(false);
  });
  it('валидный проходит', () => {
    const result = RegisterRequestSchema.safeParse({ email: 'a@b.co', password: '12345678', name: 'X' });
    expect(result.success).toBe(true);
  });
});

describe('RidesQuerySchema', () => {
  it('без параметров даёт limit=20, offset=0', () => {
    const result = RidesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) { expect(result.data.limit).toBe(20); expect(result.data.offset).toBe(0); }
  });
  it('limit=101 падает', () => { expect(RidesQuerySchema.safeParse({ limit: 101 }).success).toBe(false); });
  it('строка "10" — не число, падает (без coerce)', () => {
    const result = RidesQuerySchema.safeParse({ limit: '10' });
    expect(result.success).toBe(false);
  });
});

describe('PaginatedSchema', () => {
  it('валидная страница проходит', () => {
    const schema = PaginatedSchema(ScooterSchema);
    const result = schema.safeParse({
      items: [{ id: 's1', code: 'SC-001', model: 'Ninebot', status: 'free', batteryPct: 80, lat: 42.8746, lng: 74.5698, lastSeenAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      total: 1,
      limit: 20,
      offset: 0,
    });
    expect(result.success).toBe(true);
  });
  it('отрицательный total падает', () => {
    const schema = PaginatedSchema(ScooterSchema);
    const result = schema.safeParse({ items: [], total: -1, limit: 20, offset: 0 });
    expect(result.success).toBe(false);
  });
});

describe('WS-протокол', () => {
  it('валидный ping проходит', () => {
    const result = ClientMessageSchema.safeParse({ type: 'ping', at: 1791899135000 });
    expect(result.success).toBe(true);
  });
  it('неизвестный type падает', () => {
    const result = ClientMessageSchema.safeParse({ type: 'unknown' });
    expect(result.success).toBe(false);
  });
  it('park.delta без changes падает', () => {
    const result = ServerMessageSchema.safeParse({ type: 'park.delta', seq: 1, sentAt: 0, serverTime: '2026-01-01T00:00:00.000Z' });
    expect(result.success).toBe(false);
  });
  it('parseServerMessage на валидном снапшоте возвращает объект с type snapshot', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'snapshot',
      seq: 1, sentAt: 0, serverTime: '2026-01-01T00:00:00.000Z',
      payload: { scooters: [], myBooking: null, myRide: null, serverTime: '2026-01-01T00:00:00.000Z' },
    });
    expect(result.success).toBe(true);
    if (result.success) { expect(result.data.type).toBe('snapshot'); }
  });
  it('null на ServerMessageSchema бросает ZodError', () => {
    expect(() => ServerMessageSchema.parse(null)).toThrow();
  });
  it('строка на ServerMessageSchema бросает ZodError', () => {
    expect(() => ServerMessageSchema.parse('hello')).toThrow();
  });
  it('{} на ServerMessageSchema бросает ZodError (нет обязательного type)', () => {
    expect(() => ServerMessageSchema.parse({})).toThrow();
  });
  it('ride.tick не проходит как booking.expired (дискриминатор работает)', () => {
    const tick = { type: 'ride.tick', seq: 1, sentAt: 0, serverTime: '2026-01-01T00:00:00.000Z', rideId: 'r1', status: 'active', rideMinutes: 1, pauseMinutes: 0, amountSoFar: 600, currency: 'KGS' };
    const result = ServerMessageSchema.safeParse(tick);
    expect(result.success).toBe(true);
    if (result.success) { expect(result.data.type).not.toBe('booking.expired'); }
  });
});

describe('safeParseResult', () => {
  it('на валидных данных возвращает ok: true с типизированным value', () => {
    const result = safeParseResult(ScooterSchema, scooterSample());
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.value.id).toBe('s1'); }
  });
  it('на невалидных данных возвращает ok: false и непустую строку error', () => {
    const result = safeParseResult(ScooterSchema, null);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.length).toBeGreaterThan(0); }
  });
});

describe('parseOrThrow', () => {
  it('на валидных данных возвращает значение', () => {
    const result = parseOrThrow(ScooterSchema, scooterSample(), 'scooter');
    expect(result.id).toBe('s1');
  });
  it('сообщение об ошибке содержит what', () => {
    let thrown = false;
    try { parseOrThrow(ScooterSchema, null, 'scooter'); } catch (e) {
      thrown = true;
      if (e instanceof Error) { expect(e.message).toContain('scooter'); }
    }
    expect(thrown).toBe(true);
  });
});

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function scooterSample(): Record<string, unknown> {
  return {
    id: 's1', code: 'SC-001', model: 'Ninebot',
    status: 'free' as const, batteryPct: 80,
    lat: 42.8746, lng: 74.5698,
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
