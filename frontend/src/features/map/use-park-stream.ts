import {
  BookingSchema,
  RideSchema,
  SCOOTER_STATUSES,
  ScooterSchema,
  ServerMessageSchema,
  type Booking,
  type Ride,
  type Scooter,
} from '@sharing/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { readApiMode } from '../../lib/api';
import { useSessionStore } from '../../stores/session';

/** Адрес потока: тот же источник, что и страница (прокси Vite или nginx), схема — ws/wss. */
export function streamUrl(location: Location = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}/ws`;
}

const DELTA_SCHEMA = z.object({
  type: z.literal('park.delta'),
  seq: z.number(),
  changes: z.array(
    z.object({
      id: z.string(),
      status: z.enum(SCOOTER_STATUSES),
      batteryPct: z.number(),
      lat: z.number(),
      lng: z.number(),
      lastSeenAt: z.string(),
    }),
  ),
});

const SNAPSHOT_SCHEMA = z.object({
  type: z.literal('snapshot'),
  seq: z.number(),
  payload: z.object({
    scooters: z.array(ScooterSchema),
    myBooking: z.nullable(BookingSchema),
    myRide: z.nullable(RideSchema),
    serverTime: z.string(),
  }),
});

const BOOKING_CREATED_SCHEMA = z.object({ type: z.literal('booking.created'), booking: BookingSchema });
const BOOKING_CLOSED_SCHEMA = z.object({ type: z.literal('booking.expired') });
const RIDE_STARTED_SCHEMA = z.object({ type: z.literal('ride.started'), ride: RideSchema });
const RIDE_FINISHED_SCHEMA = z.object({ type: z.literal('ride.finished'), ride: RideSchema });

export interface ParkStreamState {
  scooters: Scooter[];
  connected: boolean;
  /** Пришли ли данные хотя бы раз: до этого момента показывать нечего. */
  ready: boolean;
  serverTime: string | null;
  /** Событие о брони или поездке: экраны перезапрашивают своё состояние. */
  changeTick: number;
}

/**
 * Живой поток парка.
 *
 * Сервер присылает снапшот при подписке и дальше только изменения. Сообщения с номером не больше
 * уже применённого отбрасываются: при реконнекте старые дельты не должны откатить состояние назад.
 * Обрыв связи не ломает экран — поток переподключается с растущей паузой, а состояние остаётся.
 */
export function useParkStream(): ParkStreamState {
  const [scooters, setScooters] = useState<Scooter[]>([]);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [changeTick, setChangeTick] = useState(0);

  const token = useSessionStore((state) => state.token);
  const mode = readApiMode();
  const lastSeqRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (mode !== 'http') {
      return;
    }

    let closed = false;
    let attempt = 0;
    let timer: number | null = null;

    const connect = (): void => {
      if (closed) {
        return;
      }
      const socket = new WebSocket(streamUrl());
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        attempt = 0;
        setConnected(true);
        socket.send(JSON.stringify({ type: 'subscribe', ...(token === null ? {} : { token }) }));
      });

      socket.addEventListener('message', (event) => {
        const parsed = ServerMessageSchema.safeParse(JSON.parse(String(event.data)));
        if (!parsed.success) {
          return;
        }
        const message = parsed.data;
        // Служебные сообщения (pong, ошибка) состоянием парка не управляют.
        if (message.type === 'pong' || message.type === 'error') {
          return;
        }
        if (message.seq <= lastSeqRef.current && message.type !== 'snapshot') {
          return;
        }
        lastSeqRef.current = message.seq;
        if ('serverTime' in message) {
          setServerTime(message.serverTime);
        }

        const snapshot = SNAPSHOT_SCHEMA.safeParse(message);
        if (snapshot.success) {
          setScooters(snapshot.data.payload.scooters);
          setReady(true);
          setChangeTick((value) => value + 1);
          return;
        }

        const delta = DELTA_SCHEMA.safeParse(message);
        if (delta.success) {
          setScooters((current) => {
            const byId = new Map(current.map((scooter) => [scooter.id, scooter]));
            for (const change of delta.data.changes) {
              const existing = byId.get(change.id);
              if (existing === undefined) {
                continue;
              }
              byId.set(change.id, {
                ...existing,
                status: change.status,
                batteryPct: change.batteryPct,
                lat: change.lat,
                lng: change.lng,
                lastSeenAt: change.lastSeenAt,
              });
            }
            return [...byId.values()];
          });
          return;
        }

        const bookingChanged =
          BOOKING_CREATED_SCHEMA.safeParse(message).success || BOOKING_CLOSED_SCHEMA.safeParse(message).success;
        const rideChanged =
          RIDE_STARTED_SCHEMA.safeParse(message).success || RIDE_FINISHED_SCHEMA.safeParse(message).success;
        if (bookingChanged || rideChanged) {
          // Событие затрагивает панели (бронь, поездка, счёт) — экраны перезапрашивают состояние.
          setChangeTick((value) => value + 1);
        }
      });

      const reconnect = (): void => {
        setConnected(false);
        socketRef.current = null;
        if (closed) {
          return;
        }
        attempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
        timer = window.setTimeout(connect, delay);
      };

      socket.addEventListener('close', reconnect);
      socket.addEventListener('error', () => {
        socket.close();
      });
    };

    connect();

    return () => {
      closed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [mode, token]);

  return useMemo(
    () => ({ scooters, connected, ready, serverTime, changeTick }),
    [scooters, connected, ready, serverTime, changeTick],
  );
}

/** Тип сообщения для отладки в браузере: список известных видов. */
export type ParkStreamEvent = Booking | Ride | null;
