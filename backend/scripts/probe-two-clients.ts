/**
 * Сценарий приёмки «два клиента одновременно» на собранном стеке.
 *
 * Запуск: `npx tsx scripts/probe-two-clients.ts [адрес]` (по умолчанию http://localhost:8088).
 * Оба клиента ходят снаружи, через один origin, как два браузера: разных пользователей
 * различает только токен. Скрипт печатает каждый шаг — это и есть сырой вывод для приёмки.
 */
import { z } from 'zod';

const BASE = process.argv[2] ?? 'http://localhost:8088';

const SessionSchema = z.object({ token: z.string(), user: z.object({ email: z.string() }) });
const ParkSchema = z.object({
  scooters: z.array(z.object({ id: z.string(), code: z.string(), status: z.string() })),
  serverTime: z.string(),
});
const BookingSchema = z.object({ booking: z.object({ id: z.string(), scooterId: z.string() }) });
const ErrorSchema = z.object({ code: z.string(), message: z.string() });

async function signIn(email: string): Promise<{ token: string; email: string }> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  const session = SessionSchema.parse(await response.json());
  process.stdout.write(`  клиент ${session.user.email}: вход ${response.status}\n`);
  return { token: session.token, email: session.user.email };
}

async function statusOf(scooterId: string): Promise<string> {
  const park = ParkSchema.parse(await (await fetch(`${BASE}/api/scooters`)).json());
  return park.scooters.find((scooter) => scooter.id === scooterId)?.status ?? 'нет такого';
}

async function main(): Promise<void> {
  process.stdout.write('Шаг 1. Два клиента входят разными пользователями\n');
  const first = await signIn('demo@sharing.kg');
  const second = await signIn('alan@example.com');

  process.stdout.write('\nШаг 2. Первый клиент бронирует свободный самокат\n');
  const park = ParkSchema.parse(await (await fetch(`${BASE}/api/scooters`)).json());
  const free = park.scooters.find((scooter) => scooter.status === 'free');
  if (free === undefined) {
    throw new Error('в парке нет свободного самоката');
  }
  const created = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${first.token}` },
    body: JSON.stringify({ scooterId: free.id }),
  });
  const booking = BookingSchema.parse(await created.json());
  process.stdout.write(`  ${first.email} → ${free.code}: ${created.status}\n`);
  process.stdout.write(`  состояние самоката для наблюдателя: ${await statusOf(free.id)}\n`);

  process.stdout.write('\nШаг 3. Второй клиент пытается забронировать тот же самокат\n');
  const conflict = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${second.token}` },
    body: JSON.stringify({ scooterId: free.id }),
  });
  const problem = ErrorSchema.parse(await conflict.json());
  process.stdout.write(`  ${second.email} → ${free.code}: ${conflict.status} ${problem.code} «${problem.message}»\n`);

  process.stdout.write('\nШаг 4. Второй клиент бронирует другой самокат — это разрешено\n');
  const other = park.scooters.find((scooter) => scooter.status === 'free' && scooter.id !== free.id);
  const secondBooking = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${second.token}` },
    body: JSON.stringify({ scooterId: other?.id ?? '' }),
  });
  const secondCreated = BookingSchema.parse(await secondBooking.json());
  process.stdout.write(`  ${second.email} → ${other?.code ?? '—'}: ${secondBooking.status}\n`);

  process.stdout.write('\nШаг 5. Первый клиент снимает бронь — самокат снова свободен для всех\n');
  const cancelled = await fetch(`${BASE}/api/bookings/${booking.booking.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${first.token}` },
  });
  process.stdout.write(`  отмена: ${cancelled.status}, состояние самоката: ${await statusOf(free.id)}\n`);

  process.stdout.write('\nИтог: два клиента работают одновременно, чужую бронь перехватить нельзя,\n');
  process.stdout.write(`состояние парка общее. Второй клиент держит свою бронь: ${secondCreated.booking.id.slice(0, 8)}…\n`);

  // Убираем за собой: второй клиент снимает свою бронь, чтобы повторный прогон начинался с чистого парка.
  await fetch(`${BASE}/api/bookings/${secondCreated.booking.id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${second.token}` },
  });
}

await main();
