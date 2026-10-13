import type { Pool, PoolClient } from 'pg';

import { ScooterRowSchema, toScooter, type ScooterRow } from './rows';

type Queryable = Pool | PoolClient;

export async function listScooterRows(db: Queryable): Promise<ScooterRow[]> {
  const result = await db.query('SELECT * FROM scooters ORDER BY code');
  return result.rows.map((row: unknown) => ScooterRowSchema.parse(row));
}

export async function findScooterRow(db: Queryable, id: string): Promise<ScooterRow | null> {
  const result = await db.query('SELECT * FROM scooters WHERE id = $1', [id]);
  const row: unknown = result.rows[0];
  return row === undefined ? null : ScooterRowSchema.parse(row);
}

export async function setScooterStatus(
  db: Queryable,
  id: string,
  status: ScooterRow['status'],
): Promise<void> {
  await db.query('UPDATE scooters SET status = $2 WHERE id = $1', [id, status]);
}

export async function setScooterBattery(
  db: Queryable,
  id: string,
  batteryPct: number,
  input: { lat?: number; lng?: number } = {},
): Promise<void> {
  await db.query(
    `UPDATE scooters
        SET battery_pct = $2,
            lat = COALESCE($3, lat),
            lng = COALESCE($4, lng),
            low_battery_flagged = $2 < 20,
            last_seen_at = now()
      WHERE id = $1`,
    [id, batteryPct, input.lat ?? null, input.lng ?? null],
  );
}

export async function listScooters(db: Queryable) {
  return (await listScooterRows(db)).map(toScooter);
}
