import {
  BOOKING_STATUSES,
  END_REASONS,
  InvoiceBreakdownSchema,
  SCOOTER_STATUSES,
  RIDE_STATUSES,
} from '@sharing/shared';
import type {
  Booking,
  EmailMessage,
  Invoice,
  PublicUser,
  Ride,
  RidePause,
  Scooter,
} from '@sharing/shared';
import { z } from 'zod';

/**
 * Строки из базы и их преобразование в доменные объекты.
 *
 * `pg` возвращает нетипизированные объекты, и соблазн «поверить» им через приведение типа здесь
 * особенно велик. Вместо этого каждая строка проходит zod-схему: если схема и таблица разойдутся
 * (переименовали колонку, забыли алиас), это станет явной ошибкой, а не тихим undefined в ответе.
 */
const IsoFromDate = z.date().transform((value) => value.toISOString());
const NullableIsoFromDate = z
  .nullable(z.date())
  .transform((value) => (value === null ? null : value.toISOString()));

export const UserRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  password_hash: z.string(),
  created_at: IsoFromDate,
  updated_at: IsoFromDate,
});

export const SessionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  token_hash: z.string(),
  expires_at: IsoFromDate,
  revoked_at: NullableIsoFromDate,
});

export const ScooterRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  model: z.string(),
  status: z.enum(SCOOTER_STATUSES),
  battery_pct: z.number(),
  lat: z.number(),
  lng: z.number(),
  low_battery_flagged: z.boolean(),
  last_seen_at: IsoFromDate,
  created_at: IsoFromDate,
  updated_at: IsoFromDate,
});

export const BookingRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  scooter_id: z.string(),
  status: z.enum(BOOKING_STATUSES),
  reserved_at: IsoFromDate,
  expires_at: IsoFromDate,
  notified_at: NullableIsoFromDate,
  closed_at: NullableIsoFromDate,
  created_at: IsoFromDate,
  updated_at: IsoFromDate,
});

export const RideRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  scooter_id: z.string(),
  booking_id: z.nullable(z.string()),
  status: z.enum(RIDE_STATUSES),
  started_at: IsoFromDate,
  finished_at: NullableIsoFromDate,
  end_reason: z.nullable(z.enum(END_REASONS)),
  distance_m: z.number(),
  total_amount: z.nullable(z.number()),
  currency: z.string(),
  created_at: IsoFromDate,
  updated_at: IsoFromDate,
});

export const RidePauseRowSchema = z.object({
  id: z.string(),
  ride_id: z.string(),
  started_at: IsoFromDate,
  ended_at: NullableIsoFromDate,
  created_at: IsoFromDate,
  updated_at: IsoFromDate,
});

export const InvoiceRowSchema = z.object({
  id: z.string(),
  ride_id: z.string(),
  user_id: z.string(),
  breakdown: z.unknown(),
  amount: z.number(),
  currency: z.string(),
  issued_at: IsoFromDate,
  created_at: IsoFromDate,
});

export const EmailRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  to_email: z.string(),
  subject: z.string(),
  body: z.string(),
  dedupe_key: z.string(),
  sent_at: IsoFromDate,
  created_at: IsoFromDate,
});

export type UserRow = z.infer<typeof UserRowSchema>;
export type SessionRow = z.infer<typeof SessionRowSchema>;
export type ScooterRow = z.infer<typeof ScooterRowSchema>;
export type BookingRow = z.infer<typeof BookingRowSchema>;
export type RideRow = z.infer<typeof RideRowSchema>;
export type RidePauseRow = z.infer<typeof RidePauseRowSchema>;
export type InvoiceRow = z.infer<typeof InvoiceRowSchema>;
export type EmailRow = z.infer<typeof EmailRowSchema>;

export interface UserWithHash {
  user: PublicUser;
  passwordHash: string;
}

export function toUserWithHash(row: UserRow): UserWithHash {
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    passwordHash: row.password_hash,
  };
}

export function toPublicUser(row: UserRow): PublicUser {
  return toUserWithHash(row).user;
}

export function toScooter(row: ScooterRow): Scooter {
  return {
    id: row.id,
    code: row.code,
    model: row.model,
    status: row.status,
    batteryPct: row.battery_pct,
    lat: row.lat,
    lng: row.lng,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    userId: row.user_id,
    scooterId: row.scooter_id,
    status: row.status,
    reservedAt: row.reserved_at,
    expiresAt: row.expires_at,
    notifiedAt: row.notified_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRide(row: RideRow): Ride {
  return {
    id: row.id,
    userId: row.user_id,
    scooterId: row.scooter_id,
    bookingId: row.booking_id ?? '',
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    endReason: row.end_reason,
    distanceM: row.distance_m,
    totalAmount: row.total_amount,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRidePause(row: RidePauseRow): RidePause {
  return {
    id: row.id,
    rideId: row.ride_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    rideId: row.ride_id,
    userId: row.user_id,
    // Разбор счёта приходит из jsonb: состав проверяем схемой, а не доверяем типу колонки.
    breakdown: InvoiceBreakdownSchema.parse(row.breakdown),
    amount: row.amount,
    currency: row.currency,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

export function toEmailMessage(row: EmailRow): EmailMessage {
  return {
    id: row.id,
    userId: row.user_id,
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    dedupeKey: row.dedupe_key,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}
