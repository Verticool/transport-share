import type { SteerDirection } from '@sharing/shared';
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

/**
 * Поездка вместе с паузами, тарифом и серверным временем.
 *
 * Тариф отдаёт источник данных: интерфейс не должен знать цены сам, иначе после смены тарифа
 * на сервере клиент покажет пользователю старую сумму.
 */
export interface RideSnapshot {
  ride: Ride;
  pauses: RidePause[];
  tariff: Tariff;
  serverTime: Iso;
}

export interface ApiClient {
  /** Зона обслуживания (полигон). */
  getZone(): Promise<ServiceZone>;
  /** Парк: все самокаты со статусами и зарядом. */
  getPark(): Promise<ParkSnapshot>;

  /** Текущая активная бронь пользователя, если она есть. Токен обязателен: владельца определяет сессия. */
  getActiveBooking(token: string): Promise<BookingSnapshot | null>;
  /**
   * Забронировать самокат. Если самокат уже занят другим пользователем — ошибка с кодом `conflict`:
   * правило «один самокат — одна бронь» проверяет источник данных, а не интерфейс.
   */
  createBooking(scooterId: string, token: string): Promise<BookingSnapshot>;
  /** Снять бронь (пользователь передумал): самокат снова свободен. */
  cancelBooking(bookingId: string, token: string): Promise<void>;

  /** Текущая поездка пользователя (включая паузу), если она идёт. */
  getActiveRide(token: string): Promise<RideSnapshot | null>;
  /** Начать поездку из активной брони: бронь расходуется, самокат переходит в «в поездке». */
  startRide(bookingId: string, token: string): Promise<RideSnapshot>;
  /** Поставить поездку на паузу: время паузы тарифицируется отдельно. */
  pauseRide(rideId: string, token: string): Promise<RideSnapshot>;
  /** Продолжить поездку после паузы. */
  resumeRide(rideId: string, token: string): Promise<RideSnapshot>;
  /**
   * Завершить поездку. Если самокат вне зоны обслуживания — ошибка с кодом `outside_zone`:
   * проверка на стороне источника данных, интерфейс лишь показывает причину.
   */
  finishRide(rideId: string, token: string): Promise<RideSnapshot>;
  /**
   * Самокат за пределами зоны обслуживания: мотор заблокирован, поездка идёт. Действие сообщает,
   * что самокат довезли обратно в зелёную зону — после этого движение продолжается.
   */
  pushRideToZone(rideId: string, token: string): Promise<RideSnapshot>;
  /**
   * Управление самокатом в поездке: сдвиг на шаг в выбранную сторону.
   *
   * Руль для стенда: без него нельзя проверить ни выезд за зону обслуживания, ни возврат в неё —
   * симулятор возит самокат сам и только внутри зоны. На паузе мотор выключен, движение отклоняется.
   */
  steerRide(
    rideId: string,
    direction: SteerDirection,
    stepM: number,
    token: string,
  ): Promise<RideSnapshot>;
  /**
   * Разряд батареи для проверки автофиниша.
   *
   * В жизни заряд падает примерно на процент в минуту: без этого действия проверка «самокат
   * разрядился, поездка закрылась сама» занимала бы час.
   */
  drainRide(rideId: string, pct: number, token: string): Promise<RideSnapshot>;
  /**
   * Укорачивает бронь: срок автоматического снятия сдвигается назад.
   *
   * Нужно, чтобы увидеть оповещения о снятии брони сразу, а не через пятнадцать минут ожидания.
   */
  shortenBooking(bookingId: string, minutes: number, token: string): Promise<Booking>;

  /** Вход по email и паролю. Неверные данные — ошибка с кодом `unauthorized`. */
  login(email: string, password: string): Promise<SessionSnapshot>;
  /** Выход: токен перестаёт действовать. */
  logout(token: string): Promise<void>;
  /** Текущий пользователь по токену — проверка сессии при загрузке приложения. */
  getMe(token: string): Promise<PublicUser>;
  /** История поездок пользователя, свежие сверху. */
  getRides(query: PageQuery, token: string): Promise<Page<RideListItem>>;
  /** Счета пользователя, свежие сверху. */
  getInvoices(token: string): Promise<Invoice[]>;
  /** Входящие письма (эмуляция почты), свежие сверху. */
  getEmails(token: string): Promise<EmailMessage[]>;
}

/** Коды ошибок клиента: интерфейс различает их, чтобы показать понятный текст. */
export type ApiErrorCode =
  | 'network'
  | 'invalid_payload'
  | 'conflict'
  | 'not_found'
  | 'outside_zone'
  | 'unauthorized';

/** Сессия: вошедший пользователь и токены — короткий для запросов, долгий для продления. */
export interface SessionSnapshot {
  user: PublicUser;
  token: string;
  /** Токен обновления: мок-клиент отдаёт его же, сервер — свой. Нужен для продления доступа. */
  refreshToken: string;
}

/** Страница списка: столько записей отдал источник и сколько их всего. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Запрос страницы списка (RULES: разбирается схемой `RidesQuerySchema`). */
/**
 * Поездка в списке истории: доменная поездка плюс минуты к оплате.
 *
 * Минуты считает домен по сегментам (та же функция, что в счёте): без них список показывал
 * округлённую длительность, и по одной поездке «Поездки» и «Счета» расходились.
 */
export interface RideListItem extends Ride {
  rideMinutes: number;
  pauseMinutes: number;
}

export interface PageQuery {
  limit: number;
  offset: number;
}

/** Ошибка уровня клиента: единый формат для моков и будущего http-клиента. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
