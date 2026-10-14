import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BookingSchema,
  ClientMessageSchema,
  EmailMessageSchema,
  InvoiceSchema,
  RidePauseSchema,
  RideSchema,
  ScooterSchema,
  ServerMessageSchema,
} from '@sharing/shared';
import type { ServerMessage } from '@sharing/shared';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp, type AppBundle } from '../../src/app';
import { readEnv } from '../../src/config/env';
import { migrate, readMigrations } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';
import { seed } from '../../src/db/seed';

/**
 * Интеграционные проверки бэкенда на живой базе.
 *
 * Ручек проверяется не «отвечает ли», а поведение: гонка двух одновременных броней, запрет на
 * чужие данные, один счёт и одно письмо на поездку, автофиниш по заряду, рассылка изменений
 * подписчикам. Ответы разбираются zod-схемами — тест не доверяет форме ответа на слово.
 *
 * Запуск: `TEST_DATABASE_URL=postgres://... npx vitest run`.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const suite = testDatabaseUrl === undefined ? describe.skip : describe;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const mockDir = join(repoRoot, 'mock');
const migrationsDir = join(repoRoot, 'backend', 'migrations');

/** Ответы ручек: те же контракты, что видит фронт. */
const SessionSchema = z.object({
  token: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
});
const ParkSchema = z.object({
  scooters: z.array(ScooterSchema),
  serverTime: z.string(),
  seq: z.number(),
});
const BookingResponseSchema = z.object({
  booking: BookingSchema,
  serverTime: z.string(),
});
const ActiveBookingSchema = z.object({
  booking: z.nullable(BookingSchema),
  serverTime: z.string(),
});
const RideResponseSchema = z.object({
  ride: RideSchema,
  pauses: z.array(RidePauseSchema),
  serverTime: z.string(),
});
const FinishResponseSchema = RideResponseSchema.extend({ invoice: InvoiceSchema });
const RidesPageSchema = z.object({
  items: z.array(RideSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
const InvoicesSchema = z.object({ items: z.array(InvoiceSchema), serverTime: z.string() });
const EmailsSchema = z.object({ items: z.array(EmailMessageSchema), serverTime: z.string() });
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

let bundle: AppBundle;
let pool: ReturnType<typeof createPool>;

/** Свежая база: миграции применены, данные из моков, динамика очищена. */
async function resetData(): Promise<void> {
  await pool.query(
    'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE',
  );
  await seed(pool, mockDir);
}

async function signIn(email = 'demo@sharing.kg'): Promise<{ token: string; refreshToken: string }> {
  const response = await bundle.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'demo1234' },
  });
  expect(response.statusCode).toBe(200);
  const session = SessionSchema.parse(response.json());
  return { token: session.token, refreshToken: session.refreshToken };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Первый свободный самокат из парка. */
async function freeScooter(): Promise<{ id: string; code: string }> {
  const response = await bundle.app.inject({ method: 'GET', url: '/api/scooters' });
  expect(response.statusCode).toBe(200);
  const park = ParkSchema.parse(response.json());
  const free = park.scooters.find((scooter) => scooter.status === 'free');
  if (free === undefined) {
    throw new Error('в парке нет свободного самоката');
  }
  return { id: free.id, code: free.code };
}

function buildBundle(): AppBundle {
  return buildApp({
    env: readEnv({ DATABASE_URL: testDatabaseUrl ?? '', NODE_ENV: 'test', LOG_LEVEL: 'error' }),
    pool,
    logger: false,
  });
}

beforeAll(async () => {
  if (testDatabaseUrl === undefined) {
    return;
  }
  pool = createPool(readEnv({ DATABASE_URL: testDatabaseUrl, LOG_LEVEL: 'error', NODE_ENV: 'test' }));
  await migrate(pool, await readMigrations(migrationsDir));
  bundle = buildBundle();
});

afterAll(async () => {
  if (pool !== undefined) {
    bundle?.hub.close();
    await pool.end();
  }
});

suite('доступность', () => {
  it('отвечает 200 и показывает состояние базы', async () => {
    const response = await bundle.app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = z
      .object({ status: z.string(), db: z.object({ ok: z.boolean(), migrationsApplied: z.number() }) })
      .parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
    expect(body.db.migrationsApplied).toBeGreaterThanOrEqual(2);
  });

  it('неизвестный маршрут отвечает 404 по контракту', async () => {
    const response = await bundle.app.inject({ method: 'GET', url: '/api/нет-такого' });

    expect(response.statusCode).toBe(404);
    expect(ErrorSchema.parse(response.json()).code).toBe('not_found');
  });
});

suite('вход и профиль', () => {
  it('входит по демонстрационному паролю и отдаёт профиль по токену', async () => {
    await resetData();
    const { token } = await signIn();

    const me = await bundle.app.inject({ method: 'GET', url: '/api/me', headers: authHeader(token) });

    expect(me.statusCode).toBe(200);
    const body = z.object({ user: z.object({ email: z.string() }) }).parse(me.json());
    expect(body.user.email).toBe('demo@sharing.kg');
  });

  it('не пускает с неверным паролем и не подсказывает, какая почта есть', async () => {
    const response = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'demo@sharing.kg', password: 'неверный' },
    });
    const unknown = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'demo1234' },
    });

    expect(response.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(ErrorSchema.parse(response.json()).message).toBe(
      ErrorSchema.parse(unknown.json()).message,
    );
  });

  it('регистрирует нового пользователя и запрещает повторную почту', async () => {
    await resetData();
    const email = `user-${randomUUID()}@example.com`;
    const payload = { email, password: 'пароль-123', name: 'Новый' };

    const created = await bundle.app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(created.statusCode).toBe(201);
    expect(SessionSchema.parse(created.json()).user.email).toBe(email);

    const again = await bundle.app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(again.statusCode).toBe(409);
    expect(ErrorSchema.parse(again.json()).code).toBe('conflict');

    const weak = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@example.com', password: '123', name: '' },
    });
    expect(weak.statusCode).toBe(400);
  });

  it('обновляет доступ по токену обновления и гасит сессию при выходе', async () => {
    await resetData();
    const { refreshToken } = await signIn();

    const refreshed = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);

    // Старый токен обновления погашен: повторное использование обязано упасть.
    const reused = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(reused.statusCode).toBe(401);

    const next = SessionSchema.parse(refreshed.json()).refreshToken;
    const logout = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken: next },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: next },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});

suite('парк и зона', () => {
  it('отдаёт 40 самокатов, время сервера и зону обслуживания', async () => {
    await resetData();

    const park = ParkSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json(),
    );
    expect(park.scooters).toHaveLength(40);
    expect(park.seq).toBeGreaterThan(0);

    const zoneResponse = await bundle.app.inject({ method: 'GET', url: '/api/zone' });
    const zone = z.object({ zone: z.object({ name: z.string(), polygon: z.array(z.array(z.number())) }) }).parse(
      zoneResponse.json(),
    );
    expect(zone.zone.name).toContain('Бишкек');
    expect(zone.zone.polygon.length).toBeGreaterThan(2);

    const one = await bundle.app.inject({ method: 'GET', url: `/api/scooters/${park.scooters[0]?.id ?? ''}` });
    expect(one.statusCode).toBe(200);
  });
});

suite('бронь', () => {
  it('требует вход', async () => {
    await resetData();
    const scooter = await freeScooter();

    const response = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
    });

    expect(response.statusCode).toBe(401);
  });

  it('создаёт бронь и показывает самокат занятым', async () => {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    const created = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });
    expect(created.statusCode).toBe(201);
    const booking = BookingResponseSchema.parse(created.json()).booking;
    expect(booking.scooterId).toBe(scooter.id);
    expect(booking.status).toBe('active');
    // Срок брони — 15 минут: это требование ТЗ, а не настройка интерфейса.
    expect(Date.parse(booking.expiresAt) - Date.parse(booking.reservedAt)).toBe(15 * 60_000);

    const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
    expect(park.scooters.find((item) => item.id === scooter.id)?.status).toBe('reserved');
  });

  it('две одновременные брони одного самоката: одна 201, вторая 409', async () => {
    await resetData();
    const first = await signIn('demo@sharing.kg');
    const second = await signIn('alan@example.com');
    const scooter = await freeScooter();

    const responses = await Promise.all([
      bundle.app.inject({
        method: 'POST',
        url: '/api/bookings',
        payload: { scooterId: scooter.id },
        headers: authHeader(first.token),
      }),
      bundle.app.inject({
        method: 'POST',
        url: '/api/bookings',
        payload: { scooterId: scooter.id },
        headers: authHeader(second.token),
      }),
    ]);

    const codes = responses.map((response) => response.statusCode).sort((left, right) => left - right);
    expect(codes).toEqual([201, 409]);

    // В базе ровно одна активная бронь — это гарантия индекса, а не удача планировщика.
    const active = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM bookings WHERE status = 'active'",
    );
    expect(active.rows[0]?.count).toBe('1');
  });

  it('не даёт дважды забронировать одному пользователю и отменить чужую бронь', async () => {
    await resetData();
    const mine = await signIn('demo@sharing.kg');
    const other = await signIn('alan@example.com');
    const scooter = await freeScooter();

    const first = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(mine.token),
    });
    const bookingId = BookingResponseSchema.parse(first.json()).booking.id;

    const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
    const another = park.scooters.find((item) => item.status === 'free');
    if (another === undefined) {
      throw new Error('нужен второй свободный самокат');
    }

    const second = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: another.id },
      headers: authHeader(mine.token),
    });
    expect(second.statusCode).toBe(409);

    const foreignCancel = await bundle.app.inject({
      method: 'DELETE',
      url: `/api/bookings/${bookingId}`,
      headers: authHeader(other.token),
    });
    expect(foreignCancel.statusCode).toBe(404);

    const active = ActiveBookingSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/bookings/active', headers: authHeader(other.token) })).json(),
    );
    expect(active.booking).toBeNull();
  });

  it('снятие брони с пустым телом и типом содержимого: ошибка клиента, а не отказ сервера', async () => {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();
    const created = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });
    const booking = BookingResponseSchema.parse(created.json());

    // Так запрос уходил из интерфейса: без тела, но с `content-type: application/json`.
    // Сервер отвечал 500 «внутренняя ошибка» — деньги и бронь оставались нетронутыми, а клиент
    // не понимал причины. Правильный ответ — отказ по запросу (400), а не отказ сервера.
    const malformed = await bundle.app.inject({
      method: 'DELETE',
      url: `/api/bookings/${booking.booking.id}`,
      headers: { ...authHeader(token), 'content-type': 'application/json' },
      payload: '',
    });
    expect(malformed.statusCode).not.toBe(500);
    expect(malformed.statusCode).toBeLessThan(500);

    // И тот же запрос без лишнего заголовка действительно снимает бронь.
    const proper = await bundle.app.inject({
      method: 'DELETE',
      url: `/api/bookings/${booking.booking.id}`,
      headers: authHeader(token),
    });
    expect(proper.statusCode).toBe(204);

    const active = ActiveBookingSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/bookings/active', headers: authHeader(token) })).json(),
    );
    expect(active.booking).toBeNull();

    const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
    expect(park.scooters.find((item) => item.id === scooter.id)?.status).toBe('free');
  });

  it('снимает бронь по сроку и возвращает самокат в парк', async () => {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });

    // Сдвигаем бронь в прошлое: ждать 15 минут в тесте незачем. Двигаем обе метки — схема
    // требует, чтобы срок был позже момента брони.
    await pool.query(
      "UPDATE bookings SET reserved_at = now() - interval '16 minutes', expires_at = now() - interval '1 minute' WHERE status = 'active'",
    );

    const tick = await bundle.bookings.tick();
    expect(tick.expired).toHaveLength(1);

    const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
    expect(park.scooters.find((item) => item.id === scooter.id)?.status).toBe('free');
  });

  it('предупреждает за три минуты до снятия брони', async () => {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });
    await pool.query(
      "UPDATE bookings SET reserved_at = now() - interval '13 minutes', expires_at = now() + interval '2 minutes' WHERE status = 'active'",
    );

    const tick = await bundle.bookings.tick();

    expect(tick.expiring).toHaveLength(1);
    expect(tick.expiring[0]?.minutesLeft).toBeLessThanOrEqual(3);
    // Повторный тик не должен повторять предупреждение: отметка `notified_at` уже стоит.
    expect((await bundle.bookings.tick()).expiring).toHaveLength(0);
  });
});

suite('поездка', () => {
  /** Общее начало сценариев: вход, бронь, старт. */
  async function startRide(): Promise<{ token: string; rideId: string; scooterId: string }> {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    const booking = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });

    const ride = await bundle.app.inject({
      method: 'POST',
      url: '/api/rides',
      payload: { bookingId: BookingResponseSchema.parse(booking.json()).booking.id },
      headers: authHeader(token),
    });
    expect(ride.statusCode).toBe(201);

    return { token, rideId: RideResponseSchema.parse(ride.json()).ride.id, scooterId: scooter.id };
  }

  it('начинает поездку: бронь израсходована, самокат в поездке', async () => {
    const { token, rideId, scooterId } = await startRide();

    const booking = ActiveBookingSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/bookings/active', headers: authHeader(token) })).json(),
    );
    expect(booking.booking).toBeNull();

    const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
    expect(park.scooters.find((item) => item.id === scooterId)?.status).toBe('in_ride');

    const active = RideResponseSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/rides/active', headers: authHeader(token) })).json(),
    );
    expect(active.ride.id).toBe(rideId);
  });

  it('ставит паузу и продолжает поездку', async () => {
    const { token, rideId } = await startRide();

    const paused = RideResponseSchema.parse(
      (
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/pause`,
          headers: authHeader(token),
        })
      ).json(),
    );
    expect(paused.ride.status).toBe('paused');
    expect(paused.pauses).toHaveLength(1);
    expect(paused.pauses[0]?.endedAt).toBeNull();

    const again = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/pause`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(409);

    const resumed = RideResponseSchema.parse(
      (
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/resume`,
          headers: authHeader(token),
        })
      ).json(),
    );
    expect(resumed.ride.status).toBe('active');
    expect(resumed.pauses[0]?.endedAt).not.toBeNull();
  });

  it('считает езду по тарифу за минуту', async () => {
    const { token, rideId } = await startRide();

    // Десять минут езды без пауз: 25.00 посадка + 10 × 6.00 = 85.00 сом.
    // Старт — на две секунды МЕНЬШЕ десяти минут: время округляется вверх, поэтому «ровно десять»
    // плюс доли секунды до завершения дали бы одиннадцать.
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '9 minutes 58 seconds' WHERE id = $1",
      [rideId],
    );

    const finished = FinishResponseSchema.parse(
      (
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/finish`,
          headers: authHeader(token),
        })
      ).json(),
    );

    expect(finished.invoice.breakdown.rideMinutes).toBe(10);
    expect(finished.invoice.breakdown.pauseMinutes).toBe(0);
    expect(finished.invoice.breakdown.rideAmount).toBe(10 * 600);
    expect(finished.invoice.amount).toBe(2500 + 10 * 600);
    expect(finished.invoice.breakdown.total).toBe(finished.invoice.amount);
  });

  it('тарифицирует паузу по отдельному тарифу и закрывает её при завершении', async () => {
    const { token, rideId } = await startRide();

    // Поездка идёт шесть минут, из них последние пять — пауза: пауза обрезается окном поездки,
    // поэтому старт тоже сдвигаем назад.
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '6 minutes' WHERE id = $1",
      [rideId],
    );
    await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/pause`,
      headers: authHeader(token),
    });
    await pool.query(
      "UPDATE ride_pauses SET started_at = date_trunc('second', now()) - interval '4 minutes 58 seconds' WHERE ride_id = $1",
      [rideId],
    );

    const finished = FinishResponseSchema.parse(
      (
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/finish`,
          headers: authHeader(token),
        })
      ).json(),
    );

    // Пауза 5 минут по 2.00 сом: её закрывает сама финализация — клиент кнопку не нажимает.
    expect(finished.pauses[0]?.endedAt).not.toBeNull();
    expect(finished.invoice.breakdown.pauseMinutes).toBe(5);
    expect(finished.invoice.breakdown.pauseAmount).toBe(5 * 200);
    // Езда при этом не нулевая: сама поездка уже шла, пусть и меньше минуты.
    expect(finished.invoice.breakdown.rideMinutes).toBeGreaterThanOrEqual(1);
    expect(finished.invoice.amount).toBe(
      finished.invoice.breakdown.unlockFee +
        finished.invoice.breakdown.rideAmount +
        finished.invoice.breakdown.pauseAmount,
    );
  });

  it('завершает поездку, выпускает счёт и одно письмо', async () => {
    const { token, rideId } = await startRide();

    const finished = FinishResponseSchema.parse(
      (
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/finish`,
          headers: authHeader(token),
        })
      ).json(),
    );
    expect(finished.ride.status).toBe('finished');
    expect(finished.ride.endReason).toBe('user');
    // Посадка 25.00 сом + первая минута 6.00 сом: время округляется вверх.
    expect(finished.invoice.amount).toBe(3100);

    const again = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/finish`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(409);

    const invoices = InvoicesSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/invoices', headers: authHeader(token) })).json(),
    );
    expect(invoices.items.filter((item) => item.rideId === rideId)).toHaveLength(1);

    const emails = EmailsSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/emails', headers: authHeader(token) })).json(),
    );
    const letters = emails.items.filter((item) => item.dedupeKey === `invoice:${rideId}`);
    expect(letters).toHaveLength(1);
    expect(letters[0]?.toEmail).toBe('demo@sharing.kg');
  });

  it('не даёт завершить поездку вне зоны обслуживания', async () => {
    const { token, rideId, scooterId } = await startRide();

    // Самокат «уехал» за пределы зоны: сервер обязан отказать.
    await pool.query('UPDATE scooters SET lat = 43.5, lng = 74.0 WHERE id = $1', [scooterId]);

    const response = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/finish`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(422);
    expect(ErrorSchema.parse(response.json()).code).toBe('outside_zone');

    const active = RideResponseSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/rides/active', headers: authHeader(token) })).json(),
    );
    expect(active.ride.status).not.toBe('finished');
  });

  it('отдаёт историю страницами и не пускает к чужой поездке', async () => {
    const { token, rideId } = await startRide();
    const other = await signIn('alan@example.com');

    const mine = RidesPageSchema.parse(
      (
        await bundle.app.inject({
          method: 'GET',
          url: '/api/rides?limit=5&offset=0',
          headers: authHeader(token),
        })
      ).json(),
    );
    expect(mine.items).toHaveLength(5);
    expect(mine.total).toBeGreaterThan(5);

    const foreign = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/pause`,
      headers: authHeader(other.token),
    });
    expect(foreign.statusCode).toBe(404);
  });
});

suite('симулятор', () => {
  /** Готовит поездку с заданным зарядом и временем старта. */
  async function rideWithBattery(
    batteryPct: number,
    startedMinutesAgo: number,
  ): Promise<{ token: string; rideId: string; scooterId: string }> {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    const booking = await bundle.app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { scooterId: scooter.id },
      headers: authHeader(token),
    });
    const ride = await bundle.app.inject({
      method: 'POST',
      url: '/api/rides',
      payload: { bookingId: BookingResponseSchema.parse(booking.json()).booking.id },
      headers: authHeader(token),
    });
    const rideId = RideResponseSchema.parse(ride.json()).ride.id;

    await pool.query('UPDATE scooters SET battery_pct = $2 WHERE id = $1', [scooter.id, batteryPct]);
    if (startedMinutesAgo > 0) {
      await pool.query(
        `UPDATE rides SET started_at = now() - ($2 || ' minutes')::interval WHERE id = $1`,
        [rideId, String(startedMinutesAgo)],
      );
    }

    return { token, rideId, scooterId: scooter.id };
  }

  it('двигает и разряжает самокаты, пока идёт поездка', async () => {
    const { scooterId } = await rideWithBattery(80, 0);

    const before = await pool.query<{ lat: number; lng: number; battery_pct: number }>(
      'SELECT lat, lng, battery_pct FROM scooters WHERE id = $1',
      [scooterId],
    );

    // 70 тиков по секунде: больше минуты — расход 1 %/мин обязан уменьшить заряд.
    let moves = 0;
    for (let step = 0; step < 70; step += 1) {
      const changes = await bundle.simulator.tick();
      moves += changes.length > 0 ? 1 : 0;
    }

    const after = await pool.query<{ battery_pct: number; lat: number; lng: number }>(
      'SELECT battery_pct, lat, lng FROM scooters WHERE id = $1',
      [scooterId],
    );

    expect(moves).toBeGreaterThan(0);
    expect(after.rows[0]?.battery_pct ?? 100).toBeLessThan(before.rows[0]?.battery_pct ?? 0);
    expect(after.rows[0]?.lat).not.toBe(before.rows[0]?.lat);
  });

  it('завершает поездку сам при нуле заряда с причиной battery_depleted и одним счётом', async () => {
    const { rideId, token } = await rideWithBattery(1, 2);

    for (let step = 0; step < 80; step += 1) {
      await bundle.simulator.tick();
    }

    const ride = await pool.query<{ status: string; end_reason: string | null; total_amount: string | null }>(
      'SELECT status, end_reason, total_amount FROM rides WHERE id = $1',
      [rideId],
    );
    expect(ride.rows[0]?.status).toBe('finished');
    expect(ride.rows[0]?.end_reason).toBe('battery_depleted');
    expect(Number(ride.rows[0]?.total_amount ?? 0)).toBeGreaterThan(0);

    const invoices = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM invoices WHERE ride_id = $1',
      [rideId],
    );
    expect(invoices.rows[0]?.count).toBe('1');

    // Клиент узнаёт о финише и о счёте без опроса: проверяем через историю.
    const list = RidesPageSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/rides?limit=1&offset=0', headers: authHeader(token) })).json(),
    );
    expect(list.items[0]?.endReason).toBe('battery_depleted');
  });

  it('не двигает свободные самокаты', async () => {
    await resetData();
    // В мок-данных есть самокаты, которые уже едут (у них открытая поездка). Для этой проверки
    // поездки закрываем: она про правило «симулятор трогает только тех, кто в поездке».
    await pool.query(
      "UPDATE rides SET status = 'finished', finished_at = now(), end_reason = 'user', total_amount = 100 WHERE status <> 'finished'",
    );
    await pool.query("UPDATE scooters SET status = 'free' WHERE status = 'in_ride'");

    const changes = await bundle.simulator.tick();
    expect(changes).toEqual([]);
  });
});

suite('WebSocket', () => {
  /** Открывает сокет и собирает разобранные сообщения. */
  async function connect(url: string): Promise<{ socket: WebSocket; messages: ServerMessage[] }> {
    const messages: ServerMessage[] = [];
    const socket = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    socket.on('message', (data: unknown) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(String(data)));
      if (parsed.success) {
        messages.push(parsed.data);
      }
    });

    return { socket, messages };
  }

  it('два подписчика получают одинаковый снапшот и одни и те же изменения парка', async () => {
    await resetData();
    const { token } = await signIn();
    const scooter = await freeScooter();

    const address = await bundle.app.listen({ port: 0, host: '127.0.0.1' });
    bundle.hub.attach(bundle.app.server);
    const wsUrl = `${address.replace('http', 'ws')}/ws`;

    const first = await connect(wsUrl);
    const second = await connect(wsUrl);

    try {
      // Первый подписчик — вошедший пользователь, второй — гость: так проверяется, что
      // персональные события (бронь, поездка) не уходят тому, кто не представился.
      first.socket.send(JSON.stringify(ClientMessageSchema.parse({ type: 'subscribe', token })));
      second.socket.send(JSON.stringify(ClientMessageSchema.parse({ type: 'subscribe' })));

      await new Promise((resolve) => setTimeout(resolve, 400));
      const firstSnapshot = first.messages.find((message) => message.type === 'snapshot');
      const secondSnapshot = second.messages.find((message) => message.type === 'snapshot');
      expect(firstSnapshot?.type).toBe('snapshot');
      expect(secondSnapshot?.type).toBe('snapshot');
      if (firstSnapshot?.type === 'snapshot') {
        expect(firstSnapshot.payload.scooters).toHaveLength(40);
        expect(firstSnapshot.seq).toBeGreaterThan(0);
      }

      // Ping → pong: проверка живости соединения.
      first.socket.send(JSON.stringify(ClientMessageSchema.parse({ type: 'ping', at: Date.now() })));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(first.messages.some((message) => message.type === 'pong')).toBe(true);

      // Поездка и шаг симулятора: изменения парка обязаны прийти обоим одинаково.
      const booking = await bundle.app.inject({
        method: 'POST',
        url: '/api/bookings',
        payload: { scooterId: scooter.id },
        headers: authHeader(token),
      });
      await bundle.app.inject({
        method: 'POST',
        url: '/api/rides',
        payload: { bookingId: BookingResponseSchema.parse(booking.json()).booking.id },
        headers: authHeader(token),
      });
      await bundle.simulator.tick();

      await new Promise((resolve) => setTimeout(resolve, 500));
      const firstDelta = first.messages.find((message) => message.type === 'park.delta');
      const secondDelta = second.messages.find((message) => message.type === 'park.delta');
      expect(firstDelta?.type).toBe('park.delta');
      expect(secondDelta?.type).toBe('park.delta');
      if (firstDelta?.type === 'park.delta' && secondDelta?.type === 'park.delta') {
        expect(firstDelta.changes.length).toBeGreaterThan(0);
        expect(firstDelta.changes.map((change) => change.id)).toEqual(
          secondDelta.changes.map((change) => change.id),
        );
      }

      // Пользователь получил события своей поездки, а второй подписчик без токена — нет.
      expect(
        first.messages.some((message) => message.type === 'booking.created' || message.type === 'ride.started'),
      ).toBe(true);
      expect(
        second.messages.some((message) => message.type === 'booking.created' || message.type === 'ride.started'),
      ).toBe(false);
    } finally {
      first.socket.close();
      second.socket.close();
      await bundle.app.close();
      // Приложение использовалось с открытым портом: для остальных тестов собираем заново.
      bundle = buildBundle();
    }
  });
});
