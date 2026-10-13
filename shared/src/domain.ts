/**
 * Доменные типы сервиса шеринга самокатов.
 * Источник истины — docs/DOMAIN.md. Меняем только вместе с ним.
 *
 * Деньги: только целые числа в минорных единицах (тыйын, 1 сом = 100 тыйын).
 * Время: в БД timestamptz, в API — ISO-8601 UTC (Iso), в ws-сообщениях — unix ms.
 */

/** Целое число в минорных единицах валюты (тыйын). Никогда не float. */
export type Minor = number;

/** ISO-8601 строка в UTC, например '2026-10-13T09:41:00.000Z'. */
export type Iso = string;

/** Unix-время в миллисекундах (ws-сообщения, таймеры клиента). */
export type UnixMs = number;

export const SCOOTER_STATUSES = ['free', 'reserved', 'in_ride', 'unavailable'] as const;
export type ScooterStatus = (typeof SCOOTER_STATUSES)[number];

export const BOOKING_STATUSES = ['active', 'consumed', 'expired', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const RIDE_STATUSES = ['active', 'paused', 'finished'] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Почему поездка завершилась. `user` — сам пользователь, `battery_depleted` — сел заряд, `service` — принудительно системой. */
export const END_REASONS = ['user', 'battery_depleted', 'service'] as const;
export type EndReason = (typeof END_REASONS)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Iso;
  updatedAt: Iso;
}

/** Пользователь, отдаваемый наружу: без хеша пароля. */
export type PublicUser = Omit<User, 'createdAt' | 'updatedAt'> & {
  createdAt: Iso;
  updatedAt: Iso;
};

export interface Scooter {
  id: string;
  /** Человекочитаемый код, например 'SC-001'. */
  code: string;
  model: string;
  status: ScooterStatus;
  /** Заряд, 0–100, целое. */
  batteryPct: number;
  lat: number;
  lng: number;
  /** Когда самокат последний раз отдал телеметрию. */
  lastSeenAt: Iso;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Booking {
  id: string;
  userId: string;
  scooterId: string;
  status: BookingStatus;
  reservedAt: Iso;
  /** reservedAt + BOOKING_TTL_MINUTES. */
  expiresAt: Iso;
  /** Момент отправки предупреждения «осталось 3 минуты», null если ещё не отправляли. */
  notifiedAt: Iso | null;
  closedAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
}

/** Интервал паузы внутри поездки. Пауза тарифицируется по своему тарифу. */
export interface RidePause {
  id: string;
  rideId: string;
  startedAt: Iso;
  /** null — пауза ещё идёт. */
  endedAt: Iso | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Ride {
  id: string;
  userId: string;
  scooterId: string;
  bookingId: string;
  status: RideStatus;
  startedAt: Iso;
  finishedAt: Iso | null;
  endReason: EndReason | null;
  distanceM: number;
  /** Итог, минорные единицы. null пока поездка не завершена. */
  totalAmount: Minor | null;
  currency: string;
  createdAt: Iso;
  updatedAt: Iso;
}

/** Разбор счёта: что именно списано. Все суммы — минорные единицы. */
export interface InvoiceBreakdown {
  unlockFee: Minor;
  rideMinutes: number;
  rideAmount: Minor;
  pauseMinutes: number;
  pauseAmount: Minor;
  total: Minor;
}

export interface Invoice {
  id: string;
  rideId: string;
  userId: string;
  amount: Minor;
  currency: string;
  breakdown: InvoiceBreakdown;
  issuedAt: Iso;
  createdAt: Iso;
}

/** Эмуляция почты: письмо живёт в БД и видно на экране «Входящие». */
export interface EmailMessage {
  id: string;
  userId: string;
  toEmail: string;
  subject: string;
  body: string;
  /** Ключ дедупликации: одно письмо на поездку/событие. */
  dedupeKey: string;
  sentAt: Iso;
  createdAt: Iso;
}

/** Точка телеметрии (append-only). */
export interface RidePoint {
  id: number;
  rideId: string;
  lat: number;
  lng: number;
  batteryPct: number;
  recordedAt: Iso;
}

export const RIDE_EVENT_TYPES = [
  'ride_started',
  'ride_paused',
  'ride_resumed',
  'ride_finished',
  'booking_created',
  'booking_expiring',
  'booking_expired',
  'booking_cancelled',
  'battery_depleted',
  'zone_violation_rejected',
] as const;
export type RideEventType = (typeof RIDE_EVENT_TYPES)[number];

/** Событие домена (append-only): аудит и основа для писем/WS. */
export interface RideEvent {
  id: number;
  rideId: string | null;
  scooterId: string | null;
  type: RideEventType;
  payload: Record<string, unknown>;
  recordedAt: Iso;
}

/** Зона обслуживания: полигон WGS84, порядок точек против часовой стрелки. */
export interface ServiceZone {
  name: string;
  /** Пары [lat, lng]. Первая точка не дублируется в конце. */
  polygon: [number, number][];
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Ошибка API: единый формат для всех ручек. */
export interface ApiError {
  code: string;
  message: string;
  /**
   * Подробности ошибки.
   *
   * `| undefined` указан явно: при `exactOptionalPropertyTypes` «свойство отсутствует» и «свойство
   * равно undefined» — разные типы, и без этого схема zod и тип расходились бы, ломая проверку
   * сообщений на границе (это и обнаружилось при первой же сборке живого сервера).
   */
  details?: Record<string, unknown> | undefined;
}
