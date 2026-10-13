import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  EmailMessageSchema,
  InvoiceSchema,
  PublicUserSchema,
  RideSchema,
  ScooterSchema,
} from '@sharing/shared';
import type { EmailMessage, Invoice, PublicUser, Ride, Scooter } from '@sharing/shared';
import { z } from 'zod';
import type { Pool } from 'pg';

import { hashPassword } from '../auth/password';
import { withTransaction } from './pool';

/**
 * Пароль всех демонстрационных пользователей.
 *
 * В мок-данных паролей нет и быть не должно — файлы лежат в репозитории. При сиде всем выдаётся
 * один известный пароль, чтобы можно было войти на демонстрации; на реальной установке пароли
 * задаются регистрацией (`POST /api/auth/register`).
 */
export const DEMO_PASSWORD = 'demo1234';

export interface SeedReport {
  users: number;
  scooters: number;
  rides: number;
  invoices: number;
  emails: number;
}

async function readJson(dir: string, name: string): Promise<unknown> {
  const text = await readFile(join(dir, name), 'utf8');
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/**
 * Наполняет базу из мок-данных.
 *
 * Операция идемпотентна (`ON CONFLICT DO NOTHING` на каждом шаге): повторный запуск ничего не
 * дублирует и не портит. Так сид можно вызывать при каждом старте контейнера.
 */
export async function seed(pool: Pool, mockDir: string, log: (message: string) => void = () => undefined): Promise<SeedReport> {
  const users = z.array(PublicUserSchema).parse(await readJson(mockDir, 'users.json'));
  const scooters = z.array(ScooterSchema).parse(await readJson(mockDir, 'scooters.json'));
  const rides = z.array(RideSchema).parse(await readJson(mockDir, 'rides.json'));
  const invoices = z.array(InvoiceSchema).parse(await readJson(mockDir, 'invoices.json'));
  const emails = z.array(EmailMessageSchema).parse(await readJson(mockDir, 'emails.json'));

  const report: SeedReport = { users: 0, scooters: 0, rides: 0, invoices: 0, emails: 0 };

  return withTransaction(pool, async (client) => {
    // Пользователи: хеш считается один раз на всех — пароль у всех демонстрационный.
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    for (const user of users) {
      const result = await client.query(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.email, passwordHash, user.name, user.createdAt, user.updatedAt],
      );
      report.users += result.rowCount ?? 0;
    }

    for (const scooter of scooters) {
      const result = await client.query(
        `INSERT INTO scooters
           (id, code, model, status, battery_pct, lat, lng, low_battery_flagged, last_seen_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          scooter.id,
          scooter.code,
          scooter.model,
          scooter.status,
          scooter.batteryPct,
          scooter.lat,
          scooter.lng,
          scooter.lastSeenAt,
          scooter.createdAt,
          scooter.updatedAt,
        ],
      );
      report.scooters += result.rowCount ?? 0;
    }

    for (const ride of rides) {
      const result = await client.query(
        `INSERT INTO rides
           (id, user_id, scooter_id, booking_id, status, started_at, finished_at, end_reason,
            distance_m, total_amount, currency, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          ride.id,
          ride.userId,
          ride.scooterId,
          ride.status,
          ride.startedAt,
          ride.finishedAt,
          ride.endReason,
          ride.distanceM,
          ride.totalAmount,
          ride.currency,
          ride.createdAt,
          ride.updatedAt,
        ],
      );
      report.rides += result.rowCount ?? 0;
    }

    for (const invoice of invoices) {
      const result = await client.query(
        `INSERT INTO invoices (id, ride_id, user_id, breakdown, amount, currency, issued_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          invoice.id,
          invoice.rideId,
          invoice.userId,
          JSON.stringify(invoice.breakdown),
          invoice.amount,
          invoice.currency,
          invoice.issuedAt,
          invoice.createdAt,
        ],
      );
      report.invoices += result.rowCount ?? 0;
    }

    for (const email of emails) {
      const result = await client.query(
        `INSERT INTO emails (id, user_id, to_email, subject, body, dedupe_key, sent_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          email.id,
          email.userId,
          email.toEmail,
          email.subject,
          email.body,
          email.dedupeKey,
          email.sentAt,
          email.createdAt,
        ],
      );
      report.emails += result.rowCount ?? 0;
    }

    log(
      `сид: пользователей ${report.users}, самокатов ${report.scooters}, поездок ${report.rides}, ` +
        `счетов ${report.invoices}, писем ${report.emails}`,
    );
    return report;
  });
}

/** Типы источников сида: проверка, что мок-данные совпадают с доменными. */
export interface SeedSources {
  users: PublicUser[];
  scooters: Scooter[];
  rides: Ride[];
  invoices: Invoice[];
  emails: EmailMessage[];
}
