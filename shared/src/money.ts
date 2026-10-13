import type { InvoiceBreakdown, Minor } from './domain.ts';
import type { Tariff } from './constants.ts';
import { splitRideSegments } from './time.ts';

/** Округление вверх до полной минуты. 0 секунд → 0 минут; 1 секунда → 1 минута. */
export function billableMinutes(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / 60));
}

/**
 * Минуты езды и паузы для поездки.
 * Паузы обрезаются окном поездки [startedAt, finishedAt ?? nowMs], сортируются и сливаются
 * при пересечении (та же нормализация, что в splitRideSegments).
 * Пауза целиком вне окна поездки не тарифицируется.
 */
export function billRide(
  ride: { startedAt: string; finishedAt: string | null },
  pauses: { startedAt: string; endedAt: string | null }[],
  nowMs: number,
): { rideMinutes: number; pauseMinutes: number; rideSegments: number } {
  const segments = splitRideSegments(ride, pauses, nowMs);
  const rideMinutes =
    segments.length === 0
      ? 0
      : segments.reduce(
          (sum, seg) => sum + Math.max(1, Math.ceil((seg.end - seg.start) / 60000)),
          0,
        );

  const rideStart = toDateMs(ride.startedAt);
  const rideEnd = ride.finishedAt != null ? toDateMs(ride.finishedAt) : nowMs;

  const pauseIntervals = pauses
    .map((p) => {
      const pStart = toDateMs(p.startedAt);
      const pEnd = p.endedAt != null ? toDateMs(p.endedAt) : nowMs;
      const clampedStart = Math.max(pStart, rideStart);
      const clampedEnd = Math.min(pEnd, rideEnd);
      if (clampedStart >= clampedEnd) {
        return null;
      }
      return { start: clampedStart, end: clampedEnd };
    })
    .filter((i): i is { start: number; end: number } => i !== null);

  pauseIntervals.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const p of pauseIntervals) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.end) {
      last.end = Math.max(last.end, p.end);
    } else {
      merged.push(p);
    }
  }

  const pauseMinutes = merged.reduce((sum, m) => sum + Math.ceil((m.end - m.start) / 60000), 0);

  return {
    rideMinutes,
    pauseMinutes,
    rideSegments: segments.length,
  };
}

export function calcRidePrice(
  ride: { startedAt: string; finishedAt: string | null },
  pauses: { startedAt: string; endedAt: string | null }[],
  nowMs: number,
  tariff: Tariff,
): InvoiceBreakdown {
  const { rideMinutes, pauseMinutes } = billRide(ride, pauses, nowMs);
  const rideAmount: Minor = rideMinutes * tariff.ridePerMinute;
  const pauseAmount: Minor = pauseMinutes * tariff.pausePerMinute;
  const total: Minor = tariff.unlockFee + rideAmount + pauseAmount;
  return {
    unlockFee: tariff.unlockFee,
    rideMinutes,
    rideAmount,
    pauseMinutes,
    pauseAmount,
    total,
  };
}

export function currentAmount(
  ride: { startedAt: string; finishedAt: string | null },
  pauses: { startedAt: string; endedAt: string | null }[],
  nowMs: number,
  tariff: Tariff,
): Minor {
  return calcRidePrice(ride, pauses, nowMs, tariff).total;
}

export function formatAmount(amount: Minor): string {
  const major = Math.floor(amount / 100);
  const minor = amount % 100;
  return `${major}.${String(minor).padStart(2, '0')}`;
}

export function formatMinor(amount: Minor, currencySymbol: string): string {
  return `${formatAmount(amount)} ${currencySymbol}`;
}

function toDateMs(iso: string): number {
  return new Date(iso).getTime();
}
