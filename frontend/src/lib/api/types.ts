import type { Booking, Iso, Scooter, ServiceZone } from '@sharing/shared';

/** Снимок парка: список самокатов + серверное время (RULES §D: время считаем от сервера). */
export interface ParkSnapshot {
  scooters: Scooter[];
  /** ISO-8601 UTC; на моках — время клиента, на реальном API — `server_time` из ответа. */
  serverTime: Iso;
}

/** Активная бронь вместе с серверным временем: отсчёт идёт от него, а не от часов клиента. */
export interface BookingSnapshot {
  booking: Booking;
  serverTime: Iso;
}

export interface ApiClient {
  /** Зона обслуживания (полигон). */
  getZone(): Promise<ServiceZone>;
  /** Парк: все самокаты со статусами и зарядом. */
  getPark(): Promise<ParkSnapshot>;
  /** Текущая активная бронь пользователя, если она есть. */
  getActiveBooking(): Promise<BookingSnapshot | null>;
  /**
   * Забронировать самокат. Если самокат уже занят другим пользователем — ошибка с кодом `conflict`:
   * правило «один самокат — одна бронь» проверяет источник данных, а не интерфейс.
   */
  createBooking(scooterId: string): Promise<BookingSnapshot>;
  /** Снять бронь (пользователь передумал): самокат снова свободен. */
  cancelBooking(bookingId: string): Promise<void>;
}

/** Коды ошибок клиента: интерфейс различает их, чтобы показать понятный текст. */
export type ApiErrorCode = 'network' | 'invalid_payload' | 'conflict' | 'not_found';

/** Ошибка уровня клиента: единый формат для моков и будущего http-клиента. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
