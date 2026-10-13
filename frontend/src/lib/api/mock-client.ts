import {
  BOOKING_TTL_MINUTES,
  ScooterSchema,
  ServiceZoneSchema,
  toIso,
  type Booking,
  type Iso,
  type Scooter,
  type ServiceZone,
} from '@sharing/shared';
import { z } from 'zod';

import { ApiClientError, type ApiClient, type BookingSnapshot, type ParkSnapshot } from './types';

export interface MockApiClientOptions {
  /** Префикс пути к статике мок-данных; по умолчанию — относительный корень. */
  baseUrl?: string;
  /** Нижняя граница имитируемой задержки сети, мс. */
  minDelayMs?: number;
  /** Верхняя граница имитируемой задержки сети, мс. */
  maxDelayMs?: number;
  /** Состояние мок-сервера: общее по умолчанию, отдельное — в тестах. */
  state?: MockServerState;
  /** Пользователь, от имени которого работает клиент: два клиента с одним состоянием — это «двое». */
  userId?: string;
}

/**
 * Состояние мок-сервера.
 *
 * Бронь — это данные сервера, а не интерфейса: только так выполняется правило «один самокат
 * нельзя забронировать дважды, даже одновременно» и автоснятие по истечении срока. Пока бэкенда
 * нет (S8–S10), его роль играет этот объект; на S11 его место займёт настоящий сервер, а
 * `ApiClient` и компоненты останутся без правок.
 */
export interface MockServerState {
  bookings: Map<string, Booking>;
  /** Часы: инъекция, а не `Date.now()` напрямую (RULES §F). */
  now: () => number;
}

export function createMockServerState(options: { now?: () => number } = {}): MockServerState {
  return {
    bookings: new Map<string, Booking>(),
    now: options.now ?? (() => Date.now()),
  };
}

const defaultState = createMockServerState();

/**
 * Клиент мок-данных: читает парк статикой по HTTP и держит состояние брони, как это делал бы сервер.
 *
 * Почему HTTP, а не чтение файлов: этот клиент работает в браузере. Файлы `mock/*.json`
 * подключены к Vite как `publicDir`, поэтому доступны по обычным относительным путям —
 * тот же код переживёт замену на настоящий сервер (S11), поменяется только `baseUrl`.
 */
export class MockApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly state: MockServerState;
  private readonly userId: string;

  constructor(options: MockApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.minDelayMs = options.minDelayMs ?? 120;
    this.maxDelayMs = options.maxDelayMs ?? 300;
    this.state = options.state ?? defaultState;
    this.userId = options.userId ?? 'mock-user';
  }

  /** Имитация сети: интерфейс должен проверяться вместе с состояниями загрузки, а не мгновенно. */
  private async applyDelay(): Promise<void> {
    const delay =
      this.minDelayMs === this.maxDelayMs
        ? this.minDelayMs
        : Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
    await new Promise((done) => setTimeout(done, delay));
  }

  private serverTime(): Iso {
    return toIso(this.state.now());
  }

  /** Снимает брони, срок которых истёк: самокат снова свободен (требование «через 15 минут сама»). */
  private expireBookings(): void {
    const nowMs = this.state.now();
    for (const [scooterId, booking] of this.state.bookings) {
      if (Date.parse(booking.expiresAt) <= nowMs && booking.status === 'active') {
        booking.status = 'expired';
        booking.closedAt = toIso(nowMs);
        booking.updatedAt = toIso(nowMs);
        this.state.bookings.delete(scooterId);
      }
    }
  }

  /** Забирает JSON по относительному пути и приводит сбои к единому виду. */
  private async fetchJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`);
    } catch {
      throw new ApiClientError('network', 'Не удалось связаться с источником данных');
    }

    if (!response.ok) {
      throw new ApiClientError('network', 'Данные недоступны: источник ответил ошибкой');
    }

    try {
      const raw: unknown = await response.json();
      return raw;
    } catch {
      throw new ApiClientError('invalid_payload', 'Ответ источника не удалось прочитать');
    }
  }

  /** Самокаты из файла: порядок фиксирован, брони накладываются на статусы. */
  private async loadScooters(): Promise<Scooter[]> {
    const raw = await this.fetchJson('/scooters.json');
    const parsed = z.array(ScooterSchema).safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные парка не прошли проверку');
    }

    const scooters = [...parsed.data].sort((left, right) => left.code.localeCompare(right.code, 'en'));
    return scooters.map((scooter) => {
      const booking = this.state.bookings.get(scooter.id);
      if (booking === undefined) {
        return scooter;
      }
      return { ...scooter, status: 'reserved', updatedAt: booking.updatedAt };
    });
  }

  async getZone(): Promise<ServiceZone> {
    await this.applyDelay();
    const raw = await this.fetchJson('/service-zone.json');
    const parsed = ServiceZoneSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные зоны обслуживания не прошли проверку');
    }
    return parsed.data;
  }

  async getPark(): Promise<ParkSnapshot> {
    await this.applyDelay();
    this.expireBookings();
    return { scooters: await this.loadScooters(), serverTime: this.serverTime() };
  }

  async getActiveBooking(): Promise<BookingSnapshot | null> {
    await this.applyDelay();
    this.expireBookings();

    for (const booking of this.state.bookings.values()) {
      if (booking.userId === this.userId && booking.status === 'active') {
        return { booking, serverTime: this.serverTime() };
      }
    }
    return null;
  }

  async createBooking(scooterId: string): Promise<BookingSnapshot> {
    await this.applyDelay();
    this.expireBookings();

    const mine = [...this.state.bookings.values()].find(
      (booking) => booking.userId === this.userId && booking.status === 'active',
    );
    if (mine !== undefined) {
      throw new ApiClientError('conflict', 'У вас уже есть активная бронь');
    }

    if (this.state.bookings.has(scooterId)) {
      throw new ApiClientError('conflict', 'Этот самокат уже забронирован');
    }

    const scooters = await this.loadScooters();
    const scooter = scooters.find((item) => item.id === scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }
    if (scooter.status !== 'free') {
      throw new ApiClientError('conflict', 'Этот самокат сейчас недоступен');
    }

    const nowMs = this.state.now();
    const booking: Booking = {
      id: `bk-${scooterId}-${nowMs}`,
      userId: this.userId,
      scooterId,
      status: 'active',
      reservedAt: toIso(nowMs),
      expiresAt: toIso(nowMs + BOOKING_TTL_MINUTES * 60_000),
      notifiedAt: null,
      closedAt: null,
      createdAt: toIso(nowMs),
      updatedAt: toIso(nowMs),
    };

    this.state.bookings.set(scooterId, booking);
    return { booking, serverTime: this.serverTime() };
  }

  async cancelBooking(bookingId: string): Promise<void> {
    await this.applyDelay();
    this.expireBookings();

    for (const [scooterId, booking] of this.state.bookings) {
      if (booking.id !== bookingId) {
        continue;
      }
      const nowMs = this.state.now();
      booking.status = 'cancelled';
      booking.closedAt = toIso(nowMs);
      booking.updatedAt = toIso(nowMs);
      this.state.bookings.delete(scooterId);
      return;
    }

    throw new ApiClientError('not_found', 'Бронь не найдена');
  }
}

/** Сброс общего состояния мок-сервера: нужен тестам, чтобы брони не протекали между ними. */
export function resetMockServerState(): void {
  defaultState.bookings.clear();
}
