import type { Pool, PoolClient } from 'pg';

import {
  RidePauseRowSchema,
  RideRowSchema,
  type RidePauseRow,
  type RideRow,
} from './rows';

type Queryable = Pool | PoolClient;

export async function insertRideRow(
  db: Queryable,
  input: { id: string; userId: string; scooterId: string; bookingId: string; currency: string },
): Promise<RideRow> {
  const result = await db.query(
    `INSERT INTO rides (id, user_id, scooter_id, booking_id, status, started_at, currency)
     VALUES ($1, $2, $3, $4, 'active', now(), $5)
     RETURNING *`,
    [input.id, input.userId, input.scooterId, input.bookingId, input.currency],
  );
  return RideRowSchema.parse(result.rows[0]);
}

export async function findRideRowById(db: Queryable, id: string): Promise<RideRow | null> {
  const result = await db.query('SELECT * FROM rides WHERE id = $1', [id]);
  const row: unknown = result.rows[0];
  return row === undefined ? null : RideRowSchema.parse(row);
}

/** Незавершённая поездка пользователя: активная или на паузе. */
export async function findActiveRideRow(db: Queryable, userId: string): Promise<RideRow | null> {
  const result = await db.query(
    `SELECT * FROM rides WHERE user_id = $1 AND status <> 'finished' ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
  const row: unknown = result.rows[0];
  return row === undefined ? null : RideRowSchema.parse(row);
}

export async function listOpenRideRows(db: Queryable): Promise<RideRow[]> {
  const result = await db.query("SELECT * FROM rides WHERE status <> 'finished' ORDER BY started_at");
  return result.rows.map((row: unknown) => RideRowSchema.parse(row));
}

export async function setRideStatus(db: Queryable, id: string, status: RideRow['status']): Promise<void> {
  await db.query('UPDATE rides SET status = $2 WHERE id = $1', [id, status]);
}

export async function finishRideRow(
  db: Queryable,
  input: {
    id: string;
    endReason: NonNullable<RideRow['end_reason']>;
    totalAmount: number;
    distanceM: number;
  },
): Promise<RideRow> {
  const result = await db.query(
    `UPDATE rides
        SET status = 'finished', finished_at = now(), end_reason = $2, total_amount = $3, distance_m = $4
      WHERE id = $1
      RETURNING *`,
    [input.id, input.endReason, input.totalAmount, input.distanceM],
  );
  return RideRowSchema.parse(result.rows[0]);
}

export async function addRideDistance(db: Queryable, id: string, meters: number): Promise<void> {
  await db.query('UPDATE rides SET distance_m = distance_m + $2 WHERE id = $1', [id, meters]);
}

export async function insertPauseRow(
  db: Queryable,
  input: { id: string; rideId: string },
): Promise<RidePauseRow> {
  const result = await db.query(
    `INSERT INTO ride_pauses (id, ride_id, started_at) VALUES ($1, $2, now()) RETURNING *`,
    [input.id, input.rideId],
  );
  return RidePauseRowSchema.parse(result.rows[0]);
}

export async function closeOpenPause(db: Queryable, rideId: string): Promise<void> {
  await db.query(
    `UPDATE ride_pauses SET ended_at = now() WHERE ride_id = $1 AND ended_at IS NULL`,
    [rideId],
  );
}

export async function listPauseRows(db: Queryable, rideId: string): Promise<RidePauseRow[]> {
  const result = await db.query('SELECT * FROM ride_pauses WHERE ride_id = $1 ORDER BY started_at', [rideId]);
  return result.rows.map((row: unknown) => RidePauseRowSchema.parse(row));
}

export async function listRideRowsForUser(
  db: Queryable,
  userId: string,
  query: { limit: number; offset: number },
): Promise<{ items: RideRow[]; total: number }> {
  const totalResult = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM rides WHERE user_id = $1',
    [userId],
  );
  const result = await db.query(
    `SELECT * FROM rides WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
    [userId, query.limit, query.offset],
  );

  return {
    items: result.rows.map((row: unknown) => RideRowSchema.parse(row)),
    total: Number(totalResult.rows[0]?.count ?? '0'),
  };
}
