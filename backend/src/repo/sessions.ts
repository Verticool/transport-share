import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { SessionRowSchema, type SessionRow } from './rows';

type Queryable = Pool | PoolClient;

/** Хеш токена обновления: в базе лежит только он, сам токен остаётся у клиента. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function insertSession(
  db: Queryable,
  input: { id: string; userId: string; token: string; expiresAt: Date; userAgent?: string },
): Promise<SessionRow> {
  const result = await db.query(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.id, input.userId, hashRefreshToken(input.token), input.userAgent ?? null, input.expiresAt],
  );
  return SessionRowSchema.parse(result.rows[0]);
}

/** Действующая сессия: не отозвана и не истекла. Истёкшие считаются недействительными. */
export async function findActiveSession(db: Queryable, token: string): Promise<SessionRow | null> {
  const result = await db.query(
    `SELECT * FROM sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashRefreshToken(token)],
  );
  const row: unknown = result.rows[0];
  return row === undefined ? null : SessionRowSchema.parse(row);
}

/** Гасит конкретную сессию (выход): повторный вызов ничего не меняет. */
export async function revokeSession(db: Queryable, token: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashRefreshToken(token)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Гасит все сессии пользователя: нужно при смене пароля и по требованию «выйти везде». */
export async function revokeAllSessions(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return result.rowCount ?? 0;
}
