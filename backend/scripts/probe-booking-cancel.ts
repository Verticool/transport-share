/**
 * Живая проверка: отмена брони возвращает самокат в парк и это видно подписчику потока.
 *
 * Запуск: npx tsx scripts/probe-booking-cancel.ts
 * Скрипт подписывается на поток как гость, оформляет бронь от имени демо-пользователя, снимает её
 * и печатает полученные сообщения — так видно, доходит ли смена статуса до остальных клиентов.
 */
import { ServerMessageSchema, type Scooter } from '@sharing/shared';
import { z } from 'zod';

const API = process.env['API_URL'] ?? 'http://127.0.0.1:8080';
const WS = API.replace('http', 'ws') + '/ws';

const ScootersSchema = z.object({ scooters: z.array(z.unknown()) });
const LoginSchema = z.object({ token: z.string() });
const BookingSchema = z.object({ booking: z.object({ id: z.string(), scooterId: z.string() }) });

const scooterCode = (raw: unknown): string => {
  const parsed = z.object({ code: z.string() }).safeParse(raw);
  return parsed.success ? parsed.data.code : '?';
};

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@sharing.kg', password: 'demo1234' }),
});
const { token } = LoginSchema.parse(await login.json());

const park = ScootersSchema.parse(await (await fetch(`${API}/api/scooters`)).json());
const free = park.scooters
  .map((raw) => z.object({ id: z.string(), status: z.string() }).parse(raw))
  .find((scooter) => scooter.status === 'free');
if (free === undefined) {
  throw new Error('нет свободных самокатов');
}

const seen: string[] = [];
const socket = new WebSocket(WS);
socket.addEventListener('message', (event) => {
  const parsed = ServerMessageSchema.safeParse(JSON.parse(String(event.data)));
  if (!parsed.success || parsed.data.type === 'pong') {
    return;
  }
  const message = parsed.data;
  if (message.type === 'snapshot') {
    const mine = message.payload.scooters.find((scooter) => scooter.id === free.id);
    seen.push(`snapshot: ${mine === undefined ? 'нет самоката' : `${mine.code} ${mine.status}`}`);
    return;
  }
  if (message.type === 'park.delta') {
    for (const change of message.changes) {
      seen.push(`park.delta: ${change.id.slice(0, 8)} → ${change.status}`);
    }
    return;
  }
  seen.push(message.type);
});

await new Promise((resolve) => socket.addEventListener('open', resolve));
socket.send(JSON.stringify({ type: 'subscribe' }));
await new Promise((resolve) => setTimeout(resolve, 400));

const created = await fetch(`${API}/api/bookings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ scooterId: free.id }),
});
const booking = BookingSchema.parse(await created.json());
await new Promise((resolve) => setTimeout(resolve, 400));

const cancelled = await fetch(`${API}/api/bookings/${booking.booking.id}`, {
  method: 'DELETE',
  headers: { authorization: `Bearer ${token}` },
});
await new Promise((resolve) => setTimeout(resolve, 600));

const after = ScootersSchema.parse(await (await fetch(`${API}/api/scooters`)).json());
const mine = after.scooters
  .map((raw) => z.object({ id: z.string(), status: z.string(), code: z.string() }).parse(raw))
  .find((scooter) => scooter.id === free.id);

process.stdout.write(`самокат: ${scooterCode(free)} (${free.id.slice(0, 8)})\n`);
process.stdout.write(`бронь создана: ${created.status} ${booking.booking.id.slice(0, 8)}\n`);
process.stdout.write(`бронь снята: ${cancelled.status}\n`);
process.stdout.write(`статус в базе после отмены: ${mine === undefined ? 'нет' : mine.status}\n`);
process.stdout.write(`сообщения потока:\n  ${seen.join('\n  ')}\n`);

socket.close();

/** Служебная обёртка, чтобы типы Scooter из общего контракта оставались задействованы. */
export type { Scooter };
