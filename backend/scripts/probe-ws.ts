import {
  BookingSchema,
  ClientMessageSchema,
  InvoiceSchema,
  RideSchema,
  ScooterSchema,
  ServerMessageSchema,
} from '@sharing/shared';
import type { ServerMessage } from '@sharing/shared';
import { WebSocket } from 'ws';
import { z } from 'zod';

/**
 * Живая проверка WebSocket: два подписчика, снапшот, изменения парка.
 * Запуск: npx tsx scripts/probe-ws.ts [http://127.0.0.1:8080]
 */
const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const wsUrl = `${base.replace('http', 'ws')}/ws`;

const LoginSchema = z.object({ token: z.string() });
const ParkSchema = z.object({ scooters: z.array(ScooterSchema) });
const ScooterResponseSchema = z.object({ scooter: ScooterSchema });
const BookingResponseSchema = z.object({ booking: BookingSchema });
const RideResponseSchema = z.object({ ride: RideSchema });
const FinishResponseSchema = z.object({ invoice: InvoiceSchema });

async function post(path: string, body: unknown, token: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function get(path: string, token?: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return response.json();
}

const login = LoginSchema.parse(await post('/api/auth/login', { email: 'demo@sharing.kg', password: 'demo1234' }, ''));
console.log('вход выполнен, токен получен');

const park = ParkSchema.parse(await get('/api/scooters'));
const free = park.scooters.find((scooter) => scooter.status === 'free');
console.log('свободный самокат:', free?.code);

const watchers: { name: string; items: ServerMessage[] }[] = [
  { name: 'подписчик с токеном', items: [] },
  { name: 'гость без токена', items: [] },
];

const sockets = watchers.map((watcher, index) => {
  const socket = new WebSocket(wsUrl);
  socket.on('message', (data: unknown) => {
    const parsed = ServerMessageSchema.safeParse(JSON.parse(String(data)));
    if (parsed.success) {
      watcher.items.push(parsed.data);
    }
  });
  socket.on('open', () => {
    socket.send(
      JSON.stringify(
        index === 0
          ? ClientMessageSchema.parse({ type: 'subscribe', token: login.token })
          : ClientMessageSchema.parse({ type: 'subscribe' }),
      ),
    );
  });
  return socket;
});

await new Promise((resolve) => setTimeout(resolve, 700));

for (const watcher of watchers) {
  const snapshot = watcher.items.find((message) => message.type === 'snapshot');
  console.log(
    `${watcher.name}: снапшот получен =`,
    snapshot?.type === 'snapshot',
    snapshot?.type === 'snapshot'
      ? `| самокатов ${snapshot.payload.scooters.length}, seq ${snapshot.seq}, своя бронь: ${snapshot.payload.myBooking === null ? 'нет' : 'есть'}`
      : '',
  );
}

sockets[0]?.send(JSON.stringify(ClientMessageSchema.parse({ type: 'ping', at: Date.now() })));
await new Promise((resolve) => setTimeout(resolve, 300));
console.log('pong получен:', watchers[0]?.items.some((message) => message.type === 'pong') === true);

if (free !== undefined) {
  const booking = BookingResponseSchema.parse(await post('/api/bookings', { scooterId: free.id }, login.token));
  const ride = RideResponseSchema.parse(
    await post('/api/rides', { bookingId: booking.booking.id }, login.token),
  );
  console.log('поездка начата:', ride.ride.id);

  const before = ScooterResponseSchema.parse(await get(`/api/scooters/${free.id}`));
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const after = ScooterResponseSchema.parse(await get(`/api/scooters/${free.id}`));

  const movedM = Math.round(
    Math.hypot(after.scooter.lat - before.scooter.lat, after.scooter.lng - before.scooter.lng) * 111_000,
  );
  console.log(
    'движение за 4 с:',
    `перемещение ≈ ${movedM} м,`,
    `заряд ${before.scooter.batteryPct} % → ${after.scooter.batteryPct} %`,
  );

  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const watcher of watchers) {
    const types = watcher.items.map((message) => message.type);
    console.log(
      `${watcher.name}: сообщения —`,
      JSON.stringify([...new Set(types)]),
      '| park.delta:',
      watcher.items.filter((message) => message.type === 'park.delta').length,
    );
  }

  const delta = watchers[0]?.items.find((message) => message.type === 'park.delta');
  if (delta?.type === 'park.delta') {
    console.log('первое изменение парка:', JSON.stringify(delta.changes[0]));
  }

  const finished = FinishResponseSchema.parse(await post(`/api/rides/${ride.ride.id}/finish`, {}, login.token));
  console.log('поездка завершена, счёт:', JSON.stringify(finished.invoice));
}

for (const socket of sockets) {
  socket.close();
}
