import type { Booking, Invoice, Iso, Ride, Scooter, User } from '../domain.ts';
import { toIso } from '../time.ts';

/**
 * Хелперы и фабрики для тестов.
 *
 * Зачем: `noUncheckedIndexedAccess` делает `items[0]` типом `T | undefined`, и соблазн закрыть это
 * `items[0]!` велик — но `!` запрещён рулсетом (§F.1), потому что прячет возможный undefined вместо
 * его обработки. В тестах же отсутствие элемента — это ошибка самого теста, поэтому здесь она
 * превращается в явное исключение с понятным текстом.
 */

/** Достаёт элемент массива, гарантированно не undefined. Заменяет `items[i]!` в тестах. */
export function mustGet<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`mustGet: элемента с индексом ${index} нет (длина массива ${items.length})`);
  }
  return item;
}

/** Возвращает значение, если оно не null/undefined, иначе бросает исключение. */
export function mustBeDefined<T>(value: T | null | undefined, what = 'значение'): T {
  if (value === null || value === undefined) {
    throw new Error(`mustBeDefined: ${what} отсутствует`);
  }
  return value;
}

/** ISO-строка из unix ms — для читаемых фикстур. */
export function fixedIso(ms: number): Iso {
  return toIso(ms);
}

const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);

export function makeScooter(overrides: Partial<Scooter> = {}): Scooter {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SC-001',
    model: 'Ninebot Max G30',
    status: 'free',
    batteryPct: 87,
    lat: 42.8746,
    lng: 74.5698,
    lastSeenAt: toIso(T0),
    createdAt: toIso(T0),
    updatedAt: toIso(T0),
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'rider@example.com',
    name: 'Тестовый райдер',
    createdAt: toIso(T0),
    updatedAt: toIso(T0),
    ...overrides,
  };
}

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    userId: makeUser().id,
    scooterId: makeScooter().id,
    status: 'active',
    reservedAt: toIso(T0),
    expiresAt: toIso(T0 + 15 * 60 * 1000),
    notifiedAt: null,
    closedAt: null,
    createdAt: toIso(T0),
    updatedAt: toIso(T0),
    ...overrides,
  };
}

export function makeRide(overrides: Partial<Ride> = {}): Ride {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId: makeUser().id,
    scooterId: makeScooter().id,
    bookingId: makeBooking().id,
    status: 'active',
    startedAt: toIso(T0),
    finishedAt: null,
    endReason: null,
    distanceM: 0,
    totalAmount: null,
    currency: 'KGS',
    createdAt: toIso(T0),
    updatedAt: toIso(T0),
    ...overrides,
  };
}

export function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    rideId: makeRide().id,
    userId: makeUser().id,
    amount: 3100,
    currency: 'KGS',
    breakdown: {
      unlockFee: 2500,
      rideMinutes: 1,
      rideAmount: 600,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 3100,
    },
    issuedAt: toIso(T0 + 60_000),
    createdAt: toIso(T0 + 60_000),
    ...overrides,
  };
}
