/**
 * Проверка собранного стека в контейнерах: фронт отвечает, API проксируется, поток событий живой.
 *
 * Запуск: `npx tsx scripts/probe-container.ts [адрес]` (по умолчанию http://localhost:8088).
 * Скрипт ходит снаружи, как браузер: через один origin, без прямого доступа к бэкенду.
 */
import { ServerMessageSchema } from '@sharing/shared';
import { WebSocket } from 'ws';
import { z } from 'zod';

const BASE = process.argv[2] ?? 'http://localhost:8088';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

const HealthSchema = z.object({
  status: z.string(),
  serverTime: z.string(),
  db: z.object({ ok: z.boolean(), migrationsApplied: z.number() }),
});
const SessionSchema = z.object({ token: z.string(), refreshToken: z.string(), user: z.object({ email: z.string() }) });
const ParkSchema = z.object({ scooters: z.array(z.object({ id: z.string(), code: z.string(), status: z.string() })) });
const BookingSchema = z.object({ booking: z.object({ id: z.string(), scooterId: z.string() }) });

async function main(): Promise<void> {
  const page = await fetch(`${BASE}/`);
  process.stdout.write(`страница: ${page.status} (${page.headers.get('content-type') ?? '—'})\n`);

  const health = HealthSchema.parse(await (await fetch(`${BASE}/api/health`)).json());
  process.stdout.write(
    `api через прокси: ${health.status}, схема применена (${health.db.migrationsApplied} миграции), база ${health.db.ok ? 'доступна' : 'недоступна'}\n`,
  );

  const park = ParkSchema.parse(await (await fetch(`${BASE}/api/scooters`)).json());
  const free = park.scooters.find((scooter) => scooter.status === 'free');
  process.stdout.write(`парк: ${park.scooters.length} самокатов, свободен например ${free?.code ?? '—'}\n`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@sharing.kg', password: 'demo1234' }),
  });
  const session = SessionSchema.parse(await login.json());
  process.stdout.write(`вход: ${login.status}, пользователь ${session.user.email}\n`);

  const booking = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ scooterId: free?.id ?? '' }),
  });
  const created = BookingSchema.parse(await booking.json());
  process.stdout.write(`бронь через прокси: ${booking.status}, самокат ${free?.code ?? '—'}\n`);

  // Поток событий: подписываемся гостём и проверяем, что приходит снапшот, а дальше изменения.
  const frames: string[] = [];
  const socket = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => socket.send(JSON.stringify({ type: 'subscribe' })));
    socket.on('message', (data: Buffer | string) => {
      const parsed = ServerMessageSchema.safeParse(JSON.parse(typeof data === 'string' ? data : data.toString('utf8')));
      if (!parsed.success || parsed.data.type === 'pong') {
        return;
      }
      frames.push(parsed.data.type);
      if (parsed.data.type === 'snapshot') {
        process.stdout.write(
          `поток через прокси: снапшот, самокатов ${parsed.data.payload.scooters.length}, seq ${parsed.data.seq}\n`,
        );
        resolve();
      }
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('поток не ответил за 8 с')), 8000);
  });

  // Снятие брони: проверяем, что изменение состояния доходит до подписчика (дельта в потоке).
  const cancel = await fetch(`${BASE}/api/bookings/${created.booking.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${session.token}` },
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  socket.close();

  process.stdout.write(`снятие брони: ${cancel.status}\n`);
  process.stdout.write(`кадры потока: ${frames.join(', ')}\n`);
}

await main();
