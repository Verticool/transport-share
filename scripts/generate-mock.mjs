/**
 * Использует mulberry32 с фиксированным seed для воспроизводимости.
 * Результат: mock/service-zone.json, mock/users.json, mock/scooters.json,
 *           mock/rides.json, mock/invoices.json, mock/emails.json.
 *
 * Запуск:  node scripts/generate-mock.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { SERVICE_ZONE, FLEET, DEFAULT_TARIFF } from '../shared/src/constants.ts';
import { toIso } from '../shared/src/time.ts';
import { randomPointInZone } from '../shared/src/zone.ts';
import { calcRidePrice } from '../shared/src/money.ts';

// ─── Mulberry32 — детерминированный генератор псевдослучайных чисел ──────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 42;

// ─── Утилиты ──────────────────────────────────────────────────────────────────

/** Детерминированный UUID v4-подобный из seed + счётчика. */
function uid(counter) {
  const hex = (n) => String(n.toString(16).padStart(2, '0'));
  const seedBytes = mulberry32(SEED + counter)();
  const b0 = Math.floor(seedBytes * 256);
  const b1 = Math.floor(mulberry32(SEED + counter + 1)() * 256);
  const b2 = Math.floor(mulberry32(SEED + counter + 2)() * 256);
  const b3 = Math.floor(mulberry32(SEED + counter + 3)() * 256);
  const b4 = 0; void b4;
  const b5 = Math.floor(mulberry32(SEED + counter + 5)() * 256);
  const b6 = Math.floor(mulberry32(SEED + counter + 6)() * 256);
  const b7 = Math.floor(mulberry32(SEED + counter + 7)() * 256);
  const b8 = Math.floor(mulberry32(SEED + counter + 8)() * 256);
  const b9 = Math.floor(mulberry32(SEED + counter + 9)() * 256);
  const b10 = Math.floor(mulberry32(SEED + counter + 10)() * 256);
  const b11 = Math.floor(mulberry32(SEED + counter + 11)() * 256);
  const b12 = Math.floor(mulberry32(SEED + counter + 12)() * 256);
  const b13 = Math.floor(mulberry32(SEED + counter + 13)() * 256);
  const b14 = Math.floor(mulberry32(SEED + counter + 14)() * 256);
  const b15 = Math.floor(mulberry32(SEED + counter + 15)() * 256);
  // version 4, variant 1
  const v = ((b0 & 0x0f) | 0x40).toString(16);
  const lv = ((b1 & 0x3f) | 0x80).toString(16);
  return `${hex(b0)}${hex(b1)}${hex(b2)}${hex(b3)}-${v}${lv}${hex(b5)}-${hex(b6)}${hex(b7)}-${hex(b8)}${hex(b9)}${hex(b10)}${hex(b11)}${hex(b12)}${hex(b13)}${hex(b14)}${hex(b15)}`;
}

/** Целое [a, b]. */
function randInt(a, b, rng) {
  return Math.floor(rng() * (b - a + 1)) + a;
}

/** Случайный элемент массива. */
function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Генерация ────────────────────────────────────────────────────────────────

export function generateMock() {
  const rng = mulberry32(SEED);
  let uidCounter = 0;
  const now = Date.UTC(2026, 9, 13, 12, 0, 0); // 2026-10-13T12:00:00Z — «сегодня»
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;

  // ── service-zone ─────────────────────────────────────────────────────────
  const serviceZone = {
    name: SERVICE_ZONE.name,
    polygon: SERVICE_ZONE.polygon,
  };

  // ── users ────────────────────────────────────────────────────────────────
  const users = [
    {
      id: uid(uidCounter++),
      email: 'demo@sharing.kg',
      name: 'Демо',
      createdAt: toIso(thirtyDaysAgo),
      updatedAt: toIso(thirtyDaysAgo),
    },
    {
      id: uid(uidCounter++),
      email: 'alan@example.com',
      name: 'Алан',
      createdAt: toIso(thirtyDaysAgo + 1_000_000_000),
      updatedAt: toIso(thirtyDaysAgo + 1_000_000_000),
    },
    {
      id: uid(uidCounter++),
      email: 'bora@example.com',
      name: 'Бора',
      createdAt: toIso(thirtyDaysAgo + 2_000_000_000),
      updatedAt: toIso(thirtyDaysAgo + 2_000_000_000),
    },
    {
      id: uid(uidCounter++),
      email: 'dina@example.com',
      name: 'Дина',
      createdAt: toIso(thirtyDaysAgo + 3_000_000_000),
      updatedAt: toIso(thirtyDaysAgo + 3_000_000_000),
    },
    {
      id: uid(uidCounter++),
      email: 'erik@example.com',
      name: 'Эрик',
      createdAt: toIso(thirtyDaysAgo + 4_000_000_000),
      updatedAt: toIso(thirtyDaysAgo + 4_000_000_000),
    },
    {
      id: uid(uidCounter++),
      email: 'fiza@example.com',
      name: 'Физа',
      createdAt: toIso(thirtyDaysAgo + 5_000_000_000),
      updatedAt: toIso(thirtyDaysAgo + 5_000_000_000),
    },
  ];

  // ── scooters ─────────────────────────────────────────────────────────────
  // Распределение: 19 free, 6 reserved, 5 in_ride, 10 unavailable.
  // ≥10 unavailable с batteryPct < LOW_BATTERY_THRESHOLD.
  const STATUS_DIST = /** @type {const} */ ([
    ...Array(19).fill('free'),
    ...Array(6).fill('reserved'),
    ...Array(5).fill('in_ride'),
    ...Array(10).fill('unavailable'),
  ]);

  const scooters = FLEET.models.flatMap((model) =>
    Array.from({ length: 10 }, (_, i) => {
      const idx = FLEET.models.indexOf(model) * 10 + i + 1;
      const code = `SC-${String(idx).padStart(3, '0')}`;
      const status = STATUS_DIST[idx - 1];
      const point = randomPointInZone(SERVICE_ZONE, rng);
      const createdAt = toIso(thirtyDaysAgo + idx * 100_000);
      const updatedAt = toIso(thirtyDaysAgo + idx * 100_000 + 60_000);
      const lastSeenAt = toIso(now - (40 - idx) * 60_000);

      let batteryPct;
      if (status === 'unavailable') {
        // все unavailable будут иметь batteryPct < 20
        batteryPct = randInt(0, 19, rng);
      } else if (status === 'in_ride') {
        batteryPct = randInt(25, 90, rng);
      } else {
        // free / reserved: >= 20
        batteryPct = randInt(20, 100, rng);
      }

      return {
        id: uid(uidCounter++),
        code,
        model,
        status,
        batteryPct,
        lat: point.lat,
        lng: point.lng,
        lastSeenAt,
        createdAt,
        updatedAt,
      };
    }),
  );

  // ── rides ────────────────────────────────────────────────────────────────
  // 25 завершённых поездок с паузами и без.
  const rides = [];
  const invoices = [];
  const emails = [];

  // Доступные scooters для rides (только free / in_ride)
  const rideableScooterIds = scooters
    .filter((s) => s.status === 'free' || s.status === 'in_ride')
    .map((s) => s.id);

  for (let i = 0; i < 25; i++) {
    const rideStartMs = now - (i + 1) * 3600_000 + randInt(0, 1800_000, rng);
    const durationMin = randInt(3, 40, rng);
    const rideEndMs = rideStartMs + durationMin * 60_000;

    const startedAt = toIso(rideStartMs);
    const finishedAt = toIso(rideEndMs);

    // Паузы: 30% поездок имеют паузу 1-3 мин
    const hasPause = rng() < 0.3;
    const pauses = [];
    if (hasPause) {
      const pauseStartOffset = randInt(60, durationMin - 2, rng) * 1000;
      const pauseMinutes = randInt(1, 3, rng);
      pauses.push({
        startedAt: toIso(rideStartMs + pauseStartOffset),
        endedAt: toIso(rideStartMs + pauseStartOffset + pauseMinutes * 60_000),
      });
    }

    const breakdown = calcRidePrice(
      { startedAt, finishedAt },
      pauses,
      rideEndMs,
      DEFAULT_TARIFF,
    );

    const scooterId = pick(rideableScooterIds, rng);
    const userId = pick(users.map((u) => u.id), rng);

    const rideId = uid(uidCounter++);
    const bookingId = uid(uidCounter++);

    rides.push({
      id: rideId,
      userId,
      scooterId,
      bookingId,
      status: 'finished',
      startedAt,
      finishedAt,
      endReason: pick(['user', 'battery_depleted', 'service'], rng),
      distanceM: randInt(800, 5000, rng),
      totalAmount: breakdown.total,
      currency: DEFAULT_TARIFF.currency,
      createdAt: toIso(rideStartMs - 10_000),
      updatedAt: toIso(rideEndMs + 10_000),
    });

    invoices.push({
      id: uid(uidCounter++),
      rideId,
      userId,
      amount: breakdown.total,
      currency: DEFAULT_TARIFF.currency,
      breakdown,
      issuedAt: finishedAt,
      createdAt: toIso(rideEndMs + 5_000),
    });

    const user = users.find((u) => u.id === userId);
    const scooter = scooters.find((s) => s.id === scooterId);
    emails.push({
      id: uid(uidCounter++),
      userId,
      toEmail: user.email,
      subject: `Счёт за поездку ${scooter.code}`,
      body: `Спасибо за поездку! Итого: ${Math.floor(breakdown.total / 100)}.${String(breakdown.total % 100).padStart(2, '0')} сом. Время в пути: ${breakdown.rideMinutes} мин, паузы: ${breakdown.pauseMinutes} мин.`,
      dedupeKey: `invoice:${rideId}`,
      createdAt: toIso(rideEndMs - 1_000),
      sentAt: finishedAt,
    });
  }

  // ── сервис-зона (дублирует SERVICE_ZONE, но как отдельный JSON) ───────────
  return {
    serviceZone,
    users,
    scooters,
    rides,
    invoices,
    emails,
  };
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

const data = generateMock();

const mockDir = join(process.cwd(), 'mock');
mkdirSync(mockDir, { recursive: true });

const files = /** @type {const} */ ([
  ['service-zone.json', data.serviceZone],
  ['users.json', data.users],
  ['scooters.json', data.scooters],
  ['rides.json', data.rides],
  ['invoices.json', data.invoices],
  ['emails.json', data.emails],
]);

for (const [name, value] of files) {
  const content = JSON.stringify(value, null, 2);
  writeFileSync(join(mockDir, name), content, 'utf8');
  console.log(`wrote mock/${name}: ${content.split('\n').length} строк`);
}

console.log(`\nитого записей: users=${data.users.length}, scooters=${data.scooters.length}, rides=${data.rides.length}, invoices=${data.invoices.length}, emails=${data.emails.length}`);
console.log('готово.');
