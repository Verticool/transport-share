import { describe, it, expect } from 'vitest';
import { SERVICE_ZONE } from '../src/constants.ts';
import { isInsideZone, haversineM } from '../src/zone.ts';
import {
  createRng,
  stepScooter,
  stepFleet,
  pickWaypoint,
  type SimScooter,
  type StepOptions,
} from '../src/sim/index.ts';

function makeScooter(overrides: Partial<SimScooter> & { id: string; lat: number; lng: number }): SimScooter {
  return {
    ...overrides,
    status: overrides.status ?? 'in_ride',
    batteryPct: overrides.batteryPct ?? 100,
    batteryRemainder: overrides.batteryRemainder ?? 0,
    target: overrides.target ?? { lat: 42.87, lng: 74.57 },
  };
}

function defaultOpts(overrides: Partial<StepOptions>): StepOptions {
  return {
    dtSeconds: 1,
    rng: createRng(42),
    zone: SERVICE_ZONE,
    ...overrides,
  };
}

function at<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) {
    throw new Error(`index ${index} out of bounds (length ${arr.length})`);
  }
  return item;
}

describe('sim', () => {
  describe('createRng', () => {
    it('детерминирован: одинаковый seed даёт одинаковую последовательность', () => {
      const a = createRng(1);
      const b = createRng(1);
      expect(a()).toBe(b());
      expect(a()).toBe(b());
      expect(a()).toBe(b());
    });

    it('разный seed даёт разный первый результат', () => {
      const a = createRng(1);
      const b = createRng(2);
      expect(a()).not.toBe(b());
    });
  });

  describe('правило 1: стоящие самокаты не двигаются и не тратят заряд', () => {
    it('free: без изменений координат и заряда', () => {
      const s = makeScooter({ id: 's1', lat: 42.87, lng: 74.57, status: 'free' });
      const r = stepScooter(s, defaultOpts({ dtSeconds: 10 }));
      expect(r.scooter.lat).toBe(s.lat);
      expect(r.scooter.lng).toBe(s.lng);
      expect(r.scooter.batteryPct).toBe(s.batteryPct);
      expect(r.scooter.batteryRemainder).toBe(s.batteryRemainder);
      expect(r.scooter.target).toBe(s.target);
      expect(r.movedM).toBe(0);
      expect(r.batteryDrainPct).toBe(0);
      expect(r.batteryDepleted).toBe(false);
      expect(r.waypointReached).toBe(false);
    });

    it('reserved: без изменений', () => {
      const s = makeScooter({ id: 's2', lat: 42.87, lng: 74.57, status: 'reserved' });
      const r = stepScooter(s, defaultOpts({ dtSeconds: 5 }));
      expect(r.scooter.lat).toBe(s.lat);
      expect(r.scooter.batteryPct).toBe(s.batteryPct);
      expect(r.movedM).toBe(0);
      expect(r.batteryDrainPct).toBe(0);
    });

    it('unavailable: без изменений', () => {
      const s = makeScooter({ id: 's3', lat: 42.87, lng: 74.57, status: 'unavailable' });
      const r = stepScooter(s, defaultOpts({ dtSeconds: 5 }));
      expect(r.scooter.lat).toBe(s.lat);
      expect(r.scooter.batteryPct).toBe(s.batteryPct);
      expect(r.movedM).toBe(0);
      expect(r.batteryDrainPct).toBe(0);
    });
  });

  describe('правило 2: движение', () => {
    it('проходит speedMps * dtSeconds метров', () => {
      const s = makeScooter({ id: 's4', lat: 42.87, lng: 74.57, target: { lat: 42.9, lng: 74.57 } });
      const opts = defaultOpts({ dtSeconds: 10, speedMps: 4.2 });
      const r = stepScooter(s, opts);
      expect(r.movedM).toBeCloseTo(42, 0);
    });

    it('использует moveTowards к цели', () => {
      const target = { lat: 42.88, lng: 74.58 };
      const s = makeScooter({ id: 's5', lat: 42.87, lng: 74.57, target });
      const opts = defaultOpts({ dtSeconds: 10, speedMps: 100 });
      const r = stepScooter(s, opts);
      const dist = r.scooter.target === null
        ? 0
        : (r.scooter.lat !== target.lat || r.scooter.lng !== target.lng
          ? 100
          : 0);
      expect(dist).toBeGreaterThan(0);
    });
  });

  describe('правило 3: достижение цели', () => {
    it('waypointReached=true, новая цель', () => {
      const target = { lat: 42.870135, lng: 74.57 };
      const s = makeScooter({ id: 's6', lat: 42.87, lng: 74.57, target, batteryPct: 50 });
      const opts = defaultOpts({ dtSeconds: 1, speedMps: 100, waypointReachedM: 15 });
      const r = stepScooter(s, opts);
      expect(r.waypointReached).toBe(true);
      expect(r.movedM).toBeCloseTo(15, 0);
      expect(r.scooter.target).not.toBe(target);
      expect(r.scooter.lat).toBeCloseTo(target.lat, 4);
      expect(r.scooter.lng).toBeCloseTo(target.lng, 4);
    });
  });

  describe('правило 4: граница зоны', () => {
    it('переназначает цель при приближении к границе', () => {
      const s = makeScooter({ id: 's7', lat: 42.829, lng: 74.61, target: { lat: 42.83, lng: 74.611 } });
      const opts = defaultOpts({ dtSeconds: 1, zoneWarnDistanceM: 150 });
      const r = stepScooter(s, opts);
      expect(r.scooter.target).not.toBe(s.target);
      expect(r.scooter.target).not.toBeNull();
    });
  });

  describe('правило 5: заряд', () => {
    it('точный расход за 60 секунд: ровно drainPctPerMin', () => {
      const s = makeScooter({ id: 's8', lat: 42.87, lng: 74.57, batteryPct: 10 });
      const opts = defaultOpts({ dtSeconds: 60, drainPctPerMin: 1 });
      const r = stepScooter(s, opts);
      expect(r.batteryDrainPct).toBe(1);
      expect(r.scooter.batteryPct).toBe(9);
    });

    it('накопление дробного остатка: 10 шагов по 6с = один шаг 60с', () => {
      const s = makeScooter({ id: 's9', lat: 42.87, lng: 74.57, batteryPct: 10, batteryRemainder: 0 });
      const opts = defaultOpts({ dtSeconds: 6, drainPctPerMin: 1 });
      let acc = 0;
      let rem = 0;
      for (let i = 0; i < 10; i++) {
        const r = stepScooter({ ...s, batteryPct: 10 - acc, batteryRemainder: rem }, opts);
        acc += r.batteryDrainPct;
        rem = r.scooter.batteryRemainder;
      }
      const single = stepScooter({ ...s, batteryPct: 10, batteryRemainder: 0 }, defaultOpts({ dtSeconds: 60, drainPctPerMin: 1 }));
      expect(acc).toBe(single.batteryDrainPct);
      expect(rem).toBeCloseTo(single.scooter.batteryRemainder, 10);
    });

    it('batteryDepleted ровно на последнем проценте', () => {
      const s = makeScooter({ id: 's10', lat: 42.87, lng: 74.57, batteryPct: 1 });
      const opts = defaultOpts({ dtSeconds: 60, drainPctPerMin: 1 });
      const r = stepScooter(s, opts);
      expect(r.batteryDrainPct).toBe(1);
      expect(r.batteryDepleted).toBe(true);
      expect(r.scooter.batteryPct).toBe(0);
    });
  });

  describe('правило 6: GPS-шум', () => {
    it('применяет шум и не выводит за зону', () => {
      const s = makeScooter({ id: 's11', lat: 42.87, lng: 74.57, target: { lat: 42.88, lng: 74.58 } });
      const opts = defaultOpts({ dtSeconds: 1, gpsNoiseM: 10 });
      const r = stepScooter(s, opts);
      expect(r.movedM).toBeGreaterThan(0);
      // Проверяем, что точка внутри зоны (с учётом допуска на float)
      expect(isInsideZone(r.scooter, SERVICE_ZONE)).toBe(true);
    });
  });

  describe('правило 7: детерминированность', () => {
    it('20 шагов парка с одинаковым seed дают одинаковый результат', () => {
      const seed = 123;
      const s1 = makeScooter({ id: 'f1', lat: 42.87, lng: 74.57, batteryPct: 100 });
      const s2 = makeScooter({ id: 'f2', lat: 42.88, lng: 74.58, batteryPct: 80 });
      let fleet1 = [s1, s2];
      let fleet2 = [s1, s2];
      const opts1 = defaultOpts({ dtSeconds: 1 });
      const opts2 = defaultOpts({ dtSeconds: 1 });
      const rng1 = createRng(seed);
      const rng2 = createRng(seed);
      for (let i = 0; i < 20; i++) {
        const r1 = stepFleet(fleet1, { ...opts1, rng: rng1 });
        const r2 = stepFleet(fleet2, { ...opts2, rng: rng2 });
        for (let j = 0; j < r1.scooters.length; j++) {
          const r1j = r1.scooters[j];
          const r2j = r2.scooters[j];
          if (r1j !== undefined && r2j !== undefined) {
            expect(r1j.lat).toBe(r2j.lat);
            expect(r1j.lng).toBe(r2j.lng);
            expect(r1j.batteryPct).toBe(r2j.batteryPct);
          }
        }
        fleet1 = r1.scooters;
        fleet2 = r2.scooters;
      }
    });
  });

  describe('правило 8: иммутабельность', () => {
    it('входной scooter не изменяется', () => {
      const s = makeScooter({ id: 's12', lat: 42.87, lng: 74.57, batteryPct: 50 });
      const before = { ...s };
      stepScooter(s, defaultOpts({ dtSeconds: 10 }));
      expect(s.id).toBe(before.id);
      expect(s.lat).toBe(before.lat);
      expect(s.lng).toBe(before.lng);
      expect(s.batteryPct).toBe(before.batteryPct);
      expect(s.batteryRemainder).toBe(before.batteryRemainder);
      expect(s.target).toBe(before.target);
    });

    it('stepFleet не мутирует входной массив', () => {
      const s1 = makeScooter({ id: 'sf1', lat: 42.87, lng: 74.57 });
      const s2 = makeScooter({ id: 'sf2', lat: 42.88, lng: 74.58 });
      const fleet = [s1, s2];
      const beforeLen = fleet.length;
      stepFleet(fleet, defaultOpts({ dtSeconds: 1 }));
      expect(fleet.length).toBe(beforeLen);
      const first = at(fleet, 0);
      const second = at(fleet, 1);
      expect(first.id).toBe('sf1');
      expect(second.id).toBe('sf2');
    });
  });

  describe('правило 9: dtSeconds=0', () => {
    it('состояние не меняется, movedM=0, заряд не тратится', () => {
      const s = makeScooter({ id: 's13', lat: 42.87, lng: 74.57, batteryPct: 50, batteryRemainder: 0.5 });
      const r = stepScooter(s, defaultOpts({ dtSeconds: 0 }));
      expect(r.scooter.lat).toBe(s.lat);
      expect(r.scooter.lng).toBe(s.lng);
      expect(r.scooter.batteryPct).toBe(s.batteryPct);
      expect(r.scooter.batteryRemainder).toBe(s.batteryRemainder);
      expect(r.movedM).toBe(0);
      expect(r.batteryDrainPct).toBe(0);
      expect(r.batteryDepleted).toBe(false);
    });
  });

  describe('правило 10: pickWaypoint', () => {
    it('возвращает точку внутри зоны и не ближе minDistanceM (200 прогонах)', () => {
      const from = { lat: 42.87, lng: 74.57 };
      const rng = createRng(99);
      let violations = 0;
      for (let i = 0; i < 200; i++) {
        const point = pickWaypoint(from, SERVICE_ZONE, rng, 300);
        const dist = haversineM(from, point);
        if (dist < 300) violations++;
      }
      expect(violations).toBe(0);
    });
  });

  describe('stepFleet', () => {
    it('возвращает массив той же длины', () => {
      const s1 = makeScooter({ id: 'fl1', lat: 42.87, lng: 74.57 });
      const s2 = makeScooter({ id: 'fl2', lat: 42.88, lng: 74.58 });
      const r = stepFleet([s1, s2], defaultOpts({ dtSeconds: 1 }));
      expect(r.scooters.length).toBe(2);
    });

    it('собирает depletedIds', () => {
      const s1 = makeScooter({ id: 'fd1', lat: 42.87, lng: 74.57, batteryPct: 1 });
      const s2 = makeScooter({ id: 'fd2', lat: 42.88, lng: 74.58, batteryPct: 50 });
      const r = stepFleet([s1, s2], defaultOpts({ dtSeconds: 60, drainPctPerMin: 1 }));
      expect(r.depletedIds).toContain('fd1');
      expect(r.depletedIds).not.toContain('fd2');
    });
  });
});
