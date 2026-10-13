import { describe, it, expect } from 'vitest';
import {
  billableMinutes,
  billRide,
  calcRidePrice,
  currentAmount,
  formatAmount,
  formatMinor,
} from '../src/money.ts';
import { DEFAULT_TARIFF } from '../src/constants.ts';
import { toIso } from '../src/time.ts';

function baseTs(): number {
  return new Date('2026-01-01T00:00:00.000Z').getTime();
}

describe('billableMinutes', () => {
  it('0s → 0', () => {
    expect(billableMinutes(0)).toBe(0);
  });
  it('1s → 1', () => {
    expect(billableMinutes(1)).toBe(1);
  });
  it('59s → 1', () => {
    expect(billableMinutes(59)).toBe(1);
  });
  it('60s → 1', () => {
    expect(billableMinutes(60)).toBe(1);
  });
  it('61s → 2', () => {
    expect(billableMinutes(61)).toBe(2);
  });
  it('3600s → 60', () => {
    expect(billableMinutes(3600)).toBe(60);
  });
  it('negative → 0', () => {
    expect(billableMinutes(-1)).toBe(0);
  });
  it('negative large → 0', () => {
    expect(billableMinutes(-100)).toBe(0);
  });
});

describe('table scenarios (tariff 2500/600/200)', () => {
  it('старт и сразу финиш (0s) → 3100', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t) };
    const result = calcRidePrice(ride, [], t, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 1,
      rideAmount: 600,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 3100,
    });
    checkIntegerFields(result);
  });

  it('59s → 3100', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t + 59_000) };
    const result = calcRidePrice(ride, [], t + 59_000, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 1,
      rideAmount: 600,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 3100,
    });
    checkIntegerFields(result);
  });

  it('60s → 3100', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t + 60_000) };
    const result = calcRidePrice(ride, [], t + 60_000, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 1,
      rideAmount: 600,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 3100,
    });
    checkIntegerFields(result);
  });

  it('61s → 3700', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t + 61_000) };
    const result = calcRidePrice(ride, [], t + 61_000, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 2,
      rideAmount: 1200,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 3700,
    });
    checkIntegerFields(result);
  });

  it('15 мин ровно → 11500', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t + 15 * 60_000) };
    const result = calcRidePrice(ride, [], t + 15 * 60_000, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 15,
      rideAmount: 9000,
      pauseMinutes: 0,
      pauseAmount: 0,
      total: 11500,
    });
    checkIntegerFields(result);
  });

  it('10 мин + пауза 4:20 + 5 мин → 12500', () => {
    const t = baseTs();
    const rideStarted = t;
    const pauseStart = t + 10 * 60_000;
    const pauseEnd = pauseStart + 4 * 60_000 + 20 * 1000;
    const rideFinished = pauseEnd + 5 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(pauseStart), endedAt: toIso(pauseEnd) }];
    const result = calcRidePrice(ride, pauses, rideFinished, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 15,
      rideAmount: 9000,
      pauseMinutes: 5,
      pauseAmount: 1000,
      total: 12500,
    });
    checkIntegerFields(result);
  });

  it('пауза 30с (поездка в паузе) → 2700', () => {
    const t = baseTs();
    const rideStarted = t + 30_000;
    const rideFinished = t + 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(t), endedAt: toIso(t + 60_000) }];
    const result = calcRidePrice(ride, pauses, rideFinished, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 0,
      rideAmount: 0,
      pauseMinutes: 1,
      pauseAmount: 200,
      total: 2700,
    });
    checkIntegerFields(result);
  });

  it('поездка целиком в паузе → unlockFee + pauseAmount', () => {
    const t = baseTs();
    const rideStarted = t + 10_000;
    const rideFinished = t + 40_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(t), endedAt: toIso(t + 60_000) }];
    const result = calcRidePrice(ride, pauses, rideFinished, DEFAULT_TARIFF);
    expect(result).toEqual({
      unlockFee: 2500,
      rideMinutes: 0,
      rideAmount: 0,
      pauseMinutes: 1,
      pauseAmount: 200,
      total: 2700,
    });
    checkIntegerFields(result);
  });
});

describe('billRide', () => {
  function baseTs(): number {
    return new Date('2026-01-01T00:00:00.000Z').getTime();
  }

  it('поездка без пауз', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: toIso(t + 10 * 60_000) };
    const result = billRide(ride, [], t + 10 * 60_000);
    expect(result).toEqual({ rideMinutes: 10, pauseMinutes: 0, rideSegments: 1 });
  });

  it('одна пауза', () => {
    const t = baseTs();
    const rideStarted = t;
    const pauseStart = t + 5 * 60_000;
    const pauseEnd = pauseStart + 2 * 60_000;
    const rideFinished = pauseEnd + 3 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(pauseStart), endedAt: toIso(pauseEnd) }];
    const result = billRide(ride, pauses, rideFinished);
    expect(result).toEqual({ rideMinutes: 8, pauseMinutes: 2, rideSegments: 2 });
  });

  it('пауза до старта — не тарифицируется', () => {
    const t = baseTs();
    const rideStarted = t + 10 * 60_000;
    const rideFinished = t + 20 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(t), endedAt: toIso(t + 5 * 60_000) }];
    const result = billRide(ride, pauses, rideFinished);
    expect(result).toEqual({ rideMinutes: 10, pauseMinutes: 0, rideSegments: 1 });
  });

  it('пауза после финиша — не тарифицируется', () => {
    const t = baseTs();
    const rideStarted = t;
    const rideFinished = t + 10 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(t + 15 * 60_000), endedAt: toIso(t + 20 * 60_000) }];
    const result = billRide(ride, pauses, rideFinished);
    expect(result).toEqual({ rideMinutes: 10, pauseMinutes: 0, rideSegments: 1 });
  });

  it('незакрытая пауза считается до finishedAt', () => {
    const t = baseTs();
    const rideStarted = t;
    const pauseStart = t + 5 * 60_000;
    const rideFinished = t + 10 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [{ startedAt: toIso(pauseStart), endedAt: null }];
    const result = billRide(ride, pauses, rideFinished);
    expect(result).toEqual({ rideMinutes: 5, pauseMinutes: 5, rideSegments: 1 });
  });

  it('две пересекающиеся паузы — не удваиваются', () => {
    const t = baseTs();
    const rideStarted = t;
    const pause1Start = t + 2 * 60_000;
    const pause1End = pause1Start + 3 * 60_000;
    const pause2Start = t + 4 * 60_000;
    const pause2End = pause2Start + 2 * 60_000;
    const rideFinished = t + 10 * 60_000;
    const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
    const pauses = [
      { startedAt: toIso(pause1Start), endedAt: toIso(pause1End) },
      { startedAt: toIso(pause2Start), endedAt: toIso(pause2End) },
    ];
    const result = billRide(ride, pauses, rideFinished);
    expect(result).toEqual({ rideMinutes: 6, pauseMinutes: 4, rideSegments: 2 });
  });
});

describe('currentAmount', () => {
  it('растёт по минутам: граница перехода', () => {
    const t = baseTs();
    const ride = { startedAt: toIso(t), finishedAt: null };
    const amountAt5 = currentAmount(ride, [], t + 5 * 60_000, DEFAULT_TARIFF);
    const amountAt6 = currentAmount(ride, [], t + 6 * 60_000, DEFAULT_TARIFF);
    expect(amountAt6 - amountAt5).toBe(DEFAULT_TARIFF.ridePerMinute);
  });
});

describe('formatAmount / formatMinor', () => {
  it('0 → "0.00"', () => {
    expect(formatAmount(0)).toBe('0.00');
  });
  it('3100 → "31.00"', () => {
    expect(formatAmount(3100)).toBe('31.00');
  });
  it('5 → "0.05"', () => {
    expect(formatAmount(5)).toBe('0.05');
  });
  it('123456 → "1234.56"', () => {
    expect(formatAmount(123456)).toBe('1234.56');
  });
  it('formatMinor с символом', () => {
    expect(formatMinor(3100, 'сом')).toBe('31.00 сом');
  });
  it('formatMinor 5 → "0.05 сом"', () => {
    expect(formatMinor(5, 'сом')).toBe('0.05 сом');
  });
});

describe('property: random durations', () => {
  function mulberry32(a: number): () => number {
    return function () {
      a |= 0;
      a = (a + 0x6d2b7955) | 0;
      let t = Math.imul(a, a ^ 0x8e35a1f9) >>> 0;
      a = (t ^ (t >>> 16)) | 0;
      t = (a + Math.imul(a, 0x3a47e19e)) >>> 0;
      return (t >>> 0) / 4294967296;
    };
  }

  it('200 случайных длительностей: total === unlockFee + rideAmount + pauseAmount, все поля целые', () => {
    const rng = mulberry32(42);
    const baseTs = new Date('2026-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 200; i++) {
      const rideDurationSec = Math.floor(rng() * 1800);
      const pauseStartOffsetSec = Math.floor(rng() * rideDurationSec);
      const pauseDurationSec = Math.floor(rng() * (rideDurationSec - pauseStartOffsetSec));
      const t = baseTs + i * 1_000_000;
      const rideStarted = t;
      const rideFinished = t + rideDurationSec * 1000;
      const ride = { startedAt: toIso(rideStarted), finishedAt: toIso(rideFinished) };
      const pauses =
        pauseDurationSec > 0
          ? [{ startedAt: toIso(rideStarted + pauseStartOffsetSec * 1000), endedAt: toIso(rideStarted + (pauseStartOffsetSec + pauseDurationSec) * 1000) }]
          : [];
      const result = calcRidePrice(ride, pauses, rideFinished, DEFAULT_TARIFF);
      expect(result.total).toBe(result.unlockFee + result.rideAmount + result.pauseAmount);
      checkIntegerFields(result);
    }
  });
});

function checkIntegerFields(breakdown: {
  unlockFee: number;
  rideMinutes: number;
  rideAmount: number;
  pauseMinutes: number;
  pauseAmount: number;
  total: number;
}): void {
  expect(Number.isInteger(breakdown.unlockFee)).toBe(true);
  expect(Number.isInteger(breakdown.rideMinutes)).toBe(true);
  expect(Number.isInteger(breakdown.rideAmount)).toBe(true);
  expect(Number.isInteger(breakdown.pauseMinutes)).toBe(true);
  expect(Number.isInteger(breakdown.pauseAmount)).toBe(true);
  expect(Number.isInteger(breakdown.total)).toBe(true);
}
