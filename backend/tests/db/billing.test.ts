import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BookingSchema,
  DEFAULT_TARIFF,
  EmailMessageSchema,
  InvoiceSchema,
  RideSchema,
  SERVICE_ZONE,
  ScooterSchema,
  calcRidePrice,
  isInsideZone,
} from '@sharing/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp, type AppBundle } from '../../src/app';
import { RidePauseRowSchema, RideRowSchema, toRide, toRidePause } from '../../src/repo/rows';
import { readEnv } from '../../src/config/env';
import { migrate, readMigrations } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';
import { seed } from '../../src/db/seed';

/**
 * Тарификация и счета на живой базе.
 *
 * Домен уже проверяет таблицу цен; здесь проверяется другое: что сервер считает именно по этой
 * таблице, что повторная финализация не выпускает второй счёт и второе письмо, что при автофинише
 * письмо объясняет причину и что суммы счетов сходятся с их разбором без потерь.
 *
 * Запуск: `TEST_DATABASE_URL=postgres://... npx vitest run`.
 */
const testDatabaseUrl = process.env['TEST_DATABASE_URL'];
const suite = testDatabaseUrl === undefined ? describe.skip : describe;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const mockDir = join(repoRoot, 'mock');
const migrationsDir = join(repoRoot, 'backend', 'migrations');

const SessionSchema = z.object({ token: z.string() });
const ParkSchema = z.object({ scooters: z.array(ScooterSchema) });
const BookingResponseSchema = z.object({ booking: BookingSchema });
const RideResponseSchema = z.object({ ride: RideSchema, serverTime: z.string() });
const FinishResponseSchema = RideResponseSchema.extend({ invoice: InvoiceSchema });
const InvoiceListSchema = z.object({ items: z.array(InvoiceSchema) });
const EmailListSchema = z.object({ items: z.array(EmailMessageSchema) });
const ErrorSchema = z.object({ code: z.string() });

let bundle: AppBundle;
let pool: ReturnType<typeof createPool>;

beforeAll(async () => {
  if (testDatabaseUrl === undefined) {
    return;
  }
  pool = createPool(readEnv({ DATABASE_URL: testDatabaseUrl, LOG_LEVEL: 'error', NODE_ENV: 'test' }));
  await migrate(pool, await readMigrations(migrationsDir));
  bundle = buildApp({
    env: readEnv({ DATABASE_URL: testDatabaseUrl, NODE_ENV: 'test', LOG_LEVEL: 'error' }),
    pool,
    logger: false,
  });
});

afterAll(async () => {
  if (pool !== undefined) {
    bundle?.hub.close();
    await pool.end();
  }
});

/** Чистая база и вошедший пользователь: каждое списание считается с нуля. */
async function reset(): Promise<string> {
  await pool.query(
    'TRUNCATE ride_points, ride_events, ride_pauses, invoices, emails, rides, bookings, sessions, scooters, users CASCADE',
  );
  await seed(pool, mockDir);

  const login = await bundle.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'demo@sharing.kg', password: 'demo1234' },
  });
  return SessionSchema.parse(login.json()).token;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function freeScooterId(): Promise<string> {
  const park = ParkSchema.parse((await bundle.app.inject({ method: 'GET', url: '/api/scooters' })).json());
  const free = park.scooters.find((scooter) => scooter.status === 'free');
  if (free === undefined) {
    throw new Error('в парке нет свободного самоката');
  }
  return free.id;
}

/** Доводит поездку до состояния «идёт» и возвращает её идентификатор. */
async function startRide(token: string): Promise<{ rideId: string; scooterId: string }> {
  const scooterId = await freeScooterId();
  const booking = await bundle.app.inject({
    method: 'POST',
    url: '/api/bookings',
    payload: { scooterId },
    headers: auth(token),
  });
  const ride = await bundle.app.inject({
    method: 'POST',
    url: '/api/rides',
    payload: { bookingId: BookingResponseSchema.parse(booking.json()).booking.id },
    headers: auth(token),
  });
  return { rideId: RideResponseSchema.parse(ride.json()).ride.id, scooterId };
}

async function finish(token: string, rideId: string): Promise<z.infer<typeof FinishResponseSchema>> {
  const response = await bundle.app.inject({
    method: 'POST',
    url: `/api/rides/${rideId}/finish`,
    headers: auth(token),
  });
  expect(response.statusCode).toBe(200);
  return FinishResponseSchema.parse(response.json());
}

/** Разбор счёта из тела ответа, приведённый к эталонной формуле из DOMAIN.md §5. */
function expectedTotal(rideMinutes: number, pauseMinutes: number): number {
  return DEFAULT_TARIFF.unlockFee + rideMinutes * DEFAULT_TARIFF.ridePerMinute + pauseMinutes * DEFAULT_TARIFF.pausePerMinute;
}

suite('таблица цен из DOMAIN.md', () => {
  it('короткая поездка: одна минута езды и посадка — 31.00 сом', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);

    const finished = await finish(token, rideId);

    expect(finished.invoice.breakdown.rideMinutes).toBe(1);
    expect(finished.invoice.breakdown.pauseMinutes).toBe(0);
    expect(finished.invoice.amount).toBe(3100);
    expect(finished.invoice.amount).toBe(expectedTotal(1, 0));
  });

  it('поездка 61 секунда: две минуты езды — 37.00 сом', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '61 seconds' WHERE id = $1",
      [rideId],
    );

    const finished = await finish(token, rideId);

    expect(finished.invoice.breakdown.rideMinutes).toBe(2);
    expect(finished.invoice.amount).toBe(3700);
  });

  it('поездка 15 минут: 115.00 сом', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '14 minutes 58 seconds' WHERE id = $1",
      [rideId],
    );

    const finished = await finish(token, rideId);

    expect(finished.invoice.breakdown.rideMinutes).toBe(15);
    expect(finished.invoice.breakdown.pauseMinutes).toBe(0);
    expect(finished.invoice.amount).toBe(11500);
  });

  it('пауза считается по своему тарифу и не входит в езду', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);

    // Поездка идёт 6 минут, последние 4:58 из них — пауза.
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '6 minutes' WHERE id = $1",
      [rideId],
    );
    await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/pause`,
      headers: auth(token),
    });
    await pool.query(
      "UPDATE ride_pauses SET started_at = date_trunc('second', now()) - interval '4 minutes 58 seconds' WHERE ride_id = $1",
      [rideId],
    );

    const finished = await finish(token, rideId);

    // Езда: минута до паузы и минута после неё (время округляется вверх на каждом отрезке).
    expect(finished.invoice.breakdown.pauseMinutes).toBe(5);
    expect(finished.invoice.breakdown.pauseAmount).toBe(5 * DEFAULT_TARIFF.pausePerMinute);
    expect(finished.invoice.breakdown.rideMinutes).toBeGreaterThanOrEqual(1);
    expect(finished.invoice.amount).toBe(
      finished.invoice.breakdown.unlockFee +
        finished.invoice.breakdown.rideAmount +
        finished.invoice.breakdown.pauseAmount,
    );
  });

  it('считает цену той же функцией домена, что и раньше интерфейс', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);
    await pool.query(
      "UPDATE rides SET started_at = date_trunc('second', now()) - interval '9 minutes 30 seconds' WHERE id = $1",
      [rideId],
    );

    const finished = await finish(token, rideId);

    // Сверка «в лоб»: берём сохранённую поездку и её паузы, считаем доменной функцией на момент
    // завершения — числа обязаны совпасть до тыйына. Строки приводим теми же мапперами, что и код
    // приложения, иначе получилось бы «сравнение разных типов».
    const rideRow = await pool.query('SELECT * FROM rides WHERE id = $1', [rideId]);
    const pauseRows = await pool.query('SELECT * FROM ride_pauses WHERE ride_id = $1', [rideId]);
    const recomputed = calcRidePrice(
      toRide(RideRowSchema.parse(rideRow.rows[0])),
      pauseRows.rows.map((row: unknown) => toRidePause(RidePauseRowSchema.parse(row))),
      Date.parse(finished.ride.finishedAt ?? finished.serverTime),
      DEFAULT_TARIFF,
    );

    expect(recomputed.total).toBe(finished.invoice.amount);
    expect(recomputed.rideMinutes).toBe(finished.invoice.breakdown.rideMinutes);
  });
});

suite('счета и письма', () => {
  it('повторное завершение не выпускает второй счёт и второе письмо', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);

    const first = await finish(token, rideId);

    const again = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/finish`,
      headers: auth(token),
    });
    expect(again.statusCode).toBe(409);
    expect(ErrorSchema.parse(again.json()).code).toBe('conflict');

    // Принудительная финализация (как из симулятора) тоже не должна создать второй счёт.
    await bundle.rides.finishAutomatically(rideId, 'battery_depleted');

    const invoices = InvoiceListSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/invoices', headers: auth(token) })).json(),
    );
    expect(invoices.items.filter((item) => item.rideId === rideId)).toHaveLength(1);

    const emails = EmailListSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/emails', headers: auth(token) })).json(),
    );
    expect(emails.items.filter((item) => item.dedupeKey === `invoice:${rideId}`)).toHaveLength(1);

    const inDatabase = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM invoices WHERE ride_id = $1',
      [rideId],
    );
    expect(inDatabase.rows[0]?.count).toBe('1');
    expect(first.invoice.amount).toBeGreaterThan(0);
  });

  it('письмо при автофинише по разряду объясняет причину', async () => {
    const token = await reset();
    const { rideId, scooterId } = await startRide(token);

    await pool.query('UPDATE scooters SET battery_pct = 1 WHERE id = $1', [scooterId]);
    await pool.query("UPDATE rides SET started_at = now() - interval '3 minutes' WHERE id = $1", [rideId]);

    for (let step = 0; step < 80; step += 1) {
      await bundle.simulator.tick();
    }

    const emails = EmailListSchema.parse(
      (await bundle.app.inject({ method: 'GET', url: '/api/emails', headers: auth(token) })).json(),
    );
    const letter = emails.items.find((item) => item.dedupeKey === `invoice:${rideId}`);

    expect(letter).toBeDefined();
    expect(letter?.body).toContain('закончился заряд');
    expect(letter?.subject.startsWith('Счёт за поездку')).toBe(true);
  });

  it('пауза выключает мотор: самокат не двигается и не тратит заряд', async () => {
    const token = await reset();
    const { rideId, scooterId } = await startRide(token);

    const paused = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/pause`,
      headers: auth(token),
    });
    expect(paused.statusCode).toBe(200);

    const positionBefore = await pool.query<{ lat: number; lng: number; battery_pct: number }>(
      'SELECT lat, lng, battery_pct FROM scooters WHERE id = $1',
      [scooterId],
    );
    // Несколько тиков: на паузе самокат стоит на месте и заряд не расходует — иначе «пауза»
    // двигала бы технику и жгла батарею, хотя мотор выключен.
    for (let i = 0; i < 5; i += 1) {
      await bundle.simulator.tick();
    }
    const positionAfter = await pool.query<{ lat: number; lng: number; battery_pct: number }>(
      'SELECT lat, lng, battery_pct FROM scooters WHERE id = $1',
      [scooterId],
    );
    expect(positionAfter.rows[0]?.lat).toBe(positionBefore.rows[0]?.lat);
    expect(positionAfter.rows[0]?.lng).toBe(positionBefore.rows[0]?.lng);
    expect(positionAfter.rows[0]?.battery_pct).toBe(positionBefore.rows[0]?.battery_pct);

    // Руль на паузе тоже не работает: мотор выключен.
    const steer = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/steer`,
      payload: { direction: 'north' },
      headers: auth(token),
    });
    expect(steer.statusCode).toBe(409);
  });

  it('руль двигает самокат: этим проверяют выезд за зону и возврат', async () => {
    const token = await reset();
    const { rideId, scooterId } = await startRide(token);

    const before = await pool.query<{ lat: number; lng: number }>(
      'SELECT lat, lng FROM scooters WHERE id = $1',
      [scooterId],
    );
    const steer = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/steer`,
      payload: { direction: 'north' },
      headers: auth(token),
    });
    expect(steer.statusCode).toBe(200);

    const after = await pool.query<{ lat: number; lng: number }>(
      'SELECT lat, lng FROM scooters WHERE id = $1',
      [scooterId],
    );
    // Шаг 20 м на север: широта растёт, долгота почти не меняется.
    expect((after.rows[0]?.lat ?? 0) - (before.rows[0]?.lat ?? 0)).toBeGreaterThan(0.0001);
    expect(Math.abs((after.rows[0]?.lng ?? 0) - (before.rows[0]?.lng ?? 0))).toBeLessThan(0.0001);

    // Неизвестная сторона — понятная ошибка, а не 500.
    const wrong = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/steer`,
      payload: { direction: 'вверх' },
      headers: auth(token),
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('самокат вне зоны: мотор работает, поездка идёт, завершить нельзя до возврата в зону', async () => {
    const token = await reset();
    const { rideId, scooterId } = await startRide(token);

    // Самокат выехал за границу зоны. Мотор при этом работает: самокат едет (человек может
    // вернуться своим ходом), но завершить поездку за границей нельзя — иначе клиент закрывал бы
    // поездку, оставив самокат неизвестно где.
    await pool.query('UPDATE scooters SET lat = 43.5, lng = 74.0 WHERE id = $1', [scooterId]);
    const positionBefore = await pool.query<{ lat: number; lng: number }>(
      'SELECT lat, lng FROM scooters WHERE id = $1',
      [scooterId],
    );
    await bundle.simulator.tick();

    const afterTick = await pool.query<{ status: string; end_reason: string | null }>(
      'SELECT status, end_reason FROM rides WHERE id = $1',
      [rideId],
    );
    expect(afterTick.rows[0]?.status).toBe('active');
    expect(afterTick.rows[0]?.end_reason).toBeNull();

    // Симулятор ведёт самокат обратно в зону: мотор включён, самокат не стоит мёртво.
    const positionAfter = await pool.query<{ lat: number; lng: number }>(
      'SELECT lat, lng FROM scooters WHERE id = $1',
      [scooterId],
    );
    expect(
      (positionAfter.rows[0]?.lat ?? 0) !== positionBefore.rows[0]?.lat ||
        (positionAfter.rows[0]?.lng ?? 0) !== positionBefore.rows[0]?.lng,
    ).toBe(true);

    // Завершить поездку здесь нельзя: сначала самокат должен оказаться в зоне.
    const finishOutside = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(finishOutside.statusCode).toBe(422);

    // Действие «дотолкать» возвращает самокат в зону, после чего поездку можно завершить.
    const pushed = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/push-to-zone`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pushed.statusCode).toBe(200);

    const inside = await pool.query<{ lat: number; lng: number; status: string }>(
      'SELECT lat, lng, status FROM scooters WHERE id = $1',
      [scooterId],
    );
    expect(
      isInsideZone(
        { lat: inside.rows[0]?.lat ?? 0, lng: inside.rows[0]?.lng ?? 0 },
        SERVICE_ZONE,
      ),
    ).toBe(true);

    const finish = await bundle.app.inject({
      method: 'POST',
      url: `/api/rides/${rideId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(finish.statusCode).toBe(200);
  });

  it('на ста случайных поездках суммы счетов совпадают с разбором, потерь нет', async () => {
    const token = await reset();

    // Сто поездок: длительности и паузы разные, округление времени работает в обе стороны.
    for (let index = 0; index < 100; index += 1) {
      const { rideId } = await startRide(token);

      const rideSeconds = (index % 37) * 17 + index; // от 0 до ~600 секунд
      await pool.query(
        `UPDATE rides SET started_at = date_trunc('second', now()) - ($2 || ' seconds')::interval WHERE id = $1`,
        [rideId, String(rideSeconds)],
      );

      if (index % 3 === 0) {
        await bundle.app.inject({
          method: 'POST',
          url: `/api/rides/${rideId}/pause`,
          headers: auth(token),
        });
        const pauseSeconds = (index % 11) * 13;
        await pool.query(
          `UPDATE ride_pauses SET started_at = date_trunc('second', now()) - ($2 || ' seconds')::interval WHERE ride_id = $1`,
          [rideId, String(pauseSeconds)],
        );
      }

      await finish(token, rideId);
    }

    const totals = await pool.query<{ invoices: string; breakdowns: string; rides: string }>(`
      SELECT
        (SELECT count(*)::text FROM invoices) AS invoices,
        (SELECT count(*)::text FROM rides WHERE status = 'finished') AS rides,
        (SELECT coalesce(sum((breakdown ->> 'total')::bigint), 0)::text FROM invoices) AS breakdowns
    `);
    const sums = await pool.query<{ amounts: string }>(
      'SELECT coalesce(sum(amount), 0)::text AS amounts FROM invoices',
    );

    // Каждая завершённая поездка получает ровно один счёт, и сумма счётов равна сумме разборов.
    expect(totals.rows[0]?.invoices).toBe(totals.rows[0]?.rides);
    expect(sums.rows[0]?.amounts).toBe(totals.rows[0]?.breakdowns);

    const letters = await pool.query<{ keys: string; total: string }>(`
      SELECT count(DISTINCT dedupe_key)::text AS keys, count(*)::text AS total FROM emails
    `);
    expect(letters.rows[0]?.keys).toBe(letters.rows[0]?.total);
    expect(Number(letters.rows[0]?.total ?? 0)).toBeGreaterThanOrEqual(100);
  });

  it('за каждую поездку списывается посадка ровно один раз', async () => {
    const token = await reset();
    const { rideId } = await startRide(token);

    const finished = await finish(token, rideId);

    const invoiceRow = await pool.query<{ breakdown: { unlockFee: number } }>(
      'SELECT breakdown FROM invoices WHERE ride_id = $1',
      [rideId],
    );
    expect(invoiceRow.rows[0]?.breakdown.unlockFee).toBe(DEFAULT_TARIFF.unlockFee);

    // Посадка входит в счёт один раз: отдельного списания за бронь не появляется.
    const breakdown = finished.invoice.breakdown;
    const sumOfParts =
      breakdown.unlockFee + breakdown.rideAmount + breakdown.pauseAmount;
    expect(sumOfParts).toBe(finished.invoice.amount);
    expect(breakdown.unlockFee).toBe(DEFAULT_TARIFF.unlockFee);
  });
});
