import {
  BATTERY_DRAIN_PCT_PER_MIN,
  BOOKING_TICK_MS,
  SERVICE_ZONE,
  SIM,
  SIM_TICK_MS,
  calcRidePrice,
  isInsideZone,
} from '@sharing/shared';
import { createRng, pickWaypoint, stepFleet } from '@sharing/shared/sim';
import type { LatLng, ScooterDelta } from '@sharing/shared';
import type { Pool } from 'pg';

import type { BookingService } from '../services/booking-service';
import type { RideService } from '../services/ride-service';
import { listOpenRideRows } from '../repo/rides';
import { toRide } from '../repo/rows';
import { findScooterRow, listScooterRows, setScooterBattery } from '../repo/scooters';
import type { WsHub } from '../ws/hub';

export interface ParkSimulatorDeps {
  pool: Pool;
  hub: WsHub;
  bookings: BookingService;
  rides: RideService;
  now: () => number;
  /** Зерно генератора: тесты получают воспроизводимое движение. */
  seed?: number;
  tickMs?: number;
  bookingTickMs?: number;
  /** Обработчик ошибок тика: по умолчанию ошибки не видны, приложение передаёт лог. */
  onError?: (error: unknown) => void;
}

/**
 * Серверный симулятор парка.
 *
 * Самокаты движутся и разряжаются по тем же правилам, что описаны в домене (`shared/sim`):
 * сервер лишь применяет шаг к данным в базе и рассылает изменения. Так карта у всех клиентов
 * меняется одновременно — не потому, что каждый браузер что-то досчитал, а потому что состояние
 * одно и лежит на сервере.
 */
export class ParkSimulator {
  private readonly pool: Pool;
  private readonly hub: WsHub;
  private readonly bookings: BookingService;
  private readonly rides: RideService;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly tickMs: number;
  private readonly bookingTickMs: number;

  /** Цели движения и остатки заряда живут в памяти: в базе хранить доли процента незачем. */
  private readonly targets = new Map<string, LatLng | null>();
  private readonly remainder = new Map<string, number>();

  /** Куда сообщать об ошибках тика: молча глотать их нельзя, иначе симулятор «тихо умирает». */
  private readonly onError: (error: unknown) => void;
  private tickTimer: NodeJS.Timeout | null = null;
  private bookingTimer: NodeJS.Timeout | null = null;

  constructor(deps: ParkSimulatorDeps) {
    this.pool = deps.pool;
    this.hub = deps.hub;
    this.bookings = deps.bookings;
    this.rides = deps.rides;
    this.now = deps.now;
    this.rng = createRng(deps.seed ?? 7);
    this.tickMs = deps.tickMs ?? SIM_TICK_MS;
    this.bookingTickMs = deps.bookingTickMs ?? BOOKING_TICK_MS;
    this.onError = deps.onError ?? (() => undefined);
  }

  start(): void {
    this.tickTimer ??= setInterval(() => {
      void this.tick().catch(this.onError);
    }, this.tickMs);
    this.bookingTimer ??= setInterval(() => {
      void this.bookingTick().catch(this.onError);
    }, this.bookingTickMs);
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.bookingTimer !== null) {
      clearInterval(this.bookingTimer);
      this.bookingTimer = null;
    }
  }

  /**
   * Цель движения самоката: у занятых — точка в зоне, у свободных — покой.
   *
   * Важно пересчитывать цель, когда самокат встал в поездку: запомненный «покой» от прошлого
   * тика иначе оставался бы навсегда, и самокат не двигался бы вовсе (на это указывала живая
   * проверка: поездка идёт, а координаты в базе не меняются).
   */
  private targetFor(id: string, position: LatLng, riding: boolean): LatLng | null {
    if (!riding) {
      this.targets.set(id, null);
      return null;
    }

    const known = this.targets.get(id);
    if (known !== null && known !== undefined) {
      return known;
    }

    const target = pickWaypoint(position, SERVICE_ZONE, this.rng);
    this.targets.set(id, target);
    return target;
  }

  /**
   * Один шаг симулятора: движение, расход заряда, рассылка изменений и автофиниш разряженных.
   * Возвращает изменения — их можно проверить в тесте, не поднимая WebSocket.
   */
  /**
   * Закрывает поездки, чей самокат оказался вне зоны обслуживания.
   *
   * Проверка идёт до шага движения: симулятор удерживает технику в зоне, и после шага «вне зоны»
   * уже не наблюдается — правило сработало бы никогда.
   */
  private async closeRidesOutsideZone(): Promise<void> {
    for (const row of await listOpenRideRows(this.pool)) {
      const ride = toRide(row);
      const scooter = await findScooterRow(this.pool, ride.scooterId);
      if (scooter === null || isInsideZone({ lat: scooter.lat, lng: scooter.lng }, SERVICE_ZONE)) {
        continue;
      }
      const finished = await this.rides.finishAutomatically(ride.id, 'service').catch(() => null);
      if (finished !== null) {
        this.hub.broadcastRideFinished(
          finished.ride.userId,
          finished.ride,
          finished.invoice,
          finished.serverTime,
        );
      }
    }
  }

  async tick(): Promise<ScooterDelta[]> {
    await this.closeRidesOutsideZone();

    const rows = await listScooterRows(this.pool);
    const openRides = (await listOpenRideRows(this.pool)).map(toRide);
    const ridingScooterIds = new Set(openRides.map((ride) => ride.scooterId));

    const state = rows.map((row) => {
      const position: LatLng = { lat: row.lat, lng: row.lng };
      const riding = ridingScooterIds.has(row.id);
      return {
        id: row.id,
        status: row.status,
        lat: row.lat,
        lng: row.lng,
        batteryPct: row.battery_pct,
        batteryRemainder: this.remainder.get(row.id) ?? 0,
        target: this.targetFor(row.id, position, riding),
      };
    });

    const step = stepFleet(state, {
      dtSeconds: this.tickMs / 1000,
      rng: this.rng,
      zone: SERVICE_ZONE,
      drainPctPerMin: BATTERY_DRAIN_PCT_PER_MIN,
    });

    const changes: ScooterDelta[] = [];
    for (const scooter of step.scooters) {
      const previous = state.find((item) => item.id === scooter.id);
      this.targets.set(scooter.id, scooter.target);
      this.remainder.set(scooter.id, scooter.batteryRemainder);

      const moved =
        previous !== undefined &&
        (previous.lat !== scooter.lat ||
          previous.lng !== scooter.lng ||
          previous.batteryPct !== scooter.batteryPct);
      if (!moved) {
        continue;
      }

      await setScooterBattery(this.pool, scooter.id, scooter.batteryPct, {
        lat: scooter.lat,
        lng: scooter.lng,
      });

      changes.push({
        id: scooter.id,
        status: scooter.status,
        batteryPct: scooter.batteryPct,
        lat: scooter.lat,
        lng: scooter.lng,
        lastSeenAt: new Date(this.now()).toISOString(),
      });
    }

    this.hub.broadcastParkDelta(changes);

    // Разряд: поездка завершается сама, клиент получает и событие, и счёт.
    for (const depletedId of step.depletedIds) {
      const ride = openRides.find((item) => item.scooterId === depletedId);
      if (ride === undefined) {
        continue;
      }
      const finished = await this.rides
        .finishAutomatically(ride.id, 'battery_depleted')
        .catch(() => null);
      if (finished !== null) {
        this.hub.broadcastRideFinished(
          finished.ride.userId,
          finished.ride,
          finished.invoice,
          finished.serverTime,
        );
      }
    }


    // Тик поездок: клиент видит, как растёт сумма, не дожидаясь своих запросов.
    const stillOpen = await listOpenRideRows(this.pool);
    for (const row of stillOpen) {
      const ride = toRide(row);
      const pauses = await this.rides.pausesOf(ride.id);
      const breakdown = calcRidePrice(ride, pauses, this.now(), this.rides.tariffOf);
      this.hub.broadcastRideTick(ride.userId, {
        rideId: ride.id,
        status: ride.status,
        rideMinutes: breakdown.rideMinutes,
        pauseMinutes: breakdown.pauseMinutes,
        amountSoFar: breakdown.total,
        currency: ride.currency,
      });
    }

    return changes;
  }

  /** Тик обслуживания броней: снятие просроченных и предупреждение за 3 минуты. */
  async bookingTick(): Promise<void> {
    const result = await this.bookings.tick();

    for (const booking of result.expired) {
      this.hub.broadcastBookingExpired(booking.id);
    }

    for (const booking of result.expiring) {
      this.hub.broadcastBookingExpiring(booking.userId, {
        bookingId: booking.id,
        expiresAt: booking.expiresAt,
        minutesLeft: booking.minutesLeft,
      });
    }
  }

  /** Параметры для тестов: период тиков и итоговое зерно. */
  get config(): { tickMs: number; bookingTickMs: number; seed: number } {
    return { tickMs: this.tickMs, bookingTickMs: this.bookingTickMs, seed: SIM.speedMps };
  }
}
