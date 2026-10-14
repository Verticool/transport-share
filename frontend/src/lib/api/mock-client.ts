import {
  BATTERY_DRAIN_PCT_PER_MIN,
  BOOKING_TTL_MINUTES,
  DEFAULT_TARIFF,
  EmailMessageSchema,
  InvoiceSchema,
  LOW_BATTERY_THRESHOLD,
  PublicUserSchema,
  RideSchema,
  ScooterSchema,
  SERVICE_ZONE,
  ServiceZoneSchema,
  calcRidePrice,
  clampToZone,
  formatMinor,
  isInsideZone,
  moveTowards,
  steeredPosition,
  zoneCenter,
  toIso,
  type Booking,
  type EmailMessage,
  type Invoice,
  type Iso,
  type PublicUser,
  type Ride,
  type RidePause,
  type Scooter,
  type ServiceZone,
  type SteerDirection,
  type Tariff,
} from '@sharing/shared';
import { z, type ZodType } from 'zod';

import {
  ApiClientError,
  type ApiClient,
  type BookingSnapshot,
  type Page,
  type PageQuery,
  type ParkSnapshot,
  type RideSnapshot,
  type SessionSnapshot,
} from './types';

/**
 * Пароль демонстрационного пользователя.
 *
 * В мок-данных паролей нет и быть не должно: файл лежит в репозитории. Поэтому на время
 * мок-стадии пароль один и указан здесь явно, а на S11 его проверит сервер по хешу из БД.
 */
const DEMO_PASSWORD = 'demo1234';

export interface MockApiClientOptions {
  /** Префикс пути к статике мок-данных; по умолчанию — относительный корень. */
  baseUrl?: string;
  /** Нижняя граница имитируемой задержки сети, мс. */
  minDelayMs?: number;
  /** Верхняя граница имитируемой задержки сети, мс. */
  maxDelayMs?: number;
  /** Состояние мок-сервера: общее по умолчанию, отдельное — в тестах. */
  state?: MockServerState;
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
  /** Изменённое положение самокатов: в мок-режиме его меняет возврат в зону из-за границы. */
  positions: Map<string, { lat: number; lng: number }>;
  /** Заряд на момент старта поездки: расход считается от него, поэтому повторные чтения не копят погрешность. */
  batteryAtRideStart: Map<string, number>;
  /** Счета, выпущенные в этой сессии (по завершении поездки). */
  invoices: Invoice[];
  /** Письма, отправленные в этой сессии: счёт и уведомления. */
  emails: EmailMessage[];
  /** Часы: инъекция, а не `Date.now()` напрямую (RULES §F). */
  now: () => number;
  /** Тариф, который «отдаёт сервер»: интерфейс цены не хранит. */
  tariff: Tariff;
  /** Выданные токены: токен → идентификатор пользователя. */
  tokens: Map<string, string>;
  /** Погашенные токены: после выхода токен не должен работать, даже если он самодостаточен. */
  revoked: Set<string>;
  /** Почта пользователя по его идентификатору: нужна для писем о счёте. */
  emailByUser: Map<string, string>;
  /** Код самоката по его идентификатору: письма и счета называют самокат «SC-013», а не внутренним id. */
  scooterCodes: Map<string, string>;
}

/**
 * Разбирает идентификатор пользователя из токена.
 *
 * Токен устроен как `tk-<идентификатор пользователя>-<момент выдачи>`. Разбирать его, а не искать
 * в карте выданных, нужно по одной причине: настоящий сервер проверяет токен независимо от того,
 * помнит ли его процесс. Иначе после перезагрузки страницы сессия из localStorage перестала бы
 * работать — интерфейс считал бы пользователя вошедшим, а данные отвечали бы «войдите».
 */
function userIdFromToken(token: string): string | null {
  if (!token.startsWith('tk-')) {
    return null;
  }

  const rest = token.slice(3);
  const separator = rest.lastIndexOf('-');
  return separator > 0 ? rest.slice(0, separator) : null;
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
    positions: new Map<string, { lat: number; lng: number }>(),
    invoices: [],
    emails: [],
    now: options.now ?? (() => Date.now()),
    tariff: options.tariff ?? DEFAULT_TARIFF,
    tokens: new Map<string, string>(),
    revoked: new Set<string>(),
    emailByUser: new Map<string, string>(),
    scooterCodes: new Map<string, string>(),
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

  constructor(options: MockApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.minDelayMs = options.minDelayMs ?? 120;
    this.maxDelayMs = options.maxDelayMs ?? 300;
    this.state = options.state ?? defaultState;
  }

  /**
   * От чьeго имени выполняется запрос: пользователя определяет токен, а не настройка клиента.
   * Так же будет вести себя сервер (S11): у него нет «текущего пользователя» помимо токена.
   */
  private async requireUserId(token: string): Promise<string> {
    return (await this.userByToken(token)).id;
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

  /** Читает JSON-массив статики и проверяет каждую запись схемой. */
  private async fetchArray<T>(path: string, schema: ZodType<T>): Promise<T[]> {
    const raw = await this.fetchJson(path);
    const parsed = z.array(schema).safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные источника не прошли проверку');
    }
    return parsed.data;
  }

  /** Пользователь по токену: недействительный токен — это отказ в доступе, а не «не найдено». */
  private async userByToken(token: string): Promise<PublicUser> {
    const userId = this.state.revoked.has(token)
      ? null
      : (this.state.tokens.get(token) ?? userIdFromToken(token));

    if (userId === null) {
      throw new ApiClientError('unauthorized', 'Нужно войти в аккаунт');
    }

    const users = await this.fetchArray('/users.json', PublicUserSchema);
    const user = users.find((item) => item.id === userId);
    if (user === undefined) {
      throw new ApiClientError('unauthorized', 'Нужно войти в аккаунт');
    }
    return user;
  }

  /** Самокаты из файла: порядок фиксирован, брони и поездки накладываются на статусы, заряд — из состояния. */
  private async loadScooters(): Promise<Scooter[]> {
    const raw = await this.fetchJson('/scooters.json');
    const parsed = z.array(ScooterSchema).safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные парка не прошли проверку');
    }

    const scooters = [...parsed.data].sort((left, right) => left.code.localeCompare(right.code, 'en'));
    // Коды самокатов запоминаем: они нужны в письмах и счетах, где известен только идентификатор.
    for (const scooter of scooters) {
      this.state.scooterCodes.set(scooter.id, scooter.code);
    }
    return scooters.map((scooter) => {
      const batteryPct = this.state.battery.get(scooter.id) ?? scooter.batteryPct;
      const position = this.state.positions.get(scooter.id);
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
        lat: position?.lat ?? scooter.lat,
        lng: position?.lng ?? scooter.lng,
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
    const active = this.activeRides();
    for (const ride of active) {
      this.drainBattery(ride);
    }

    return { scooters: await this.loadScooters(), serverTime: this.serverTime() };
  }

  async getActiveBooking(token: string): Promise<BookingSnapshot | null> {
    await this.applyDelay();
    this.expireBookings();
    const userId = await this.requireUserId(token);

    for (const booking of this.state.bookings.values()) {
      if (booking.userId === userId && booking.status === 'active') {
        return { booking, serverTime: this.serverTime() };
      }
    }
    return null;
  }

  async createBooking(scooterId: string, token: string): Promise<BookingSnapshot> {
    await this.applyDelay();
    this.expireBookings();
    const userId = await this.requireUserId(token);

    const mine = [...this.state.bookings.values()].find(
      (booking) => booking.userId === userId && booking.status === 'active',
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
      userId: userId,
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

  async cancelBooking(bookingId: string, token: string): Promise<void> {
    await this.applyDelay();
    this.expireBookings();
    const user = await this.userByToken(token);

    for (const [scooterId, booking] of this.state.bookings) {
      if (booking.id !== bookingId) {
        continue;
      }
      if (booking.userId !== user.id) {
        // Чужую бронь снять нельзя: это проверка доступа, а не отсутствие записи.
        throw new ApiClientError('unauthorized', 'Эта бронь оформлена на другого пользователя');
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
  private activeRide(userId: string): Ride | undefined {
    return [...this.state.rides.values()].find(
      (ride) => ride.userId === userId && ride.status !== 'finished',
    );
  }

  /** Все незавершённые поездки: парк разряжается по всем сразу, а не только по своей. */
  private activeRides(): Ride[] {
    return [...this.state.rides.values()].filter((ride) => ride.status !== 'finished');
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
  private requireRide(rideId: string, userId: string): Ride {
    const ride = this.state.rides.get(rideId);
    if (ride === undefined) {
      throw new ApiClientError('not_found', 'Поездка не найдена');
    }
    if (ride.userId !== userId) {
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

  /** Закрывает поездку: закрывает открытую паузу, считает итог и выпускает счёт с письмом. */
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
    const breakdown = calcRidePrice(ride, pauses, nowMs, this.state.tariff);
    ride.totalAmount = breakdown.total;
    ride.updatedAt = toIso(nowMs);

    this.issueInvoice(ride, breakdown, nowMs, reason);
  }

  /**
   * Выпускает счёт и письмо о завершённой поездке.
   *
   * Дедупликация по ключу `invoice:<rideId>`: требование ТЗ — по завершении приходит ровно одно
   * письмо. Повторный вызов (например, из автофиниша после ручного завершения) новое не создаёт.
   */
  private issueInvoice(
    ride: Ride,
    breakdown: ReturnType<typeof calcRidePrice>,
    nowMs: number,
    reason: Ride['endReason'],
  ): void {
    const dedupeKey = `invoice:${ride.id}`;
    if (this.state.invoices.some((invoice) => invoice.rideId === ride.id)) {
      return;
    }

    const invoice: Invoice = {
      id: `inv-${ride.id}`,
      rideId: ride.id,
      userId: ride.userId,
      amount: breakdown.total,
      currency: this.state.tariff.currency,
      breakdown,
      issuedAt: toIso(nowMs),
      createdAt: toIso(nowMs),
    };
    this.state.invoices.push(invoice);

    const reasonNote =
      reason === 'battery_depleted'
        ? ' Поездка завершена автоматически: у самоката закончился заряд.'
        : '';
    const scooterCode = this.state.scooterCodes.get(ride.scooterId) ?? 'самокате';
    const email: EmailMessage = {
      id: `em-${ride.id}`,
      userId: ride.userId,
      // Адрес известен из входа; на S11 его подставит сервер по идентификатору пользователя.
      toEmail: this.state.emailByUser.get(ride.userId) ?? 'demo@sharing.kg',
      subject: `Счёт за поездку ${scooterCode}`,
      body: `Спасибо за поездку! Итого: ${formatMinor(breakdown.total, this.state.tariff.currencySymbol)}. Время в пути: ${breakdown.rideMinutes} мин, паузы: ${breakdown.pauseMinutes} мин.${reasonNote}`,
      dedupeKey,
      sentAt: toIso(nowMs),
      createdAt: toIso(nowMs),
    };
    this.state.emails.push(email);
  }

  async getActiveRide(token: string): Promise<RideSnapshot | null> {
    await this.applyDelay();
    this.expireBookings();
    const userId = await this.requireUserId(token);

    const ride = this.activeRide(userId);
    if (ride === undefined) {
      return null;
    }

    this.drainBattery(ride);
    return this.rideSnapshot(ride);
  }

  async startRide(bookingId: string, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    this.expireBookings();
    const userId = await this.requireUserId(token);

    const booking = [...this.state.bookings.values()].find((item) => item.id === bookingId);
    if (booking === undefined) {
      throw new ApiClientError('not_found', 'Бронь не найдена — возможно, срок уже истёк');
    }
    if (booking.userId !== userId) {
      throw new ApiClientError('conflict', 'Эта бронь оформлена на другого пользователя');
    }
    if (booking.status !== 'active') {
      throw new ApiClientError('conflict', 'Бронь уже не действует');
    }
    if (this.activeRide(userId) !== undefined) {
      throw new ApiClientError('conflict', 'У вас уже идёт поездка');
    }

    const nowMs = this.state.now();
    const scooter = (await this.loadScooters()).find((item) => item.id === booking.scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }

    const ride: Ride = {
      id: `rd-${booking.scooterId}-${nowMs}`,
      userId: userId,
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

  async pauseRide(rideId: string, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    const userId = await this.requireUserId(token);

    const ride = this.requireRide(rideId, userId);
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

  async resumeRide(rideId: string, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    const userId = await this.requireUserId(token);

    const ride = this.requireRide(rideId, userId);
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

  async finishRide(rideId: string, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    const userId = await this.requireUserId(token);

    const ride = this.requireRide(rideId, userId);
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

  /** Самокат вне зоны: мотор заблокирован. Действие возвращает его в зону, как если бы довезли. */
  async pushRideToZone(rideId: string, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    const userId = await this.requireUserId(token);
    const ride = this.requireRide(rideId, userId);
    if (ride.status === 'finished') {
      throw new ApiClientError('conflict', 'Поездка уже завершена');
    }

    const scooters = await this.loadScooters();
    const scooter = scooters.find((item) => item.id === ride.scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }
    if (isInsideZone({ lat: scooter.lat, lng: scooter.lng }, SERVICE_ZONE)) {
      throw new ApiClientError('conflict', 'Самокат уже в зоне обслуживания');
    }

    // Возврат в зону: точка на границе плюс шаг внутрь — ровно на линии быть не должно.
    const onBoundary = clampToZone({ lat: scooter.lat, lng: scooter.lng }, SERVICE_ZONE);
    const inside = moveTowards(onBoundary, zoneCenter(SERVICE_ZONE), 25);
    this.state.positions.set(scooter.id, inside);

    return this.rideSnapshot(ride);
  }

  async steerRide(rideId: string, direction: SteerDirection, token: string): Promise<RideSnapshot> {
    await this.applyDelay();
    const userId = await this.requireUserId(token);
    const ride = this.requireRide(rideId, userId);
    if (ride.status === 'finished') {
      throw new ApiClientError('conflict', 'Поездка уже завершена');
    }
    if (ride.status === 'paused') {
      // Пауза — это выключенный мотор: самокат не должен ехать ни сам, ни по кнопке.
      throw new ApiClientError('conflict', 'На паузе самокат не двигается: сначала продолжите поездку');
    }

    const scooters = await this.loadScooters();
    const scooter = scooters.find((item) => item.id === ride.scooterId);
    if (scooter === undefined) {
      throw new ApiClientError('not_found', 'Самокат не найден');
    }

    const position = this.state.positions.get(scooter.id) ?? { lat: scooter.lat, lng: scooter.lng };
    this.state.positions.set(scooter.id, steeredPosition(position, direction));

    return this.rideSnapshot(ride);
  }

  // ── Аккаунт и кабинет ──────────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<SessionSnapshot> {
    await this.applyDelay();

    const users = await this.fetchArray('/users.json', PublicUserSchema);
    const user = users.find((item) => item.email.toLowerCase() === email.trim().toLowerCase());

    // Одинаковый текст для «нет такого пользователя» и «неверный пароль»: не подсказываем,
    // какие адреса зарегистрированы.
    if (user === undefined || password !== DEMO_PASSWORD) {
      throw new ApiClientError('unauthorized', 'Неверная почта или пароль');
    }

    const token = `tk-${user.id}-${this.state.now()}`;
    // Разделение «доступ/обновление» есть и здесь: интерфейс не должен знать, где мок, а где сервер.
    const refreshToken = `rt-${user.id}-${this.state.now()}`;
    this.state.tokens.set(token, user.id);
    this.state.tokens.set(refreshToken, user.id);
    this.state.emailByUser.set(user.id, user.email);

    return { user, token, refreshToken };
  }

  async logout(token: string): Promise<void> {
    await this.applyDelay();
    this.state.tokens.delete(token);
    this.state.revoked.add(token);
    for (const known of [...this.state.tokens.keys()]) {
      if (known.startsWith('rt-')) {
        this.state.tokens.delete(known);
        this.state.revoked.add(known);
      }
    }
  }

  async getMe(token: string): Promise<PublicUser> {
    await this.applyDelay();
    return this.userByToken(token);
  }

  async getRides(query: PageQuery, token: string): Promise<Page<Ride>> {
    await this.applyDelay();

    const user = await this.userByToken(token);
    const stored = await this.fetchArray('/rides.json', RideSchema);
    // Поездки этой сессии живут в состоянии: они свежее файла и тоже часть истории.
    const fromState = [...this.state.rides.values()];

    const byId = new Map<string, Ride>();
    for (const ride of [...stored, ...fromState]) {
      if (ride.userId === user.id) {
        byId.set(ride.id, ride);
      }
    }

    const mine = [...byId.values()].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );

    return {
      items: mine.slice(query.offset, query.offset + query.limit),
      total: mine.length,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getInvoices(token: string): Promise<Invoice[]> {
    await this.applyDelay();

    const user = await this.userByToken(token);
    const stored = await this.fetchArray('/invoices.json', InvoiceSchema);

    const byId = new Map<string, Invoice>();
    for (const invoice of [...stored, ...this.state.invoices]) {
      if (invoice.userId === user.id) {
        byId.set(invoice.id, invoice);
      }
    }

    return [...byId.values()].sort(
      (left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt),
    );
  }

  async getEmails(token: string): Promise<EmailMessage[]> {
    await this.applyDelay();

    const user = await this.userByToken(token);
    const stored = await this.fetchArray('/emails.json', EmailMessageSchema);

    // Дедупликация по ключу: одно письмо на поездку, даже если запись есть и в файле, и в сессии.
    const byKey = new Map<string, EmailMessage>();
    for (const email of [...stored, ...this.state.emails]) {
      if (email.userId === user.id) {
        byKey.set(email.dedupeKey, email);
      }
    }

    return [...byKey.values()].sort(
      (left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt),
    );
  }
}

/** Сброс общего состояния мок-сервера: нужен тестам, чтобы брони не протекали между ними. */
export function resetMockServerState(): void {
  defaultState.bookings.clear();
  defaultState.rides.clear();
  defaultState.pauses.clear();
  defaultState.battery.clear();
  defaultState.batteryAtRideStart.clear();
  defaultState.invoices.length = 0;
  defaultState.emails.length = 0;
  defaultState.tokens.clear();
  defaultState.revoked.clear();
  defaultState.emailByUser.clear();
  defaultState.scooterCodes.clear();
}
