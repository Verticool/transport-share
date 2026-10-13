import type { Pool, PoolClient } from 'pg';

import { UserRowSchema, toUserWithHash, type UserRow, type UserWithHash } from './rows';

type Queryable = Pool | PoolClient;

/** Пользователь по почте: регистр не важен — так же построен уникальный индекс в схеме. */
export async function findUserByEmail(db: Queryable, email: string): Promise<UserWithHash | null> {
  const result = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const row: unknown = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return toUserWithHash(UserRowSchema.parse(row));
}

export async function findUserById(db: Queryable, id: string): Promise<UserWithHash | null> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  const row: unknown = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return toUserWithHash(UserRowSchema.parse(row));
}

/** Создаёт пользователя. Почта уникальна без учёта регистра — за это отвечает индекс в схеме. */
export async function insertUser(
  db: Queryable,
  input: { id: string; email: string; name: string; passwordHash: string },
): Promise<UserRow> {
  const result = await db.query(
    `INSERT INTO users (id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.id, input.email, input.name, input.passwordHash],
  );
  return UserRowSchema.parse(result.rows[0]);
}
