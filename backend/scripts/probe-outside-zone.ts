import { BookingSchema, RideSchema, ScooterSchema } from '@sharing/shared';
import { z } from 'zod';

import { buildApp } from '../src/app.ts';
import { readEnv } from '../src/config/env.ts';
import { createPool } from '../src/db/pool.ts';

/**
 * Диагностика автофиниша: самокат вне зоны должен закрываться сервисом.
 * Запуск: DATABASE_URL=... npx tsx scripts/probe-outside-zone.ts
 */
const url = process.env['DATABASE_URL'] ?? 'postgres://sharing:sharing@localhost:5433/sharing';
const pool = createPool(readEnv({ DATABASE_URL: url, LOG_LEVEL: 'error', NODE_ENV: 'test' }));
const { app, hub, simulator } = buildApp({
  env: readEnv({ DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'error' }),
  pool,
  logger: false,
});

try {
  await pool.query(
    'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE',
  );
  const { seed } = await import('../src/db/seed.ts');
  await seed(pool, process.env['MOCK_DIR'] ?? '../mock');

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
  const ride = await app.inject({ method: 'POST', url: '/api/rides', payload: { bookingId }, headers });
  const rideId = z.object({ ride: RideSchema }).parse(ride.json()).ride.id;

  await pool.query('UPDATE scooters SET lat = 43.5, lng = 74.0 WHERE id = $1', [free?.id]);
  console.log('самокат перенесён за пределы зоны');

  const changes = await simulator.tick();
  console.log('изменений парка за тик:', changes.length);

  const after = await pool.query<{ status: string; end_reason: string | null }>(
    'SELECT status, end_reason FROM rides WHERE id = $1',
    [rideId],
  );
  console.log('поездка после тика:', JSON.stringify(after.rows[0]));

  const direct = await pool.query<{ lat: number; lng: number }>('SELECT lat, lng FROM scooters WHERE id = $1', [
    free?.id,
  ]);
  console.log('координаты самоката в базе:', JSON.stringify(direct.rows[0]));
} catch (error) {
  console.error('диагностика упала:', error);
} finally {
  hub.close();
  await app.close();
  await pool.end();
}
