import { randomUUID } from 'node:crypto';

import { BOOKING_NOTIFY_MINUTES, BOOKING_TTL_MINUTES, LOW_BATTERY_THRESHOLD } from '@sharing/shared';
import type { Booking } from '@sharing/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { conflict, notFound } from '../http/errors';
import { withTransaction } from '../db/pool';
import {
  closeBookingRow,
  expireBookings,
  findActiveBookingRow,
  findBookingRowById,
  findExpiringBookings,
  insertBookingRow,
  markBookingNotified,
  shortenBookingRow,
} from '../repo/bookings';
import { toBooking, type BookingRow } from '../repo/rows';
import { findScooterRow, setScooterStatus } from '../repo/scooters';

/** Код нарушения уникальности в PostgreSQL: единственный способ отличить гонку от прочих ошибок. */
const PgErrorSchema = z.object({ code: z.string().optional() });

function isUniqueViolation(error: unknown): boolean {
  const parsed = PgErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === '23505';
}

export interface BookingServiceDeps {
  pool: Pool;
  now: () => number;
}

/**
 * Брони.
 *
 * Правило «один самокат — одна бронь» держит база (частичный уникальный индекс), а сервис лишь
 * переводит нарушение в понятный ответ 409. Так две одновременные брони не могут пройти обе,
 * даже если оба запроса успели проверить состояние до вставки.
 */
export class BookingService {
  private readonly pool: Pool;
  private readonly now: () => number;

  constructor(deps: BookingServiceDeps) {
    this.pool = deps.pool;
    this.now = deps.now;
  }

  /** Освобождает самокаты просроченных броней: вызывается и ручками, и тиком симулятора. */
  private async releaseScooters(client: PoolClient, released: { scooterId: string }[]): Promise<void> {
    for (const booking of released) {
      const scooter = await findScooterRow(client, booking.scooterId);
      if (scooter?.status !== 'reserved') {
        continue;
      }
      const status = scooter.battery_pct < LOW_BATTERY_THRESHOLD ? 'unavailable' : 'free';
      await setScooterStatus(client, booking.scooterId, status);
    }
  }

  async create(scooterId: string, userId: string): Promise<Booking> {
    return withTransaction(this.pool, async (client) => {
      const expired = await expireBookings(client);
      await this.releaseScooters(client, expired);

      const mine = await findActiveBookingRow(client, userId);
      if (mine !== null) {
        throw conflict('У вас уже есть активная бронь');
      }

      const scooter = await findScooterRow(client, scooterId);
      if (scooter === null) {
        throw notFound('Самокат не найден');
      }
      if (scooter.status !== 'free') {
        throw conflict('Этот самокат сейчас недоступен');
      }

      let row: BookingRow;
      try {
        row = await insertBookingRow(client, {
          id: randomUUID(),
          userId,
          scooterId,
          ttlMinutes: BOOKING_TTL_MINUTES,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict('Этот самокат уже забронирован');
        }
        throw error;
      }

      await setScooterStatus(client, scooterId, 'reserved');
      return toBooking(row);
    });
  }

  /**
   * Укорачивает бронь: сдвигает срок снятия на несколько минут назад.
   *
   * Нужно ровно для проверки оповещений: в жизни бронь живёт 15 минут и предупреждение приходит
   * за 3 минуты до снятия — ждать этого в демонстрации бессмысленно.
   */
  async shorten(bookingId: string, userId: string, minutes: number): Promise<Booking> {
    return withTransaction(this.pool, async (client) => {
      const row = await findBookingRowById(client, bookingId);
      if (row?.user_id !== userId) {
        throw notFound('Бронь не найдена');
      }
      if (row.status !== 'active') {
        throw conflict('Бронь уже снята');
      }

      await shortenBookingRow(client, bookingId, minutes);
      const updated = await findBookingRowById(client, bookingId);
      return toBooking(updated ?? row);
    });
  }

  async active(userId: string): Promise<Booking | null> {
    return withTransaction(this.pool, async (client) => {
      const expired = await expireBookings(client);
      await this.releaseScooters(client, expired);

      const row = await findActiveBookingRow(client, userId);
      return row === null ? null : toBooking(row);
    });
  }

  async cancel(bookingId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const row = await findBookingRowById(client, bookingId);
      // Чужая бронь отдаётся как отсутствующая: по коду не узнать о существовании чужой брони.
      if (row?.user_id !== userId) {
        throw notFound('Бронь не найдена');
      }
      if (row.status !== 'active') {
        throw conflict('Бронь уже не действует');
      }

      await closeBookingRow(client, row.id, 'cancelled');
      const scooter = await findScooterRow(client, row.scooter_id);
      if (scooter?.status === 'reserved') {
        await setScooterStatus(
          client,
          scooter.id,
          scooter.battery_pct < LOW_BATTERY_THRESHOLD ? 'unavailable' : 'free',
        );
      }
    });
  }

  /**
   * Обслуживание броней по тику: снять просроченные и отметить те, которым осталось мало.
   * Возвращает изменения, чтобы вызывающий мог разослать их подписчикам.
   */
  async tick(): Promise<{
    expired: { id: string; scooterId: string }[];
    expiring: { id: string; userId: string; expiresAt: string; minutesLeft: number }[];
  }> {
    return withTransaction(this.pool, async (client) => {
      const expired = await expireBookings(client);
      await this.releaseScooters(client, expired);

      const soon = await findExpiringBookings(client, BOOKING_NOTIFY_MINUTES);
      const expiring: { id: string; userId: string; expiresAt: string; minutesLeft: number }[] = [];
      for (const booking of soon) {
        await markBookingNotified(client, booking.id);
        const minutesLeft = Math.max(
          0,
          Math.ceil((Date.parse(booking.expires_at) - this.now()) / 60_000),
        );
        expiring.push({
          id: booking.id,
          userId: booking.user_id,
          expiresAt: booking.expires_at,
          minutesLeft,
        });
      }

      return { expired, expiring };
    });
  }
}
