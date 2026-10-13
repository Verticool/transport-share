/**
 * Константы домена: тарифы, пороги, длительности, зона обслуживания.
 * Значения по умолчанию совпадают с docs/DOMAIN.md; бэкенд может переопределить
 * их из окружения (см. `loadConfig` в backend), но дефолты обязаны оставаться рабочими.
 */

import type { Minor, ServiceZone } from './domain.ts';

export interface Tariff {
  /** Разблокировка, минорные единицы. Списывается один раз на поездку. */
  unlockFee: Minor;
  /** Тариф езды за минуту, минорные единицы. */
  ridePerMinute: Minor;
  /** Тариф паузы за минуту, минорные единицы. */
  pausePerMinute: Minor;
  currency: string;
  currencySymbol: string;
}

export const DEFAULT_TARIFF: Tariff = {
  unlockFee: 2500, // 25.00 сом
  ridePerMinute: 600, // 6.00 сом/мин
  pausePerMinute: 200, // 2.00 сом/мин
  currency: 'KGS',
  currencySymbol: 'сом',
};

/** Минорных единиц в одной единице валюты (1 сом = 100 тыйын). */
export const MINOR_UNITS_PER_MAJOR = 100;

export const BOOKING_TTL_MINUTES = 15;
export const BOOKING_NOTIFY_MINUTES = 3;
export const BOOKING_TICK_MS = 5_000;
export const SIM_TICK_MS = 1_000;

/** Ниже этого заряда самокат не показывается свободным. */
export const LOW_BATTERY_THRESHOLD = 20;
/** Расход заряда в минуту езды, процентных пунктов. */
export const BATTERY_DRAIN_PCT_PER_MIN = 1;
/** Предупреждение о приближении к границе зоны, метры. */
export const ZONE_WARN_DISTANCE_M = 150;

/** Параметры симулятора движения. */
export const SIM = {
  /** Обычная скорость самоката, м/с. */
  speedMps: 4.2,
  /** Амплитуда GPS-шума, метры. */
  gpsNoiseM: 3,
  /** Если самокат дошёл до цели ближе этого расстояния — выбирается новая цель. */
  waypointReachedM: 15,
} as const;

export const SERVICE_ZONE: ServiceZone = {
  name: 'Бишкек, центр',
  polygon: [
    [42.89, 74.545],
    [42.899, 74.59],
    [42.885, 74.63],
    [42.85, 74.635],
    [42.829, 74.61],
    [42.82, 74.565],
    [42.835, 74.53],
    [42.865, 74.525],
  ],
};

/** Парк и мок-данные (стадия S2). */
export const FLEET = {
  size: 40,
  codePrefix: 'SC-',
  models: ['Ninebot Max G30', 'Xiaomi Mi Pro 2', 'Kugoo M4 Pro', 'Ninebot F40'] as const,
} as const;
