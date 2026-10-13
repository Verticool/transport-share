import type { Pool, PoolClient } from 'pg';

import { InvoiceRowSchema, EmailRowSchema, type InvoiceRow, type EmailRow } from './rows';

type Queryable = Pool | PoolClient;

export async function insertInvoiceRow(
  db: Queryable,
  input: {
    id: string;
    rideId: string;
    userId: string;
    breakdown: unknown;
    amount: number;
    currency: string;
  },
): Promise<InvoiceRow> {
  const result = await db.query(
    `INSERT INTO invoices (id, ride_id, user_id, breakdown, amount, currency, issued_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
     ON CONFLICT (ride_id) DO NOTHING
     RETURNING *`,
    [input.id, input.rideId, input.userId, JSON.stringify(input.breakdown), input.amount, input.currency],
  );
  const row: unknown = result.rows[0];
  if (row !== undefined) {
    return InvoiceRowSchema.parse(row);
  }

  // Счёт уже есть: требование «один счёт на поездку» — возвращаем существующий, а не создаём второй.
  const existing = await db.query('SELECT * FROM invoices WHERE ride_id = $1', [input.rideId]);
  return InvoiceRowSchema.parse(existing.rows[0]);
}

export async function listInvoiceRowsForUser(db: Queryable, userId: string): Promise<InvoiceRow[]> {
  const result = await db.query(
    'SELECT * FROM invoices WHERE user_id = $1 ORDER BY issued_at DESC',
    [userId],
  );
  return result.rows.map((row: unknown) => InvoiceRowSchema.parse(row));
}

export async function insertEmailRow(
  db: Queryable,
  input: {
    id: string;
    userId: string;
    toEmail: string;
    subject: string;
    body: string;
    dedupeKey: string;
  },
): Promise<EmailRow> {
  const result = await db.query(
    `INSERT INTO emails (id, user_id, to_email, subject, body, dedupe_key, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [input.id, input.userId, input.toEmail, input.subject, input.body, input.dedupeKey],
  );
  const row: unknown = result.rows[0];
  if (row !== undefined) {
    return EmailRowSchema.parse(row);
  }

  const existing = await db.query('SELECT * FROM emails WHERE dedupe_key = $1', [input.dedupeKey]);
  return EmailRowSchema.parse(existing.rows[0]);
}

export async function listEmailRowsForUser(db: Queryable, userId: string): Promise<EmailRow[]> {
  const result = await db.query('SELECT * FROM emails WHERE user_id = $1 ORDER BY sent_at DESC', [userId]);
  return result.rows.map((row: unknown) => EmailRowSchema.parse(row));
}
