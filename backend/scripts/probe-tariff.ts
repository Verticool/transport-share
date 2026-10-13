import { BookingSchema, RideSchema, ScooterSchema } from '@sharing/shared';
import { z } from 'zod';

import { buildApp } from '../src/app.ts';
import { readEnv } from '../src/config/env.ts';
import { createPool } from '../src/db/pool.ts';

/**
 * Диагностика тарификации на живой базе: печатает окно поездки и разбор цены.
 * Запуск: DATABASE_URL=... npx tsx scripts/probe-tariff.ts
 */
const url = process.env['DATABASE_URL'] ?? 'postgres://sharing:sharing@localhost:5433/sharing';
const pool = createPool(readEnv({ DATABASE_URL: url, LOG_LEVEL: 'error', NODE_ENV: 'test' }));
const { app, hub } = buildApp({
  env: readEnv({ DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'error' }),
  pool,
  logger: false,
});

async function scenario(shiftStart: string, withPause: boolean): Promise<void> {
  await pool.query(
    'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE',
  );
  const { seed } = await import('../src/db/seed.ts');
  const { resolveMockDir } = await import('../src/db/mock-dir.ts');
  await seed(pool, resolveMockDir(process.env['MOCK_DIR'] ?? 'mock'));

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'demo@sharing.kg', password: 'demo1234' },
  });
  const headers = { authorization: `Bearer ${z.object({ token: z.string() }).parse(login.json()).token}` };

  const park = await app.inject({ method: 'GET', url: '/api/scooters' });
  const scooters = z.object({ scooters: z.array(ScooterSchema) }).parse(park.json()).scooters;
  const free = scooters.find((scooter) => scooter.status === 'free');
  const booking = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    payload: { scooterId: free?.id },
    headers,
  });
  const bookingId = z.object({ booking: BookingSchema }).parse(booking.json()).booking.id;
  const ride = await app.inject({
    method: 'POST',
    url: '/api/rides',
    payload: { bookingId },
    headers,
  });
  const rideId = z.object({ ride: RideSchema }).parse(ride.json()).ride.id;

  await pool.query(`UPDATE rides SET started_at = date_trunc('second', now()) - interval '${shiftStart}' WHERE id = $1`, [
    rideId,
  ]);
  if (withPause) {
    await app.inject({ method: 'POST', url: `/api/rides/${rideId}/pause`, headers });
    await pool.query(
      "UPDATE ride_pauses SET started_at = date_trunc('second', now()) - interval '5 minutes' WHERE ride_id = $1",
      [rideId],
    );
  }

  const finish = await app.inject({ method: 'POST', url: `/api/rides/${rideId}/finish`, headers });
  const body = z
    .object({ invoice: z.object({ breakdown: z.record(z.string(), z.unknown()) }).optional() })
    .parse(finish.json());
  const times = await pool.query<{ started_at: Date; finished_at: Date }>(
    'SELECT started_at, finished_at FROM rides WHERE id = $1',
    [rideId],
  );
  const row = times.rows[0];
  const seconds =
    row === undefined ? null : (row.finished_at.getTime() - row.started_at.getTime()) / 1000;

  console.log(
    `сдвиг ${shiftStart}, пауза: ${withPause}`,
    '| длина поездки, с:',
    seconds,
    '| разбор:',
    JSON.stringify(body.invoice?.breakdown ?? null),
    '| статус финиша:',
    finish.statusCode,
  );
}

try {
  await scenario('10 minutes', false);
  await scenario('10 minutes 2 seconds', false);
  await scenario('6 minutes', true);
  await scenario('15 minutes', true);
} finally {
  hub.close();
  await app.close();
  await pool.end();
}
