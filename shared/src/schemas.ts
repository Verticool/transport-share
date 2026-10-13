import { z } from 'zod';

import type {
  Booking,
  BookingStatus,
  EndReason,
  EmailMessage,
  Invoice,
  InvoiceBreakdown,
  Iso,
  PublicUser,
  Ride,
  RidePause,
  RideStatus,
  Scooter,
  ScooterStatus,
  ServiceZone,
} from './domain.ts';
import {
  BOOKING_STATUSES,
  END_REASONS,
  RIDE_STATUSES,
  SCOOTER_STATUSES,
} from './domain.ts';

// ─── Примитивы ───────────────────────────────────────────────────────────────

export const IsoSchema: z.ZodString = z.string().datetime({ offset: true, message: 'expected ISO-8601 UTC datetime with Z suffix' });

export const MinorSchema: z.ZodNumber = z.number().int().nonnegative();

export const LatLngSchema: z.ZodObject<{ lat: z.ZodNumber; lng: z.ZodNumber }> = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const ScooterStatusSchema: z.ZodType<ScooterStatus> = z.enum([...SCOOTER_STATUSES]);

export const BookingStatusSchema: z.ZodType<BookingStatus> = z.enum([...BOOKING_STATUSES]);

export const RideStatusSchema: z.ZodType<RideStatus> = z.enum([...RIDE_STATUSES]);

export const EndReasonSchema: z.ZodType<EndReason> = z.enum([...END_REASONS]);

// ─── Доменные объекты ─────────────────────────────────────────────────────────

export const PublicUserSchema: z.ZodType<PublicUser> = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().min(1).max(80),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});

export const ScooterSchema: z.ZodType<Scooter> = z.object({
  id: z.string(),
  code: z.string(),
  model: z.string(),
  status: ScooterStatusSchema,
  batteryPct: z.number().int().min(0).max(100),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  lastSeenAt: IsoSchema,
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});

export const BookingSchema: z.ZodType<Booking> = z.object({
  id: z.string(),
  userId: z.string(),
  scooterId: z.string(),
  status: BookingStatusSchema,
  reservedAt: IsoSchema,
  expiresAt: IsoSchema,
  notifiedAt: z.nullable(IsoSchema),
  closedAt: z.nullable(IsoSchema),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});

export const RidePauseSchema: z.ZodType<RidePause> = z.object({
  id: z.string(),
  rideId: z.string(),
  startedAt: IsoSchema,
  endedAt: z.nullable(IsoSchema),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});

export const RideSchema: z.ZodType<Ride> = z.object({
  id: z.string(),
  userId: z.string(),
  scooterId: z.string(),
  bookingId: z.string(),
  status: RideStatusSchema,
  startedAt: IsoSchema,
  finishedAt: z.nullable(IsoSchema),
  endReason: z.nullable(EndReasonSchema),
  distanceM: z.number(),
  totalAmount: z.nullable(MinorSchema),
  currency: z.string(),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
});

export const InvoiceBreakdownSchema: z.ZodType<InvoiceBreakdown> = z.object({
  unlockFee: MinorSchema,
  rideMinutes: z.number(),
  rideAmount: MinorSchema,
  pauseMinutes: z.number(),
  pauseAmount: MinorSchema,
  total: MinorSchema,
});

export const InvoiceSchema: z.ZodType<Invoice> = z.object({
  id: z.string(),
  rideId: z.string(),
  userId: z.string(),
  amount: MinorSchema,
  currency: z.string(),
  breakdown: InvoiceBreakdownSchema,
  issuedAt: IsoSchema,
  createdAt: IsoSchema,
});

export const EmailMessageSchema: z.ZodType<EmailMessage> = z.object({
  id: z.string(),
  userId: z.string(),
  toEmail: z.string().email(),
  subject: z.string(),
  body: z.string(),
  dedupeKey: z.string(),
  sentAt: IsoSchema,
  createdAt: IsoSchema,
});

export const ServiceZoneSchema: z.ZodType<ServiceZone> = z.object({
  name: z.string(),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
});

export const RidePointSchema: z.ZodType<{ id: number; rideId: string; lat: number; lng: number; batteryPct: number; recordedAt: Iso }> = z.object({
  id: z.number(),
  rideId: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  batteryPct: z.number().int().min(0).max(100),
  recordedAt: IsoSchema,
});

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ServerTimeSchema: z.ZodType<{ serverTime: Iso }> = z.object({
  serverTime: IsoSchema,
});

// ─── Входные данные ручек ─────────────────────────────────────────────────────

export const RegisterRequestSchema: z.ZodType<{ email: string; password: string; name: string }> = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80),
});

export const LoginRequestSchema: z.ZodType<{ email: string; password: string }> = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const CreateBookingRequestSchema: z.ZodType<{ scooterId: string }> = z.object({
  scooterId: z.string().uuid(),
});

export const RideIdParamsSchema: z.ZodType<{ rideId: string }> = z.object({
  rideId: z.string().uuid(),
});

export const FinishRideRequestSchema: z.ZodType<{ lat: number; lng: number }> = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const RidesQuerySchema: z.ZodType<{ limit: number; offset: number }> = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

// ─── Фабрика пагинации ────────────────────────────────────────────────────────

export function PaginatedSchema<T extends z.ZodType<object>>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().min(1),
    offset: z.number().int().nonnegative(),
  });
}

// ─── WS-протокол ──────────────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), token: z.string().optional() }),
  z.object({ type: z.literal('snapshot'), sinceSeq: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('ping'), at: z.number() }),
]);

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    payload: z.object({
      scooters: z.array(ScooterSchema),
      myBooking: z.nullable(BookingSchema),
      myRide: z.nullable(RideSchema),
      serverTime: IsoSchema,
    }),
  }),
  z.object({
    type: z.literal('park.delta'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    changes: z.array(z.object({
      id: z.string(),
      status: ScooterStatusSchema,
      batteryPct: z.number().int().min(0).max(100),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      lastSeenAt: IsoSchema,
    })),
  }),
  z.object({
    type: z.literal('booking.expiring'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    bookingId: z.string(),
    expiresAt: IsoSchema,
    minutesLeft: z.number(),
  }),
  z.object({
    type: z.literal('booking.expired'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    bookingId: z.string(),
  }),
  z.object({
    type: z.literal('booking.created'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    booking: BookingSchema,
  }),
  z.object({
    type: z.literal('ride.started'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    ride: RideSchema,
  }),
  z.object({
    type: z.literal('ride.tick'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    rideId: z.string(),
    status: RideStatusSchema,
    rideMinutes: z.number(),
    pauseMinutes: z.number(),
    amountSoFar: MinorSchema,
    currency: z.string(),
  }),
  z.object({
    type: z.literal('ride.finished'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    ride: RideSchema,
    invoice: InvoiceSchema,
  }),
  z.object({
    type: z.literal('pong'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    at: z.number(),
  }),
  z.object({
    type: z.literal('error'),
    seq: z.number(),
    sentAt: z.number(),
    serverTime: IsoSchema,
    error: ApiErrorSchema,
  }),
]);

// ─── Хелперы ──────────────────────────────────────────────────────────────────

export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown, what: string): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new Error(`Failed to parse ${what}: ${result.error.message}`);
}

export function safeParseResult<T>(schema: z.ZodType<T>, input: unknown):
  | { ok: true; value: T }
  | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error.message };
}
