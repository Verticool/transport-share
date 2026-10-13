import type { IncomingMessage, Server } from 'node:http';

import type {
  Booking,
  Invoice,
  Iso,
  Ride,
  Scooter,
  ScooterDelta,
  ServerMessage,
  SnapshotPayload,
} from '@sharing/shared';
import { ClientMessageSchema, ServerMessageSchema } from '@sharing/shared';
import type { Pool } from 'pg';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { findActiveBookingRow } from '../repo/bookings';
import { findActiveRideRow, listOpenRideRows } from '../repo/rides';
import { toBooking, toRide, toScooter } from '../repo/rows';
import { listScooterRows } from '../repo/scooters';
import { verifyAccessToken } from '../auth/tokens';
import type { AppEnv } from '../config/env';

/** Приводит полученный кадр к строке: `ws` отдаёт Buffer, ArrayBuffer или их список. */
function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return Buffer.concat(data).toString('utf8');
}

export interface WsClient {
  socket: WebSocket;
  userId: string | null;
  lastSeq: number;
}

export interface WsHubDeps {
  pool: Pool;
  env: AppEnv;
  now: () => number;
  nextSeq: () => number;
}

/**
 * Хаб подписок.
 *
 * Каждое сообщение несёт `seq`: клиент отбрасывает те, что старше уже применённых, поэтому
 * реконнект не может откатить состояние назад (требование B7). Снапшот отдаётся по запросу,
 * дальше идут только изменения — это дешевле, чем присылать весь парк каждую секунду.
 */
export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WsClient>();
  private readonly pool: Pool;
  private readonly env: AppEnv;
  private readonly now: () => number;
  private readonly nextSeq: () => number;

  constructor(deps: WsHubDeps) {
    this.pool = deps.pool;
    this.env = deps.env;
    this.now = deps.now;
    this.nextSeq = deps.nextSeq;
    this.wss = new WebSocketServer({ noServer: true });
  }

  /** Подключает хаб к http-серверу Fastify: апгрейд только для пути `/ws`. */
  attach(server: Server): void {
    server.on('upgrade', (request: IncomingMessage, socket, head) => {
      const url = request.url ?? '';
      if (!url.startsWith('/ws')) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (socketUpgraded) => {
        this.onConnection(socketUpgraded);
      });
    });
  }

  get size(): number {
    return this.clients.size;
  }

  private onConnection(socket: WebSocket): void {
    const client: WsClient = { socket, userId: null, lastSeq: 0 };
    this.clients.add(client);

    socket.on('message', (data: RawData) => {
      void this.onMessage(client, rawToString(data));
    });
    socket.on('close', () => {
      this.clients.delete(client);
    });
    socket.on('error', () => {
      this.clients.delete(client);
    });

    // Первый снапшот отправляем сразу: без него карта ждала бы первого изменения.
    void this.sendSnapshot(client);
  }

  private async onMessage(client: WsClient, raw: string): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.sendError(client, 'invalid_payload', 'Сообщение не является JSON');
      return;
    }

    const parsed = ClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.sendError(client, 'invalid_payload', 'Неизвестный тип сообщения');
      return;
    }

    const message = parsed.data;
    if (message.type === 'ping') {
      this.send(client, { type: 'pong', seq: this.nextSeq(), sentAt: this.now(), serverTime: this.iso(), at: message.at });
      return;
    }

    if (message.type === 'subscribe') {
      client.userId = this.userIdFromToken(message.token);
      await this.sendSnapshot(client);
      return;
    }

    // snapshot запрашивается после реконнекта: клиент сообщает, что уже применил.
    if (message.type === 'snapshot') {
      client.lastSeq = message.sinceSeq ?? client.lastSeq;
      await this.sendSnapshot(client);
    }
  }

  private userIdFromToken(token: string | undefined): string | null {
    if (token === undefined) {
      return null;
    }
    const payload = verifyAccessToken(token, { secret: this.env.ACCESS_TOKEN_SECRET, nowMs: this.now() });
    return payload === null ? null : payload.sub;
  }

  private iso(): Iso {
    return new Date(this.now()).toISOString();
  }

  private send(client: WsClient, message: ServerMessage): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // Схема перед отправкой: расхождение контракта должно ломать тест, а не доходить до клиента.
    client.socket.send(JSON.stringify(ServerMessageSchema.parse(message)));
  }

  private sendError(client: WsClient, code: string, message: string): void {
    this.send(client, {
      type: 'error',
      seq: this.nextSeq(),
      sentAt: this.now(),
      serverTime: this.iso(),
      error: { code, message },
    });
  }

  /** Полный снапшот: парк, моя бронь, моя поездка. */
  async sendSnapshot(client: WsClient): Promise<void> {
    const scooters: Scooter[] = (await listScooterRows(this.pool)).map(toScooter);

    let myBooking: Booking | null = null;
    let myRide: Ride | null = null;
    if (client.userId !== null) {
      const bookingRow = await findActiveBookingRow(this.pool, client.userId);
      myBooking = bookingRow === null ? null : toBooking(bookingRow);
      const rideRow = await findActiveRideRow(this.pool, client.userId);
      myRide = rideRow === null ? null : toRide(rideRow);
    }

    const payload: SnapshotPayload = {
      scooters,
      myBooking,
      myRide,
      serverTime: this.iso(),
    };

    const seq = this.nextSeq();
    client.lastSeq = seq;
    this.send(client, { type: 'snapshot', seq, sentAt: this.now(), serverTime: this.iso(), payload });
  }

  /**
   * Рассылка конкретных событий.
   *
   * Методы названы по событиям, а не «отправь любое сообщение»: служебные поля (`seq`, `sentAt`,
   * `serverTime`) подставляет хаб, и вызывающий код не может забыть их или передать заглушку.
   */
  broadcastParkDelta(changes: ScooterDelta[]): void {
    if (changes.length === 0) {
      return;
    }
    this.broadcastToAll((seq) => ({
      type: 'park.delta',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      changes,
    }));
  }

  broadcastBookingExpired(bookingId: string): void {
    this.broadcastToAll((seq) => ({
      type: 'booking.expired',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      bookingId,
    }));
  }

  broadcastBookingExpiring(
    userId: string,
    payload: { bookingId: string; expiresAt: Iso; minutesLeft: number },
  ): void {
    this.broadcastToUser(userId, (seq) => ({
      type: 'booking.expiring',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      bookingId: payload.bookingId,
      expiresAt: payload.expiresAt,
      minutesLeft: payload.minutesLeft,
    }));
  }

  broadcastBookingCreated(userId: string, booking: Booking): void {
    this.broadcastToUser(userId, (seq) => ({
      type: 'booking.created',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      booking,
    }));
  }

  broadcastRideStarted(userId: string, ride: Ride): void {
    this.broadcastToUser(userId, (seq) => ({
      type: 'ride.started',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      ride,
    }));
  }

  broadcastRideFinished(userId: string, ride: Ride, invoice: Invoice, serverTime: Iso): void {
    this.broadcastToUser(userId, (seq) => ({
      type: 'ride.finished',
      seq,
      sentAt: this.now(),
      serverTime,
      ride,
      invoice,
    }));
  }

  broadcastRideTick(
    userId: string,
    payload: {
      rideId: string;
      status: Ride['status'];
      rideMinutes: number;
      pauseMinutes: number;
      amountSoFar: number;
      currency: string;
    },
  ): void {
    this.broadcastToUser(userId, (seq) => ({
      type: 'ride.tick',
      seq,
      sentAt: this.now(),
      serverTime: this.iso(),
      ...payload,
    }));
  }

  /** Всем подписчикам: состояние парка общее, персонализации здесь нет. */
  private broadcastToAll(build: (seq: number) => ServerMessage): void {
    for (const client of this.clients) {
      this.send(client, build(this.nextSeq()));
    }
  }

  /** Конкретному пользователю: бронь, поездка, счёт — это его данные. */
  private broadcastToUser(userId: string, build: (seq: number) => ServerMessage): void {
    for (const client of this.clients) {
      if (client.userId === userId) {
        this.send(client, build(this.nextSeq()));
      }
    }
  }

  /** Текущие открытые поездки: нужны симулятору, чтобы двигать только занятые самокаты. */
  async openRides(): Promise<Ride[]> {
    return (await listOpenRideRows(this.pool)).map(toRide);
  }

  close(): void {
    for (const client of this.clients) {
      client.socket.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
