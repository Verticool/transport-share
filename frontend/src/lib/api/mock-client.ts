import {
  BATTERY_DRAIN_PCT_PER_MIN,
  BOOKING_TTL_MINUTES,
  DEFAULT_TARIFF,
  LOW_BATTERY_THRESHOLD,
  ScooterSchema,
  SERVICE_ZONE,
  ServiceZoneSchema,
  calcRidePrice,
  isInsideZone,
  toIso,
  type Booking,
  type Iso,
  type Ride,
  type RidePause,
  type Scooter,
  type ServiceZone,
  type Tariff,
} from '@sharing/shared';
import { z } from 'zod';

import {
  ApiClientError,
  type ApiClient,
  type BookingSnapshot,
  type ParkSnapshot,
  type RideSnapshot,
} from './types';

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
  /** Активные поездки по идентификатору поездки. */
  rides: Map<string, Ride>;
  /** Паузы активных поездок по идентификатору поездки. */
  pauses: Map<string, RidePause[]>;
  /** Изменённый заряд самокатов: езда разряжает батарею, файл моков про это не знает. */
  battery: Map<string, number>;
  /** Заряд на момент старта поездки: расход считается от него, поэтому повторные чтения не копят погрешность. */
  batteryAtRideStart: Map<string, number>;
  /** Часы: инъекция, а не `Date.now()` напрямую (RULES §F). */
  now: () => number;
  /** Тариф, который «отдаёт сервер»: интерфейс цены не хранит. */
  tariff: Tariff;
}

export function createMockServerState(
  options: { now?: () => number; tariff?: Tariff } = {},
): MockServerState {
  return {
    bookings: new Map<string, Booking>(),
    rides: new Map<string, Ride>(),
    pauses: new Map<string, RidePause[]>(),
    battery: new Map<string, number>(),
    batteryAtRideStart: new Map<string, number>(),
    now: options.now ?? (() => Date.now()),
    tariff: options.tariff ?? DEFAULT_TARIFF,
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

  /** Самокаты из файла: порядок фиксирован, брони и поездки накладываются на статусы, заряд — из состояния. */
  private async loadScooters(): Promise<Scooter[]> {
    const raw = await this.fetchJson('/scooters.json');
    const parsed = z.array(ScooterSchema).safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные парка не прошли проверку');
    }

    const scooters = [...parsed.data].sort((left, right) => left.code.localeCompare(right.code, 'en'));
    return scooters.map((scooter) => {
      const batteryPct = this.state.battery.get(scooter.id) ?? scooter.batteryPct;
      const ride = [...this.state.rides.values()].find(
        (item) => item.scooterId === scooter.id && item.status !== 'finished',
      );
      const booking = this.state.bookings.get(scooter.id);

      // Порядок приоритетов: поездка важнее брони, бронь важнее файла, низкий заряд — недоступность.
      let status = scooter.status;
      if (ride !== undefined) {
        status = 'in_ride';
      } else if (booking !== undefined) {
        status = 'reserved';
      } else if (batteryPct < LOW_BATTERY_THRESHOLD) {
        status = 'unavailable';
      }

      return {
        ...scooter,
        status,
        batteryPct,
        updatedAt: ride?.updatedAt ?? booking?.updatedAt ?? scooter.updatedAt,
      };
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

    // Заряд активной поездки пересчитываем и здесь: список парка обязан показывать то же,
    // что и панель поездки, и автофиниш по разряду срабатывает даже без чтения поездки.
    const active = this.activeRide();
    if (active !== undefined) {
      this.drainBattery(active);
    }

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

  // ── Поездки ────────────────────────────────────────────────────────────────────────────────

  /** Поездка пользователя, которая ещё идёт (включая паузу). */
  private activeRide(): Ride | undefined {
    return [...this.state.rides.values()].find(
      (ride) => ride.userId === this.userId && ride.status !== 'finished',
    );
  }

  private ridesPauses(rideId: string): RidePause[] {
    return this.state.pauses.get(rideId) ?? [];
  }

  /**
   * Достаёт поездку текущего пользователя или сообщает, что её нет.
   *
   * Чужая поездка отдаётся тем же кодом, что и несуществующая: пользователю не нужно знать,
   * что идентификатор угадан верно.
   */
  private requireRide(rideId: string): Ride {
    const ride = this.state.rides.get(rideId);
    if (ride === undefined) {
      throw new ApiClientError('not_found', 'Поездка не найдена');
    }
    if (ride.userId !== this.userId) {
      throw new ApiClientError('not_found', 'Поездка не найдена');
    }
    return ride;
  }

  private rideSnapshot(ride: Ride): RideSnapshot {
    return {
      ride,
      pauses: this.ridesPauses(ride.id),
      tariff: this.state.tariff,
      serverTime: this.serverTime(),
    };
  }

  /**
   * Расход заряда за время езды (паузы не считаются) и автофиниш, если заряд кончился.
   *
   * Считается от заряда на момент старта: повторные чтения снапшота не должны «съедать» батарею
   * несколько раз — иначе счётчик заряда в интерфейсе поедет вниз от каждого обновления.
   */
  private drainBattery(ride: Ride): void {
    const startBattery = this.state.batteryAtRideStart.get(ride.id) ?? 0;
    const nowMs = this.state.now();
    const breakdown = calcRidePrice(ride, this.ridesPauses(ride.id), nowMs, this.state.tariff);
    const batteryPct = Math.max(0, startBattery - breakdown.rideMinutes * BATTERY_DRAIN_PCT_PER_MIN);
    this.state.battery.set(ride.scooterId, batteryPct);

    if (batteryPct === 0 && ride.status !== 'finished') {
      this.closeRide(ride, nowMs, 'battery_depleted');
    }
  }

  /** Закрывает поездку: закрывает открытую паузу, считает итог и возвращает самокат в парк. */
  private closeRide(ride: Ride, nowMs: number, reason: Ride['endReason']): void {
    const pauses = this.ridesPauses(ride.id);
    const openPause = pauses.find((pause) => pause.endedAt === null);
    if (openPause !== undefined) {
      openPause.endedAt = toIso(nowMs);
      openPause.updatedAt = toIso(nowMs);
    }

    ride.finishedAt = toIso(nowMs);
    ride.endReason = reason;
    ride.status = 'finished';
    ride.totalAmount = calcRidePrice(ride, pauses, nowMs, this.state.tariff).total;
    ride.updatedAt = toIso(nowMs);
  }

  async getActiveRide(): Promise<RideSnapshot | null> {
    await this.applyDelay();
    this.expireBookings();

    const ride = this.activeRide();
    if (ride === undefined) {
      return null;
    }

    this.drainBattery(ride);
    return this.rideSnapshot(ride);
  }

  async startRide(bookingId: string): Promise<RideSnapshot> {
    await this.applyDelay();
    this.expireBookings();

    const booking = [...this.state.bookings.values()].find((item) => item.id === bookingId);
    if (booking === undefined) {
      throw new ApiClientError('not_found', 'Бронь не найдена — возможно, срок уже истёк');
    }
    if (booking.userId !== this.userId) {
      throw new ApiClientError('conflict', 'Эта бронь оформлена на другого пользователя');
    }
    if (booking.status !== 'active') {
      throw new ApiClientError('conflict', 'Бронь уже не действует');
    }
    if (this.activeRide() !== undefined) {
      throw new ApiClientError('conflict', 'У вас уже идёт поездка');
    }

    const nowMs = this.state.now();
    const scooter = (await this.loadScooters()).find((item) => item.id === booking.scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }

    const ride: Ride = {
      id: `rd-${booking.scooterId}-${nowMs}`,
      userId: this.userId,
      scooterId: booking.scooterId,
      bookingId: booking.id,
      status: 'active',
      startedAt: toIso(nowMs),
      finishedAt: null,
      endReason: null,
      distanceM: 0,
      totalAmount: null,
      currency: this.state.tariff.currency,
      createdAt: toIso(nowMs),
      updatedAt: toIso(nowMs),
    };

    this.state.rides.set(ride.id, ride);
    this.state.pauses.set(ride.id, []);
    this.state.batteryAtRideStart.set(ride.id, scooter.batteryPct);
    this.state.battery.set(booking.scooterId, scooter.batteryPct);

    // Бронь израсходована: самокат больше не «забронирован», он «в поездке».
    booking.status = 'consumed';
    booking.closedAt = toIso(nowMs);
    booking.updatedAt = toIso(nowMs);
    this.state.bookings.delete(booking.scooterId);

    return this.rideSnapshot(ride);
  }

  async pauseRide(rideId: string): Promise<RideSnapshot> {
    await this.applyDelay();

    const ride = this.requireRide(rideId);
    if (ride.status === 'finished') {
      throw new ApiClientError('conflict', 'Поездка уже завершена');
    }
    if (ride.status === 'paused') {
      throw new ApiClientError('conflict', 'Поездка уже на паузе');
    }

    const nowMs = this.state.now();
    ride.status = 'paused';
    ride.updatedAt = toIso(nowMs);
    this.state.pauses.get(rideId)?.push({
      id: `ps-${rideId}-${nowMs}`,
      rideId,
      startedAt: toIso(nowMs),
      endedAt: null,
      createdAt: toIso(nowMs),
      updatedAt: toIso(nowMs),
    });
    this.drainBattery(ride);

    return this.rideSnapshot(ride);
  }

  async resumeRide(rideId: string): Promise<RideSnapshot> {
    await this.applyDelay();

    const ride = this.requireRide(rideId);
    if (ride.status !== 'paused') {
      throw new ApiClientError('conflict', 'Поездка не на паузе');
    }

    const nowMs = this.state.now();
    const openPause = this.ridesPauses(rideId).find((pause) => pause.endedAt === null);
    if (openPause !== undefined) {
      openPause.endedAt = toIso(nowMs);
      openPause.updatedAt = toIso(nowMs);
    }
    ride.status = 'active';
    ride.updatedAt = toIso(nowMs);
    this.drainBattery(ride);

    return this.rideSnapshot(ride);
  }

  async finishRide(rideId: string): Promise<RideSnapshot> {
    await this.applyDelay();

    const ride = this.requireRide(rideId);
    if (ride.status === 'finished') {
      throw new ApiClientError('conflict', 'Поездка уже завершена');
    }

    const scooter = (await this.loadScooters()).find((item) => item.id === ride.scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }

    // Требование ТЗ: завершить поездку вне зоны обслуживания нельзя.
    if (!isInsideZone({ lat: scooter.lat, lng: scooter.lng }, SERVICE_ZONE)) {
      throw new ApiClientError(
        'outside_zone',
        'Здесь завершить поездку нельзя — вернитесь в зону обслуживания',
      );
    }

    this.closeRide(ride, this.state.now(), 'user');
    return this.rideSnapshot(ride);
  }
}

/** Сброс общего состояния мок-сервера: нужен тестам, чтобы брони не протекали между ними. */
export function resetMockServerState(): void {
  defaultState.bookings.clear();
  defaultState.rides.clear();
  defaultState.pauses.clear();
  defaultState.battery.clear();
  defaultState.batteryAtRideStart.clear();
}
