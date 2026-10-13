import type { LatLng, ScooterStatus, ServiceZone } from '../domain.ts';
import {
  clampToZone,
  distanceToZoneBoundaryM,
  haversineM,
  isInsideZone,
  moveByBearing,
  moveTowards,
  randomPointInZone,
  zoneCenter,
} from '../zone.ts';
import {
  BATTERY_DRAIN_PCT_PER_MIN,
  SIM,
  ZONE_WARN_DISTANCE_M,
} from '../constants.ts';

/** Детерминированный ГПСЧ (mulberry32), чтобы прогоны с одним seed совпадали. */
export function createRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b7975) | 0;
    const t = Math.imul(s, s) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Состояние самоката в симуляторе. */
export interface SimScooter {
  id: string;
  status: ScooterStatus;
  lat: number;
  lng: number;
  batteryPct: number;
  /** Незавершённый остаток заряда от прошлых тиков (доли процента), чтобы не терять расход. */
  batteryRemainder: number;
  /** Цель движения; null — самокат стоит. */
  target: LatLng | null;
}

export interface StepOptions {
  /** Шаг времени, секунды. 0 — допустимо (шага нет). */
  dtSeconds: number;
  rng: () => number;
  zone: ServiceZone;
  /** Переопределения констант (по умолчанию — из constants.ts). */
  speedMps?: number;
  gpsNoiseM?: number;
  drainPctPerMin?: number;
  waypointReachedM?: number;
  zoneWarnDistanceM?: number;
}

export interface StepResult {
  /** Новое состояние (входной объект не мутируется). */
  scooter: SimScooter;
  /** Пройденное за шаг расстояние, метры. */
  movedM: number;
  /** Сколько целых процентов заряда ушло за шаг. */
  batteryDrainPct: number;
  /** Заряд упал до 0 в этом шаге — поездку надо завершать (B6). */
  batteryDepleted: boolean;
  /** Самокат достиг цели и получил новую. */
  waypointReached: boolean;
}

export interface FleetStepResult {
  scooters: SimScooter[];
  /** id самокатов, у которых заряд дошёл до 0 на этом шаге. */
  depletedIds: string[];
}

function applyNoise(from: LatLng, zone: ServiceZone, noiseM: number, rng: () => number): LatLng {
  const bearing = rng() * 360;
  const distance = rng() * noiseM;
  const noisy = moveByBearing(from, distance, bearing);
  return isInsideZone(noisy, zone) ? noisy : clampToZone(noisy, zone);
}

function drainForStep(drainPctPerMin: number, dtSeconds: number, remainder: number): {
  drainPct: number;
  newRemainder: number;
} {
  const total = drainPctPerMin * dtSeconds / 60 + remainder;
  const drainPct = Math.floor(total + 1e-12);
  const newRemainder = total - drainPct;
  return { drainPct, newRemainder };
}

export function stepScooter(scooter: SimScooter, opts: StepOptions): StepResult {
  const {
    dtSeconds,
    rng,
    zone,
    speedMps = SIM.speedMps,
    gpsNoiseM = SIM.gpsNoiseM,
    drainPctPerMin = BATTERY_DRAIN_PCT_PER_MIN,
    waypointReachedM = SIM.waypointReachedM,
    zoneWarnDistanceM = ZONE_WARN_DISTANCE_M,
  } = opts;

  const base = {
    id: scooter.id,
    status: scooter.status,
    batteryPct: scooter.batteryPct,
    batteryRemainder: scooter.batteryRemainder,
  };

  if (dtSeconds === 0) {
    return {
      scooter: { ...base, lat: scooter.lat, lng: scooter.lng, target: scooter.target },
      movedM: 0,
      batteryDrainPct: 0,
      batteryDepleted: false,
      waypointReached: false,
    };
  }

  if (scooter.status !== 'in_ride') {
    return {
      scooter: { ...base, lat: scooter.lat, lng: scooter.lng, target: scooter.target },
      movedM: 0,
      batteryDrainPct: 0,
      batteryDepleted: false,
      waypointReached: false,
    };
  }

  if (scooter.target === null) {
    return {
      scooter: { ...base, lat: scooter.lat, lng: scooter.lng, target: null },
      movedM: 0,
      batteryDrainPct: 0,
      batteryDepleted: false,
      waypointReached: false,
    };
  }

  const distToTarget = haversineM({ lat: scooter.lat, lng: scooter.lng }, scooter.target);

  let newTarget = scooter.target;
  let movedM = 0;
  let waypointReached = false;
  let current: LatLng = { lat: scooter.lat, lng: scooter.lng };

  if (distToTarget <= waypointReachedM) {
    newTarget = pickWaypoint(current, zone, rng, 300);
    movedM = distToTarget;
    waypointReached = true;
    current = scooter.target;
  } else if (distanceToZoneBoundaryM(current, zone) < zoneWarnDistanceM) {
    newTarget = pickWaypoint(current, zone, rng, 300);
  } else {
    const distance = speedMps * dtSeconds;
    const next = moveTowards(current, scooter.target, distance);
    movedM = haversineM(current, next);
    current = next;

    // Шаг мог довести самокат до цели — тогда цель считается достигнутой в этом же шаге,
    // иначе waypointReached срабатывал бы только на следующем тике.
    if (haversineM(current, scooter.target) <= waypointReachedM) {
      newTarget = pickWaypoint(current, zone, rng, 300);
      waypointReached = true;
    }
  }

  if (movedM > 0 || (movedM === 0 && scooter.status === 'in_ride' && scooter.target !== null)) {
    const noisy = applyNoise(current, zone, gpsNoiseM, rng);
    current = isInsideZone(noisy, zone) ? noisy : clampToZone(noisy, zone);
  }

  const { drainPct, newRemainder } = drainForStep(drainPctPerMin, dtSeconds, scooter.batteryRemainder);
  const newBatteryPct = scooter.batteryPct - drainPct;
  const depleted = newBatteryPct <= 0;

  return {
    scooter: { ...base, lat: current.lat, lng: current.lng, target: newTarget, batteryPct: newBatteryPct, batteryRemainder: newRemainder },
    movedM,
    batteryDrainPct: drainPct,
    batteryDepleted: depleted,
    waypointReached,
  };
}

export function stepFleet(scooters: SimScooter[], opts: StepOptions): FleetStepResult {
  const results: SimScooter[] = [];
  const depletedIds: string[] = [];
  for (const scooter of scooters) {
    const result = stepScooter(scooter, opts);
    results.push(result.scooter);
    if (result.batteryDepleted) {
      depletedIds.push(scooter.id);
    }
  }
  return { scooters: results, depletedIds };
}

export function pickWaypoint(from: LatLng, zone: ServiceZone, rng: () => number, minDistanceM = 300): LatLng {
  for (let i = 0; i < 1000; i++) {
    const point = randomPointInZone(zone, rng);
    if (haversineM(from, point) >= minDistanceM) {
      return point;
    }
  }
  return zoneCenter(zone);
}
