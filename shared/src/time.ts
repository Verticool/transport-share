import type { Iso } from './domain.ts';

/** Часы: инъекция времени вместо Date.now(), чтобы таймеры были тестируемы. */
export interface Clock {
  now(): number; // unix ms
}

export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};

/** Часы для тестов: время двигается вручную. */
export interface MutableClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}
export function createClock(startMs: number): MutableClock {
  let currentMs = startMs;
  return {
    now(): number {
      return currentMs;
    },
    advance(ms: number): void {
      currentMs += ms;
    },
    set(ms: number): void {
      currentMs = ms;
    },
  };
}

export function toIso(ms: number): Iso {
  return new Date(ms).toISOString();
}

export function fromIso(iso: Iso): number {
  return new Date(iso).getTime();
}

/** Полуинтервал в unix ms, start <= end. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * Разбивает поездку на интервалы езды: окно [startedAt, finishedAt ?? nowMs] минус интервалы пауз.
 * Правила (проверяются тестами):
 *  - паузы обрезаются по окну поездки, сортируются и сливаются при пересечении;
 *  - результат — интервалы окна, не пересекающиеся с паузами, отсортированные по start;
 *  - интервалы нулевой длины НЕ выбрасываются, если окно поездки нулевое:
 *    поездка «старт и сразу финиш» (startedAt === finishedAt) даёт ровно один интервал [t, t];
 *  - если поездка целиком в паузе (окно полностью накрыто паузами) — вернуть пустой массив;
 *  - незакрытая пауза (endedAt === null) считается до nowMs;
 *  - незакрытая поездка (finishedAt === null) считается до nowMs.
 */
export function splitRideSegments(
  ride: { startedAt: Iso; finishedAt: Iso | null },
  pauses: { startedAt: Iso; endedAt: Iso | null }[],
  nowMs: number,
): Interval[] {
  const rideStart = fromIso(ride.startedAt);
  const rideEnd = ride.finishedAt != null ? fromIso(ride.finishedAt) : nowMs;

  // Build pause intervals, clamped to ride window
  const pauseIntervals: Interval[] = pauses
    .map((p) => {
      const pStart = fromIso(p.startedAt);
      const pEnd = p.endedAt != null ? fromIso(p.endedAt) : nowMs;
      // Clamp to ride window
      const clampedStart = Math.max(pStart, rideStart);
      const clampedEnd = Math.min(pEnd, rideEnd);
      if (clampedStart >= clampedEnd) {
        return null;
      }
      return { start: clampedStart, end: clampedEnd };
    })
    .filter((i): i is Interval => i !== null);

  // Sort and merge overlapping pauses
  pauseIntervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const p of pauseIntervals) {
    const last = merged[merged.length - 1];
    if (last && p.start <= last.end) {
      // Overlap or adjacent: merge
      last.end = Math.max(last.end, p.end);
    } else {
      merged.push(p);
    }
  }

  // Compute complement: ride window minus merged pauses
  const result: Interval[] = [];
  let cursor = rideStart;
  for (const p of merged) {
    if (p.start > cursor) {
      result.push({ start: cursor, end: p.start });
    }
    cursor = Math.max(cursor, p.end);
  }
  if (cursor < rideEnd) {
    result.push({ start: cursor, end: rideEnd });
  }
  if (rideStart === rideEnd && result.length === 0) {
    const covered = merged.some((p) => p.start <= rideStart && p.end >= rideStart);
    if (!covered) {
      result.push({ start: rideStart, end: rideEnd });
    }
  }

  return result;
}

/** Суммарная длительность интервалов, секунды (дробная часть сохраняется). */
export function durationSeconds(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0) / 1000;
}

/** Сколько миллисекунд осталось до target (может быть отрицательным). */
export function msUntil(nowMs: number, target: Iso): number {
  return fromIso(target) - nowMs;
}

/** Полных минут между моментами, вниз, может быть отрицательным. */
export function minutesBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 60000);
}

/** 'MM:SS' до часа, 'H:MM:SS' дальше. Отрицательное значение — как '00:00'. */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 0) {
    return '00:00';
  }
  const absSeconds = totalSeconds;
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
