import { CreateBookingRequestSchema, RidesQuerySchema, SteerDirectionSchema } from '@sharing/shared';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { badRequest, invalidPayload, notFound } from '../http/errors';
import { requireBearerToken } from '../http/context';
import { listInvoiceRowsForUser, listEmailRowsForUser } from '../repo/invoices';
import { findScooterRow } from '../repo/scooters';
import { listRideRowsForUser } from '../repo/rides';
import { toEmailMessage, toInvoice, toRide, toScooter } from '../repo/rows';
import type { AuthService } from '../auth/service';
import type { WsHub } from '../ws/hub';
import type { BookingService } from '../services/booking-service';
import type { RideService } from '../services/ride-service';

const BookingIdParamsSchema = z.object({ id: z.string().min(1) });
const RideIdParamsSchema = z.object({ id: z.string().min(1) });

/** Тело управления самокатом: сторона света, в которую его сдвигают. */
const SteerRequestSchema = z.object({ direction: SteerDirectionSchema });
const StartRideBodySchema = z.object({ bookingId: z.string().min(1) });

export interface SharingRoutesOptions {
  pool: Pool;
  auth: AuthService;
  bookings: BookingService;
  rides: RideService;
  now: () => number;
  /** Хаб подписок: через него клиенты узнают об изменениях, не опрашивая сервер. */
  hub: WsHub;
}

/**
 * Ручки пользовательского сценария: бронь, поездка, история, счета, письма.
 *
 * Все они требуют токен: владельца данных определяет он, а не параметры запроса. Так один
 * пользователь не может ни увидеть чужое, ни отменить чужую бронь, даже зная идентификатор.
 */
export function registerSharingRoutes(app: FastifyInstance, options: SharingRoutesOptions): void {
  const { pool, auth, bookings, rides, now, hub } = options;

  const serverTime = (): string => new Date(now()).toISOString();

  /**
   * Сообщает всем подписчикам, что самокат сменил состояние.
   *
   * Бронь и старт поездки меняют статус самоката — без этого сообщения второй клиент узнал бы о
   * брони только при следующем изменении парка. Так требование «состояние меняется у всех сразу»
   * выполняется не по случайности, а всегда.
   */
  const announceScooter = async (scooterId: string): Promise<void> => {
    const row = await findScooterRow(pool, scooterId);
    if (row === null) {
      return;
    }
    const scooter = toScooter(row);
    hub.broadcastParkDelta([
      {
        id: scooter.id,
        status: scooter.status,
        batteryPct: scooter.batteryPct,
        lat: scooter.lat,
        lng: scooter.lng,
        lastSeenAt: scooter.lastSeenAt,
      },
    ]);
  };

  // ── Брони ───────────────────────────────────────────────────────────────────────────────────
  app.get('/api/bookings/active', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const booking = await bookings.active(user.id);
    return reply.code(200).send({ booking, serverTime: serverTime() });
  });

  app.post('/api/bookings', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = CreateBookingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Не указан самокат');
    }

    const booking = await bookings.create(parsed.data.scooterId, user.id);
    // О брони сообщаем всем: состояние самоката изменилось у всех, кто смотрит карту.
    hub.broadcastBookingCreated(user.id, booking);
    await announceScooter(booking.scooterId);
    return reply.code(201).send({ booking, serverTime: serverTime() });
  });

  app.delete('/api/bookings/:id', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = BookingIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Бронь не найдена');
    }

    const before = await pool.query<{ scooter_id: string }>(
      "SELECT scooter_id FROM bookings WHERE id = $1 AND status = 'active'",
      [parsed.data.id],
    );
    await bookings.cancel(parsed.data.id, user.id);

    const scooterId = before.rows[0]?.scooter_id;
    if (scooterId !== undefined) {
      // Самокат вернулся в парк: об этом должны узнать все, кто смотрит карту.
      await announceScooter(scooterId);
    }
    return reply.code(204).send();
  });

  // ── Поездки ─────────────────────────────────────────────────────────────────────────────────
  app.get('/api/rides/active', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const snapshot = await rides.active(user.id);
    return reply
      .code(200)
      .send(
        snapshot === null
          ? { ride: null, pauses: [], tariff: null, serverTime: serverTime() }
          : { ride: snapshot.ride, pauses: snapshot.pauses, tariff: snapshot.tariff, serverTime: snapshot.serverTime },
      );
  });

  app.post('/api/rides', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = StartRideBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Не указана бронь');
    }

    const snapshot = await rides.start(parsed.data.bookingId, user.id);
    hub.broadcastRideStarted(user.id, snapshot.ride);
    await announceScooter(snapshot.ride.scooterId);
    return reply.code(201).send(snapshot);
  });

  app.post('/api/rides/:id/pause', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RideIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Поездка не найдена');
    }

    return reply.code(200).send(await rides.pause(parsed.data.id, user.id));
  });

  // Самокат вне зоны обслуживания: поездка идёт, время тарифицируется, завершить её там нельзя.
  // Действие сообщает, что самокат вернули в зелёную зону (см. RideService.pushToZone).
  app.post('/api/rides/:id/push-to-zone', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RideIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Поездка не найдена');
    }

    const snapshot = await rides.pushToZone(parsed.data.id, user.id);
    // Положение самоката изменилось — об этом должны узнать все, кто смотрит карту.
    await announceScooter(snapshot.ride.scooterId);
    return reply.code(200).send(snapshot);
  });

  // Управление самокатом в поездке: руль для стенда. Без него нельзя проверить ни выезд за зону
  // обслуживания, ни возврат в неё: симулятор возит самокат сам и всегда внутри зоны.
  app.post('/api/rides/:id/steer', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RideIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Поездка не найдена');
    }

    const body = SteerRequestSchema.safeParse(request.body);
    if (!body.success) {
      throw badRequest('Не понял, куда двигать самокат');
    }

    const snapshot = await rides.steer(parsed.data.id, user.id, body.data['direction']);
    // Самокат сдвинулся — об этом должны узнать все, кто смотрит карту.
    await announceScooter(snapshot.ride.scooterId);
    return reply.code(200).send(snapshot);
  });

  app.post('/api/rides/:id/resume', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RideIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Поездка не найдена');
    }

    return reply.code(200).send(await rides.resume(parsed.data.id, user.id));
  });

  app.post('/api/rides/:id/finish', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RideIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Поездка не найдена');
    }

    const result = await rides.finish(parsed.data.id, user.id);
    hub.broadcastRideFinished(user.id, result.ride, result.invoice, result.serverTime);
    // Поездка закрыта: самокат снова свободен (или уходит в недоступные по заряду).
    await announceScooter(result.ride.scooterId);
    return reply.code(200).send(result);
  });

  app.get('/api/rides', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const parsed = RidesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw invalidPayload('Неверные параметры страницы');
    }

    const page = await listRideRowsForUser(pool, user.id, parsed.data);
    return reply.code(200).send({
      items: page.items.map(toRide),
      total: page.total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  // ── Счета и письма ──────────────────────────────────────────────────────────────────────────
  app.get('/api/invoices', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const rows = await listInvoiceRowsForUser(pool, user.id);
    return reply.code(200).send({ items: rows.map(toInvoice), serverTime: serverTime() });
  });

  app.get('/api/emails', async (request, reply) => {
    const user = await auth.userByAccessToken(requireBearerToken(request));
    const rows = await listEmailRowsForUser(pool, user.id);
    return reply.code(200).send({ items: rows.map(toEmailMessage), serverTime: serverTime() });
  });
}
