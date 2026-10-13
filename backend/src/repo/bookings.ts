import type { Pool, PoolClient } from 'pg';

import { BookingRowSchema, type BookingRow } from './rows';

type Queryable = Pool | PoolClient;

export async function insertBookingRow(
  db: Queryable,
  input: { id: string; userId: string; scooterId: string; ttlMinutes: number },
): Promise<BookingRow> {
  // Обе метки ставит база: если считать срок часами приложения, срок брони отличался бы от
  // `reserved_at` на разницу часов — на пару миллисекунд, но это уже другое правило.
  const result = await db.query(
    `INSERT INTO bookings (id, user_id, scooter_id, status, reserved_at, expires_at)
     VALUES ($1, $2, $3, 'active', now(), now() + ($4 || ' minutes')::interval)
     RETURNING *`,
    [input.id, input.userId, input.scooterId, String(input.ttlMinutes)],
  );
  return BookingRowSchema.parse(result.rows[0]);
}

export async function findActiveBookingRow(db: Queryable, userId: string): Promise<BookingRow | null> {
  const result = await db.query(
    `SELECT * FROM bookings
      WHERE user_id = $1 AND status = 'active' AND expires_at > now()
      ORDER BY reserved_at DESC
      LIMIT 1`,
    [userId],
  );
  const row: unknown = result.rows[0];
  return row === undefined ? null : BookingRowSchema.parse(row);
}

export async function findBookingRowById(db: Queryable, id: string): Promise<BookingRow | null> {
  const result = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
  const row: unknown = result.rows[0];
  return row === undefined ? null : BookingRowSchema.parse(row);
}

/** Закрывает бронь (отмена, снятие по сроку, расход при старте поездки). */
export async function closeBookingRow(
  db: Queryable,
  id: string,
  status: 'expired' | 'cancelled' | 'consumed',
): Promise<void> {
  await db.query(
    `UPDATE bookings SET status = $2, closed_at = now()
      WHERE id = $1 AND status = 'active'`,
    [id, status],
  );
}

/**
 * Снимает просроченные брони.
 *
 * Пары «бронь — самокат» возвращаются вызывающему: освободить самокат нужно ровно для тех броней,
 * которые действительно закрылись, — иначе под симулятором самокат «разбронировался» бы дважды.
 */
export async function expireBookings(db: Queryable): Promise<{ id: string; scooterId: string }[]> {
  const result = await db.query(
    `UPDATE bookings SET status = 'expired', closed_at = now()
      WHERE status = 'active' AND expires_at <= now()
      RETURNING id, scooter_id`,
  );
  return result.rows.map((row: unknown) => {
    const parsed = BookingRowSchema.pick({ id: true, scooter_id: true }).parse(row);
    return { id: parsed.id, scooterId: parsed.scooter_id };
  });
}

/** Брони, которым осталось меньше порога: нужны для предупреждения за 3 минуты. */
export async function findExpiringBookings(
  db: Queryable,
  minutesLeft: number,
): Promise<BookingRow[]> {
  const result = await db.query(
    `SELECT * FROM bookings
      WHERE status = 'active'
        AND notified_at IS NULL
        AND expires_at > now()
        AND expires_at <= now() + ($1 || ' minutes')::interval`,
    [String(minutesLeft)],
  );
  return result.rows.map((row: unknown) => BookingRowSchema.parse(row));
}

export async function markBookingNotified(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE bookings SET notified_at = now() WHERE id = $1', [id]);
}

export async function listBookingsForUser(db: Queryable, userId: string): Promise<BookingRow[]> {
  const result = await db.query(
    'SELECT * FROM bookings WHERE user_id = $1 ORDER BY reserved_at DESC',
    [userId],
  );
  return result.rows.map((row: unknown) => BookingRowSchema.parse(row));
}
