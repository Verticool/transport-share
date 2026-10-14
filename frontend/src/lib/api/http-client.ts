import {
  BookingSchema,
  DEFAULT_TARIFF,
  EmailMessageSchema,
  InvoiceSchema,
  PublicUserSchema,
  RidePauseSchema,
  RideSchema,
  ScooterSchema,
  ServiceZoneSchema,
} from '@sharing/shared';
import type {
  Booking,
  EmailMessage,
  Invoice,
  Iso,
  PublicUser,
  Ride,
  RidePause,
  Scooter,
  ServiceZone,
  Tariff,
} from '@sharing/shared';
import { z } from 'zod';

import { ApiClientError, type ApiClient, type ApiErrorCode, type Page, type PageQuery } from './types';

/** Схемы ответов сервера: разбор тот же, что и для моков, — интерфейс не доверяет форме ответа. */
const ParkSchema = z.object({
  scooters: z.array(ScooterSchema),
  serverTime: z.string(),
  seq: z.number().optional(),
});
const ZoneSchema = z.object({ zone: ServiceZoneSchema });
const BookingResponseSchema = z.object({ booking: BookingSchema, serverTime: z.string() });
const ActiveBookingSchema = z.object({ booking: z.nullable(BookingSchema), serverTime: z.string() });
const RideResponseSchema = z.object({
  ride: RideSchema,
  pauses: z.array(RidePauseSchema),
  serverTime: z.string(),
  tariff: z.unknown(),
});
const ActiveRideSchema = z.object({
  ride: z.nullable(RideSchema),
  pauses: z.array(RidePauseSchema),
  serverTime: z.string(),
  tariff: z.unknown(),
});
const SessionResponseSchema = z.object({
  user: PublicUserSchema,
  token: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
});
const MeSchema = z.object({ user: PublicUserSchema });
const RidesPageSchema = z.object({
  items: z.array(RideSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
const InvoicesSchema = z.object({ items: z.array(InvoiceSchema), serverTime: z.string() });
const EmailsSchema = z.object({ items: z.array(EmailMessageSchema), serverTime: z.string() });
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

/** Коды ошибок, которые понимает интерфейс: неизвестный код считается сетевым сбоем. */
const ApiErrorCodeSchema = z.enum([
  'network',
  'invalid_payload',
  'conflict',
  'not_found',
  'outside_zone',
  'unauthorized',
]);

/** Тариф приходит с сервера: интерфейс не хранит цены, но обязан их понимать. */
const TariffSchema = z.object({
  unlockFee: z.number(),
  ridePerMinute: z.number(),
  pausePerMinute: z.number(),
  currency: z.string(),
  currencySymbol: z.string(),
});

export interface HttpApiClientOptions {
  /** База API: по умолчанию тот же источник, что и страница (прокси Vite или nginx). */
  baseUrl?: string;
  /** Часы: инъекция для тестов (RULES §F: без `Date.now()` напрямую). */
  now?: () => number;
  /** Как приложение узнаёт об обновлённом токене доступа после прозрачного продления. */
  onTokenRefreshed?: (session: { token: string; refreshToken: string }) => void;
  /**
   * Сессию продлить не удалось: сохранённый вход больше не действует.
   *
   * Это сигнал «выйти», а не «показать ошибку»: держать экран с протухшим доступом — обман.
   * Приложение по этому вызову чистит сессию и возвращает форму входа.
   */
  onSessionExpired?: () => void;
}

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: 'invalid_payload',
  401: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  422: 'outside_zone',
};

/**
 * Клиент данных поверх HTTP.
 *
 * Тот же интерфейс, что у мок-клиента: экраны о подмене не знают — они вызывают методы и
 * получают доменные объекты. Ответы проходят zod-схемы, поэтому расхождение контракта ломает
 * разбор сразу, а не превращается в undefined в разметке.
 *
 * Токен доступа живёт минуты. Когда сервер отвечает 401, клиент один раз продлевает сессию по
 * токену обновления и повторяет запрос — пользователь этого не замечает.
 */
export class HttpApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly onTokenRefreshed: (session: { token: string; refreshToken: string }) => void;
  private readonly onSessionExpired: () => void;
  private refreshToken: string | null = null;
  private refreshing: Promise<string | null> | null = null;
  // О сбросе авторизации сообщаем один раз: несколько одновременных отказов не должны давать
  // несколько «выходов» — приложение и так уже вернулось на форму входа.
  private expiredNotified = false;

  constructor(options: HttpApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.now = options.now ?? (() => Date.now());
    this.onTokenRefreshed = options.onTokenRefreshed ?? (() => undefined);
    this.onSessionExpired = options.onSessionExpired ?? (() => undefined);
  }

  /** Запоминает токен обновления: без него продление доступа невозможно. */
  rememberRefreshToken(token: string | null): void {
    this.refreshToken = token;
    if (token !== null) {
      // Сессия снова есть — следующее истечение снова заслуживает сообщения.
      this.expiredNotified = false;
    }
  }

  /** Сообщает приложению, что продлить сессию нечем: оно сбрасывает вход. */
  private notifySessionExpired(): void {
    if (this.expiredNotified) {
      return;
    }
    this.expiredNotified = true;
    this.onSessionExpired();
  }

  private async fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
    // Заголовок типа содержимого ставится только при теле: запрос без тела с `application/json`
    // сервер разбирает как пустой JSON и отклоняет (на этом падало снятие брони, DELETE).
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      // Сеть не ответила: это отдельный код, интерфейс показывает «нет связи» и продолжает поездку.
      throw new ApiClientError('network', 'Источник данных недоступен');
    }

    if (response.status === 204) {
      return null;
    }

    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorSchema.safeParse(raw);
      const codeInBody = parsed.success ? ApiErrorCodeSchema.safeParse(parsed.data.code) : null;
      const code: ApiErrorCode = codeInBody?.success === true ? codeInBody.data : (STATUS_TO_CODE[response.status] ?? 'network');
      throw new ApiClientError(
        code,
        parsed.success ? parsed.data.message : `Запрос не выполнен (${response.status})`,
      );
    }
    return raw;
  }

  /** Запрос с токеном: при 401 продлевает сессию и повторяет один раз. */
  private async authorized(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
    try {
      return await this.fetchJson(path, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
      });
    } catch (error) {
      const unauthorized = error instanceof ApiClientError && error.code === 'unauthorized';
      if (!unauthorized) {
        throw error;
      }

      const renewed = await this.renew();
      if (renewed === null) {
        // Продлить нечем: сохранённый вход недействителен. Сообщаем приложению — оно сбрасывает
        // авторизацию и показывает вход, вместо того чтобы оставить пользователя с мёртвым токеном.
        this.notifySessionExpired();
        throw error;
      }
      return this.fetchJson(path, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${renewed}` },
      });
    }
  }

  /** Продление доступа: одновременные запросы ждут одно и то же обещание. */
  private async renew(): Promise<string | null> {
    if (this.refreshToken === null) {
      return null;
    }
    if (this.refreshing !== null) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      try {
        const raw = await this.fetchJson('/api/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        const session = SessionResponseSchema.parse(raw);
        this.refreshToken = session.refreshToken;
        this.expiredNotified = false;
        this.onTokenRefreshed({ token: session.token, refreshToken: session.refreshToken });
        return session.token;
      } catch {
        // Токен обновления тоже не прошёл: он отозван или истёк. Забываем его — иначе каждый
        // следующий запрос снова и снова дёргал бы сервер заведомо мёртвым токеном.
        this.refreshToken = null;
        return null;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /**
   * Тариф из ответа сервера.
   *
   * Если сервер ещё не отдал тариф (переходный момент), берём значение домена: панель поездки не
   * должна показывать пустые цены из-за формы ответа.
   */
  private static tariffOf(raw: unknown): Tariff {
    const parsed = TariffSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULT_TARIFF;
  }

  async getZone(): Promise<ServiceZone> {
    return ZoneSchema.parse(await this.fetchJson('/api/zone')).zone;
  }

  async getPark(): Promise<{ scooters: Scooter[]; serverTime: Iso }> {
    const parsed = ParkSchema.parse(await this.fetchJson('/api/scooters'));
    return { scooters: parsed.scooters, serverTime: parsed.serverTime };
  }

  async getActiveBooking(token: string): Promise<{ booking: Booking; serverTime: Iso } | null> {
    const parsed = ActiveBookingSchema.parse(await this.authorized('/api/bookings/active', token));
    return parsed.booking === null ? null : { booking: parsed.booking, serverTime: parsed.serverTime };
  }

  async createBooking(scooterId: string, token: string): Promise<{ booking: Booking; serverTime: Iso }> {
    const parsed = BookingResponseSchema.parse(
      await this.authorized('/api/bookings', token, {
        method: 'POST',
        body: JSON.stringify({ scooterId }),
      }),
    );
    return { booking: parsed.booking, serverTime: parsed.serverTime };
  }

  async cancelBooking(bookingId: string, token: string): Promise<void> {
    await this.authorized(`/api/bookings/${bookingId}`, token, { method: 'DELETE' });
  }

  async getActiveRide(
    token: string,
  ): Promise<{ ride: Ride; pauses: RidePause[]; tariff: Tariff; serverTime: Iso } | null> {
    const parsed = ActiveRideSchema.parse(await this.authorized('/api/rides/active', token));
    if (parsed.ride === null) {
      return null;
    }
    return {
      ride: parsed.ride,
      pauses: parsed.pauses,
      tariff: HttpApiClient.tariffOf(parsed.tariff),
      serverTime: parsed.serverTime,
    };
  }

  async startRide(
    bookingId: string,
    token: string,
  ): Promise<{ ride: Ride; pauses: RidePause[]; tariff: Tariff; serverTime: Iso }> {
    const parsed = RideResponseSchema.parse(
      await this.authorized('/api/rides', token, {
        method: 'POST',
        body: JSON.stringify({ bookingId }),
      }),
    );
    return {
      ride: parsed.ride,
      pauses: parsed.pauses,
      tariff: HttpApiClient.tariffOf(parsed.tariff),
      serverTime: parsed.serverTime,
    };
  }

  private async rideAction(
    rideId: string,
    action: 'pause' | 'resume' | 'finish' | 'push-to-zone',
    token: string,
  ): Promise<{ ride: Ride; pauses: RidePause[]; tariff: Tariff; serverTime: Iso }> {
    const parsed = RideResponseSchema.parse(
      await this.authorized(`/api/rides/${rideId}/${action}`, token, { method: 'POST' }),
    );
    return {
      ride: parsed.ride,
      pauses: parsed.pauses,
      tariff: HttpApiClient.tariffOf(parsed.tariff),
      serverTime: parsed.serverTime,
    };
  }

  async pauseRide(rideId: string, token: string) {
    return this.rideAction(rideId, 'pause', token);
  }

  async resumeRide(rideId: string, token: string) {
    return this.rideAction(rideId, 'resume', token);
  }

  async finishRide(rideId: string, token: string) {
    return this.rideAction(rideId, 'finish', token);
  }

  async pushRideToZone(rideId: string, token: string) {
    return this.rideAction(rideId, 'push-to-zone', token);
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; token: string; refreshToken: string }> {
    const parsed = SessionResponseSchema.parse(
      await this.fetchJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    );
    this.rememberRefreshToken(parsed.refreshToken);
    return { user: parsed.user, token: parsed.token, refreshToken: parsed.refreshToken };
  }

  async logout(token: string): Promise<void> {
    const refreshToken = this.refreshToken;
    this.rememberRefreshToken(null);
    if (refreshToken === null) {
      return;
    }
    try {
      await this.fetchJson('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Выход считается состоявшимся даже если сервер недоступен: клиент токен уже забыл.
      void token;
    }
  }

  async getMe(token: string): Promise<PublicUser> {
    return MeSchema.parse(await this.authorized('/api/me', token)).user;
  }

  async getRides(query: PageQuery, token: string): Promise<Page<Ride>> {
    const parsed = RidesPageSchema.parse(
      await this.authorized(`/api/rides?limit=${query.limit}&offset=${query.offset}`, token),
    );
    return parsed;
  }

  async getInvoices(token: string): Promise<Invoice[]> {
    return InvoicesSchema.parse(await this.authorized('/api/invoices', token)).items;
  }

  async getEmails(token: string): Promise<EmailMessage[]> {
    return EmailsSchema.parse(await this.authorized('/api/emails', token)).items;
  }

  /** Текущее время клиента: единая точка для тестов и подписей. */
  currentTime(): number {
    return this.now();
  }
}
