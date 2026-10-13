import { BookingSchema, RideSchema, ScooterSchema } from '@sharing/shared';
import { z } from 'zod';

import { buildApp } from '../src/app.ts';
import { readEnv } from '../src/config/env.ts';
import { createPool } from '../src/db/pool.ts';

/**
 * Диагностика ручек на живой базе: показывает сырой ответ финиша поездки.
 * Запуск: DATABASE_URL=... 
 */
const url = process.env['DATABASE_URL'] ?? 'postgres://sharing:sharing@localhost:5433/sharing';
const pool = createPool(readEnv({ DATABASE_URL: url, LOG_LEVEL: 'error', NODE_ENV: 'test' }));
const { app, hub, bookings } = buildApp({
  env: readEnv({ DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'error' }),
  pool,
  logger: true,
});

try {
  await pool.query('TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE');
  const { seed } = await import('../src/db/seed.ts');
  const { resolveMockDir } = await import('../src/db/mock-dir.ts');
  await seed(pool, resolveMockDir(process.env['MOCK_DIR'] ?? 'mock'));

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'demo@sharing.kg', password: 'demo1234' },
  });
  const token = z.object({ token: z.string() }).parse(login.json()).token;
  const headers = { authorization: `Bearer ${token}` };

  const park = await app.inject({ method: 'GET', url: '/api/scooters' });
  const scooters = z.object({ scooters: z.array(ScooterSchema) }).parse(park.json()).scooters;
  const free = scooters.find((scooter) => scooter.status === 'free');
  console.log('свободный самокат:', free?.code);

  const booking = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    payload: { scooterId: free?.id },
    headers,
  });
  const bookingBody = z.object({ booking: BookingSchema }).parse(booking.json());
  console.log('бронь:', booking.statusCode, bookingBody.booking.id);

  const ride = await app.inject({
    method: 'POST',
    url: '/api/rides',
    payload: { bookingId: bookingBody.booking.id },
    headers,
  });
  const rideBody = z.object({ ride: RideSchema }).parse(ride.json());
  console.log('старт:', ride.statusCode, rideBody.ride.id);

  const rideId = rideBody.ride.id;
  const finish = await app.inject({ method: 'POST', url: `/api/rides/${rideId}/finish`, headers });
  console.log('финиш:', finish.statusCode);
  console.log('тело финиша:', JSON.stringify(finish.json()).slice(0, 400));

  // Проверяем тик броней и симулятор на живой базе.
  console.log('тик броней:', JSON.stringify(await bookings.tick()));
} catch (error) {
  console.error('диагностика упала:', error);
} finally {
  hub.close();
  await app.close();
  await pool.end();
}
