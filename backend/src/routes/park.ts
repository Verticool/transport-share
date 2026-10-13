import { SERVICE_ZONE } from '@sharing/shared';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { BookingService } from '../services/booking-service';
import { notFound } from '../http/errors';
import { listScooters } from '../repo/scooters';

const ScooterIdParamsSchema = z.object({ id: z.string().min(1) });

export interface ParkRoutesOptions {
  pool: Pool;
  bookingService: BookingService;
  now: () => number;
  nextSeq: () => number;
}

/**
 * Парк и зона обслуживания — открытые данные: их видит любой, кто открыл карту, без входа.
 * Активная бронь пользователя отдаётся отдельной ручкой и только по токену.
 */
export function registerParkRoutes(app: FastifyInstance, options: ParkRoutesOptions): void {
  const { pool, now, nextSeq, bookingService } = options;

  app.get('/api/scooters', async (_request, reply) => {
    // Перед отдачей снимаем просроченные брони: иначе карта показала бы занятый самокат,
    // который на самом деле уже свободен.
    await bookingService.tick().catch(() => undefined);

    return reply.code(200).send({
      scooters: await listScooters(pool),
      serverTime: new Date(now()).toISOString(),
      seq: nextSeq(),
    });
  });

  app.get('/api/scooters/:id', async (request, reply) => {
    const parsed = ScooterIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw notFound('Самокат не найден');
    }

    const scooters = await listScooters(pool);
    const scooter = scooters.find((item) => item.id === parsed.data.id);
    if (scooter === undefined) {
      throw notFound('Самокат не найден');
    }

    return reply.code(200).send({ scooter, serverTime: new Date(now()).toISOString() });
  });

  app.get('/api/zone', async (_request, reply) => {
    // Зона — часть домена и не меняется в рантайме: отдаём её из общего пакета.
    return reply.code(200).send({ zone: SERVICE_ZONE });
  });
}
