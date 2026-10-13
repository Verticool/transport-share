import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TARIFF,
  LOW_BATTERY_THRESHOLD,
  SERVICE_ZONE,
  calcRidePrice,
  formatMinor,
  isInsideZone,
} from '@sharing/shared';
import type { Invoice, Iso, Ride, RidePause, Tariff } from '@sharing/shared';
import type { Pool, PoolClient } from 'pg';

import { withTransaction } from '../db/pool';
import { conflict, notFound, outsideZone } from '../http/errors';
import { closeOpenPause, findActiveRideRow, findRideRowById, finishRideRow, insertPauseRow, insertRideRow, listPauseRows, setRideStatus } from '../repo/rides';
import { insertEmailRow, insertInvoiceRow } from '../repo/invoices';
import { findBookingRowById, closeBookingRow } from '../repo/bookings';
import { toInvoice, toRide, toRidePause, type RideRow } from '../repo/rows';
import { findScooterRow, setScooterBattery, setScooterStatus } from '../repo/scooters';

/** Что сервер отдаёт вместе с поездкой: интерфейс не хранит ни цены, ни тариф. */
export interface RideSnapshot {
  ride: Ride;
  pauses: RidePause[];
  tariff: Tariff;
  serverTime: Iso;
}

export interface RideFinishResult extends RideSnapshot {
  invoice: Invoice;
}

export interface RideServiceDeps {
  pool: Pool;
  now: () => number;
  tariff?: Tariff;
}

/**
 * Поездки.
 *
 * Цену считает та же функция домена, что и раньше считал фронт: счёт и панель поездки не могут
 * разойтись, потому что считаются одним кодом. Сервер здесь — источник истины: бронь расходуется,
 * самокат уходит в поездку, счёт выпускается один раз.
 */
export class RideService {
  private readonly pool: Pool;
  private readonly now: () => number;
  private readonly tariff: Tariff;

  constructor(deps: RideServiceDeps) {
    this.pool = deps.pool;
    this.now = deps.now;
    this.tariff = deps.tariff ?? DEFAULT_TARIFF;
  }

  private async snapshot(client: PoolClient, row: RideRow): Promise<RideSnapshot> {
    const pauses = (await listPauseRows(client, row.id)).map(toRidePause);
    return {
      ride: toRide(row),
      pauses,
      tariff: this.tariff,
      serverTime: new Date(this.now()).toISOString(),
    };
  }

  /** Старт поездки из активной брони пользователя. */
  async start(bookingId: string, userId: string): Promise<RideSnapshot> {
    return withTransaction(this.pool, async (client) => {
      const booking = await findBookingRowById(client, bookingId);
      if (booking === null) {
        throw notFound('Бронь не найдена — возможно, срок уже истёк');
      }
      if (booking.user_id !== userId) {
        throw conflict('Эта бронь оформлена на другого пользователя');
      }
      if (booking.status !== 'active' || Date.parse(booking.expires_at) <= this.now()) {
        throw conflict('Бронь уже не действует');
      }

      const running = await findActiveRideRow(client, userId);
      if (running !== null) {
        throw conflict('У вас уже идёт поездка');
      }

      const scooter = await findScooterRow(client, booking.scooter_id);
      if (scooter === null) {
        throw notFound('Самокат не найден');
      }

      const row = await insertRideRow(client, {
        id: randomUUID(),
        userId,
        scooterId: booking.scooter_id,
        bookingId: booking.id,
        currency: this.tariff.currency,
      });

      await closeBookingRow(client, booking.id, 'consumed');
      await setScooterStatus(client, scooter.id, 'in_ride');

      return this.snapshot(client, row);
    });
  }

  /** Текущая поездка пользователя (в том числе на паузе). */
  async active(userId: string): Promise<RideSnapshot | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await findActiveRideRow(client, userId);
      return row === null ? null : this.snapshot(client, row);
    });
  }

  /** Требует свою поездку: чужая отдаётся как отсутствующая. */
  private async requireOwnRide(client: PoolClient, rideId: string, userId: string): Promise<RideRow> {
    const row = await findRideRowById(client, rideId);
    if (row?.user_id !== userId) {
      throw notFound('Поездка не найдена');
    }
    return row;
  }

  async pause(rideId: string, userId: string): Promise<RideSnapshot> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.requireOwnRide(client, rideId, userId);
      if (row.status === 'finished') {
        throw conflict('Поездка уже завершена');
      }
      if (row.status === 'paused') {
        throw conflict('Поездка уже на паузе');
      }

      await insertPauseRow(client, { id: randomUUID(), rideId: row.id });
      await setRideStatus(client, row.id, 'paused');

      const updated = await findRideRowById(client, row.id);
      return this.snapshot(client, updated ?? row);
    });
  }

  async resume(rideId: string, userId: string): Promise<RideSnapshot> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.requireOwnRide(client, rideId, userId);
      if (row.status !== 'paused') {
        throw conflict('Поездка не на паузе');
      }

      await closeOpenPause(client, row.id);
      await setRideStatus(client, row.id, 'active');

      const updated = await findRideRowById(client, row.id);
      return this.snapshot(client, updated ?? row);
    });
  }

  /** Финализация: цена, счёт, письмо, возврат самоката в парк. Один счёт на поездку. */
  private async finalize(
    client: PoolClient,
    row: RideRow,
    endReason: NonNullable<RideRow['end_reason']>,
  ): Promise<RideFinishResult> {
    const pauses = (await listPauseRows(client, row.id)).map(toRidePause);
    const nowMs = this.now();
    // Цену считает домен по доменному объекту: строка из базы — не тот тип, что ждёт функция.
    const breakdown = calcRidePrice(toRide(row), pauses, nowMs, this.tariff);

    await closeOpenPause(client, row.id);
    const finished = await finishRideRow(client, {
      id: row.id,
      endReason,
      totalAmount: breakdown.total,
      distanceM: row.distance_m,
    });

    const invoiceRow = await insertInvoiceRow(client, {
      id: randomUUID(),
      rideId: row.id,
      userId: row.user_id,
      breakdown,
      amount: breakdown.total,
      currency: this.tariff.currency,
    });

    const scooter = await findScooterRow(client, row.scooter_id);
    const toEmail = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
      row.user_id,
    ]);
    const email = toEmail.rows[0]?.email ?? 'unknown@example.com';


    // Требование ТЗ: по завершении приходит ровно одно письмо со счётом — ключ дедупликации
    // `invoice:<rideId>` держит это на уровне базы.
    const reasonNote =
      endReason === 'battery_depleted'
        ? ' Поездка завершена автоматически: у самоката закончился заряд.'
        : '';
    await insertEmailRow(client, {
      id: randomUUID(),
      userId: row.user_id,
      toEmail: email,
      subject: `Счёт за поездку ${scooter?.code ?? ''}`.trim(),
      body:
        `Спасибо за поездку! Итого: ${formatMinor(breakdown.total, this.tariff.currencySymbol)}. ` +
        `Время в пути: ${breakdown.rideMinutes} мин, паузы: ${breakdown.pauseMinutes} мин.${reasonNote}`,
      dedupeKey: `invoice:${row.id}`,
    });

    if (scooter !== null) {
      await setScooterStatus(
        client,
        scooter.id,
        scooter.battery_pct < LOW_BATTERY_THRESHOLD ? 'unavailable' : 'free',
      );
    }


    const pausesAfter = (await listPauseRows(client, row.id)).map(toRidePause);
    return {
      ride: toRide(finished),
      pauses: pausesAfter,
      tariff: this.tariff,
      serverTime: new Date(nowMs).toISOString(),
      invoice: toInvoice(invoiceRow),
    };
  }

  /**
   * Завершение поездки пользователем.
   *
   * Требование ТЗ: завершить можно только внутри зоны обслуживания. Проверяет сервер по
   * положению самоката из базы — интерфейс лишь показывает причину отказа.
   */
  async finish(rideId: string, userId: string): Promise<RideFinishResult> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.requireOwnRide(client, rideId, userId);
      if (row.status === 'finished') {
        throw conflict('Поездка уже завершена');
      }

      const scooter = await findScooterRow(client, row.scooter_id);
      if (scooter === null) {
        throw notFound('Самокат не найден');
      }
      if (!isInsideZone({ lat: scooter.lat, lng: scooter.lng }, SERVICE_ZONE)) {
        throw outsideZone('Здесь завершить поездку нельзя — вернитесь в зону обслуживания');
      }

      return this.finalize(client, row, 'user');
    });
  }

  /** Текущий заряд самоката: нужен симулятору и проверке «хватит ли доехать». */
  async scooterBattery(ride: Ride): Promise<number | null> {
    const scooter = await findScooterRow(this.pool, ride.scooterId);
    return scooter === null ? null : scooter.battery_pct;
  }

  async setBattery(scooterId: string, batteryPct: number, position?: { lat: number; lng: number }): Promise<void> {
    await setScooterBattery(this.pool, scooterId, batteryPct, position ?? {});
  }

  /** Паузы поездки: нужны расчёту суммы на стороне симулятора. */
  async pausesOf(rideId: string): Promise<RidePause[]> {
    return (await listPauseRows(this.pool, rideId)).map(toRidePause);
  }

  /** Действующий тариф: интерфейс и симулятор берут цены отсюда, а не из своих констант. */
  get tariffOf(): Tariff {
    return this.tariff;
  }

  /**
   * Принудительное завершение поездки сервером.
   *
   * Причина — разряд батареи или простой; проверка зоны здесь не применяется осознанно: если
   * самокат встал вне зоны, поездка всё равно должна закрыться, иначе счёт будет расти бесконечно.
   */
  async finishAutomatically(
    rideId: string,
    reason: NonNullable<RideRow['end_reason']>,
  ): Promise<RideFinishResult | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await findRideRowById(client, rideId);
      if (row === null || row.status === 'finished') {
        return null;
      }
      return this.finalize(client, row, reason);
    });
  }
}
