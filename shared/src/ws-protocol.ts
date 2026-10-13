/**
 * Протокол WebSocket: типы сообщений клиент↔сервер.
 * Обязательные поля каждого серверного сообщения: `seq` (монотонный счётчик) и `sent_at`.
 * Клиент отбрасывает сообщения с seq <= уже применённого — защита от гонок при реконнекте (B7).
 */

import type {
  ApiError,
  Booking,
  Invoice,
  Iso,
  Minor,
  Ride,
  Scooter,
  ScooterStatus,
  UnixMs,
} from './domain.ts';

/** Минимальная дельта по самокату: ровно то, что изменилось. */
export interface ScooterDelta {
  id: string;
  status: ScooterStatus;
  batteryPct: number;
  lat: number;
  lng: number;
  lastSeenAt: Iso;
}

/** Полный снапшот: то, что клиент получает при подключении и после реконнекта. */
export interface SnapshotPayload {
  scooters: Scooter[];
  /** Активная бронь пользователя, если он авторизован. */
  myBooking: Booking | null;
  /** Активная поездка пользователя, если есть. */
  myRide: Ride | null;
  serverTime: Iso;
}

/** Сообщения клиент → сервер. */
export type ClientMessage =
  | { type: 'subscribe'; token?: string }
  | { type: 'snapshot'; sinceSeq?: number }
  | { type: 'ping'; at: UnixMs };

/** Сообщения сервер → клиент. */
export type ServerMessage =
  | {
      type: 'snapshot';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      payload: SnapshotPayload;
    }
  | {
      type: 'park.delta';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      changes: ScooterDelta[];
    }
  | {
      type: 'booking.expiring';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      bookingId: string;
      expiresAt: Iso;
      minutesLeft: number;
    }
  | {
      type: 'booking.expired';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      bookingId: string;
    }
  | {
      type: 'booking.created';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      booking: Booking;
    }
  | {
      type: 'ride.started';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      ride: Ride;
    }
  | {
      type: 'ride.tick';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      rideId: string;
      status: Ride['status'];
      rideMinutes: number;
      pauseMinutes: number;
      amountSoFar: Minor;
      currency: string;
    }
  | {
      type: 'ride.finished';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      ride: Ride;
      invoice: Invoice;
    }
  | {
      type: 'pong';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      at: UnixMs;
    }
  | {
      type: 'error';
      seq: number;
      sentAt: UnixMs;
      serverTime: Iso;
      error: ApiError;
    };

export type ServerMessageType = ServerMessage['type'];

/** Проверка «это сообщение новее уже применённого» — используется клиентом. */
export function isNewer(seq: number, lastAppliedSeq: number): boolean {
  return seq > lastAppliedSeq;
}
