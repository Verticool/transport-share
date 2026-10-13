import { describe, it, expect } from 'vitest';
import {
  createClock,
  durationSeconds,
  formatDuration,
  fromIso,
  minutesBetween,
  msUntil,
  splitRideSegments,
  toIso,
} from '../src/time.ts';
import { mustGet } from '../src/testing/factories.ts';

describe('createClock + advance + set', () => {
  it('now() returns the initial value', () => {
    const clock = createClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it('advance() moves time forward', () => {
    const clock = createClock(0);
    clock.advance(5000);
    expect(clock.now()).toBe(5000);
  });

  it('set() jumps to an arbitrary value', () => {
    const clock = createClock(0);
    clock.set(12345);
    expect(clock.now()).toBe(12345);
    clock.advance(100);
    expect(clock.now()).toBe(12345 + 100);
  });
});

describe('toIso / fromIso', () => {
  it('toIso(0) is the Unix epoch in UTC', () => {
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('fromIso / toIso are round-trip compatible', () => {
    const ms = 1728800000000;
    expect(fromIso(toIso(ms))).toBe(ms);
  });

  it('toIso always ends with Z', () => {
    const iso = toIso(1234567890);
    expect(iso.endsWith('Z')).toBe(true);
  });
});

describe('splitRideSegments', () => {
  const t0 = '1970-01-01T00:00:00.000Z';
  const t1min = '1970-01-01T00:01:00.000Z';
  const t3min = '1970-01-01T00:03:00.000Z';
  const t4min = '1970-01-01T00:04:00.000Z';
  const t5min = '1970-01-01T00:05:00.000Z';
  const t7min = '1970-01-01T00:07:00.000Z';
  const t8min = '1970-01-01T00:08:00.000Z';
  const t10min = '1970-01-01T00:10:00.000Z';
  const t12min = '1970-01-01T00:12:00.000Z';
  const nowMs = fromIso(t12min);

  it('ride without pauses: one interval of 600 000 ms', () => {
    const ride = { startedAt: t0, finishedAt: t10min };
    const result = splitRideSegments(ride, [], nowMs);
    expect(result).toHaveLength(1);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 0).end).toBe(fromIso(t10min));
    expect(durationSeconds(result)).toBe(600);
  });

  it('zero-duration ride produces exactly one [t, t] interval', () => {
    const ride = { startedAt: t0, finishedAt: t0 };
    const result = splitRideSegments(ride, [], nowMs);
    expect(result).toHaveLength(1);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 0).end).toBe(fromIso(t0));
    expect(durationSeconds(result)).toBe(0);
  });

  it('one pause in the middle: two intervals, duration = window - pause', () => {
    const ride = { startedAt: t0, finishedAt: t10min };
    const pauses = [{ startedAt: t5min, endedAt: t7min }];
    const result = splitRideSegments(ride, pauses, nowMs);
    expect(result).toHaveLength(2);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 0).end).toBe(fromIso(t5min));
    expect(mustGet(result, 1).start).toBe(fromIso(t7min));
    expect(mustGet(result, 1).end).toBe(fromIso(t10min));
    expect(durationSeconds(result)).toBe(480); // 10 min - 2 min pause = 8 min = 480s
  });

  it('two overlapping pauses are merged, ride duration never negative', () => {
    const ride = { startedAt: t0, finishedAt: t10min };
    const pauses = [
      { startedAt: t3min, endedAt: t7min },
      { startedAt: t5min, endedAt: t8min },
    ];
    const result = splitRideSegments(ride, pauses, nowMs);
    expect(result).toHaveLength(2);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 0).end).toBe(fromIso(t3min));
    expect(mustGet(result, 1).start).toBe(fromIso(t8min));
    expect(mustGet(result, 1).end).toBe(fromIso(t10min));
    expect(durationSeconds(result)).toBe(300); // 3 min + 2 min = 5 min = 300s
  });

  it('uncovered pause and uncovered ride: window extends to nowMs', () => {
    // startedAt = t0, no finishedAt -> window ends at nowMs
    const ride = { startedAt: t0, finishedAt: null };
    const pauses = [{ startedAt: t1min, endedAt: null }];
    const result = splitRideSegments(ride, pauses, nowMs);
    // pause covers [t1min, nowMs], so only [t0, t1min] remains
    expect(result).toHaveLength(1);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 0).end).toBe(fromIso(t1min));
  });

  it('full ride covered by pauses returns empty array', () => {
    const ride = { startedAt: t0, finishedAt: t10min };
    const pauses = [{ startedAt: t0, endedAt: t10min }];
    const result = splitRideSegments(ride, pauses, nowMs);
    expect(result).toHaveLength(0);
  });

  it('pause starting before ride and ending after ride: clipped to ride window', () => {
    const ride = { startedAt: t5min, finishedAt: t7min };
    const pauses = [{ startedAt: t0, endedAt: t10min }];
    const result = splitRideSegments(ride, pauses, nowMs);
    expect(result).toHaveLength(0);
  });

  it('result intervals are sorted by start', () => {
    const ride = { startedAt: t0, finishedAt: t10min };
    const pauses = [
      { startedAt: t7min, endedAt: t8min },
      { startedAt: t3min, endedAt: t4min },
    ];
    const result = splitRideSegments(ride, pauses, nowMs);
    expect(result).toHaveLength(3);
    expect(mustGet(result, 0).start).toBe(fromIso(t0));
    expect(mustGet(result, 1).start).toBe(fromIso(t4min));
    expect(mustGet(result, 2).start).toBe(fromIso(t8min));
  });
});

describe('durationSeconds', () => {
  it('empty array yields 0', () => {
    expect(durationSeconds([])).toBe(0);
  });

  it('preserves fractional seconds', () => {
    const intervals = [{ start: 0, end: 1500 }];
    expect(durationSeconds(intervals)).toBe(1.5);
  });
});

describe('msUntil', () => {
  it('positive when target is in the future', () => {
    expect(msUntil(0, '1970-01-01T00:00:01.000Z')).toBe(1000);
  });

  it('negative when target is in the past', () => {
    expect(msUntil(2000, '1970-01-01T00:00:01.000Z')).toBe(-1000);
  });

  it('zero when target equals now', () => {
    expect(msUntil(1000, toIso(1000))).toBe(0);
  });
});

describe('minutesBetween', () => {
  it('positive minutes', () => {
    expect(minutesBetween(0, 60000)).toBe(1);
  });

  it('negative minutes', () => {
    expect(minutesBetween(60000, 0)).toBe(-1);
  });

  it('rounds down', () => {
    expect(minutesBetween(0, 59999)).toBe(0);
    expect(minutesBetween(0, -1)).toBe(-1);
  });
});

describe('formatDuration', () => {
  it('0 -> "00:00"', () => {
    expect(formatDuration(0)).toBe('00:00');
  });

  it('59 -> "00:59"', () => {
    expect(formatDuration(59)).toBe('00:59');
  });

  it('60 -> "01:00"', () => {
    expect(formatDuration(60)).toBe('01:00');
  });

  it('3661 -> "01:01:01"', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });

  it('-5 -> "00:00"', () => {
    expect(formatDuration(-5)).toBe('00:00');
  });
});
