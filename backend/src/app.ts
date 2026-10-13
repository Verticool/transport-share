import { ApiErrorSchema } from '@sharing/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { AuthService } from './auth/service';
import type { AppEnv } from './config/env';
import { ApiProblem } from './http/errors';
import { registerAuthRoutes } from './routes/auth';
import { HealthSchema, readHealth, type HealthDb, type HealthDeps } from './routes/health';
import { registerParkRoutes } from './routes/park';
import { registerSharingRoutes } from './routes/sharing';
import { BookingService } from './services/booking-service';
import { ParkSimulator } from './sim/simulator';
import { RideService } from './services/ride-service';
import { Sequence } from './state/sequence';
import { WsHub } from './ws/hub';

export interface BuildAppOptions {
  env: AppEnv;
  /** Пул соединений: нужен и ручкам, и сервисам. */
  pool: Pool;
  /** Источник данных для проверки доступности: по умолчанию тот же пул (тесты подставляют свой). */
  db?: HealthDb;
  /** Часы: инъекция для тестов, чтобы время в ответах и тайминги были предсказуемыми. */
  now?: () => number;
  /** Логи: в тестах выключаются, в работе пишутся pino в stdout. */
  logger?: boolean;
  /** Период симулятора, мс: в тестах тик вызывается вручную, поэтому значение не важно. */
  simTickMs?: number;
  bookingTickMs?: number;
}

export interface AppBundle {
  app: FastifyInstance;
  hub: WsHub;
  simulator: ParkSimulator;
  auth: AuthService;
  bookings: BookingService;
  rides: RideService;
}

/**
 * Собирает приложение: HTTP-ручки, WebSocket-хаб и симулятор парка.
 *
 * Отдельная функция (а не запуск внутри) нужна тестам: `app.inject` работает с тем же экземпляром,
 * что и в проде, а симулятор можно «прокрутить» вручную через `simulator.tick()`.
 *
 * CORS не подключается осознанно: и в разработке (прокси Vite), и в контейнерах (прокси nginx)
 * фронт и бэкенд живут на одном источнике, поэтому браузер не делает предварительных запросов.
 */
export function buildApp(options: BuildAppOptions): AppBundle {
  const now = options.now ?? (() => Date.now());
  const sequence = new Sequence();

  const auth = new AuthService({ pool: options.pool, env: options.env, now });
  const bookings = new BookingService({ pool: options.pool, now });
  const rides = new RideService({ pool: options.pool, now });

  const hub = new WsHub({
    pool: options.pool,
    env: options.env,
    now,
    nextSeq: () => sequence.next(),
  });

  // В тестах логгер выключен целиком, поэтому отдельно глушить логи запросов не нужно.
  const fastifyOptions: FastifyServerOptions = {
    logger: options.logger === false ? false : { level: options.env.LOG_LEVEL },
  };
  const app: FastifyInstance = Fastify(fastifyOptions);

  const simulator = new ParkSimulator({
    pool: options.pool,
    hub,
    bookings,
    rides,
    now,
    // Ошибка тика должна попадать в лог: иначе сломанный симулятор выглядит как «карта замерла».
    onError: (error) => {
      app.log.error({ err: error }, 'ошибка тика симулятора');
    },
    ...(options.simTickMs === undefined ? {} : { tickMs: options.simTickMs }),
    ...(options.bookingTickMs === undefined ? {} : { bookingTickMs: options.bookingTickMs }),
  });

  const deps: HealthDeps = {
    db: options.db ?? options.pool,
    version: '0.1.0',
    startedAtMs: now(),
    now,
  };

  /**
   * Единая обработка ошибок.
   *
   * Ошибка сервиса отвечает по контракту `ApiErrorSchema` с HTTP-кодом из своего вида; всё
   * остальное — «внутренняя ошибка» без подробностей наружу (подробности уходят в лог).
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiProblem) {
      return reply.code(error.status).send(ApiErrorSchema.parse(error.toApiError()));
    }

    // Ошибка разбора запроса приходит не от нашего сервиса: тип у неё внешний, поэтому проверяем
    // форму, а не тип. Пустое тело с `content-type: application/json` тоже сюда попадает — это
    // ошибка клиента (400), а не отказ сервера, и клиент должен увидеть причину, а не «500».
    const parsed = z
      .object({ validation: z.unknown().optional(), statusCode: z.number().optional() })
      .safeParse(error);
    if (parsed.success) {
      const clientFault =
        parsed.data.validation !== undefined ||
        (parsed.data.statusCode !== undefined &&
          parsed.data.statusCode >= 400 &&
          parsed.data.statusCode < 500);
      if (clientFault) {
        return reply.code(400).send({ code: 'invalid_payload', message: 'Неверный запрос' });
      }
    }

    request.log.error({ err: error }, 'необработанная ошибка');
    return reply.code(500).send({ code: 'internal', message: 'Внутренняя ошибка сервера' });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ code: 'not_found', message: `Маршрут ${request.url} не найден` }),
  );

  app.get('/api/health', async (_request, reply) => {
    const { health, ok } = await readHealth(deps);
    // Схема ответа — контракт: если поля разойдутся с фронтом, это поймается тестом, а не глазами.
    const parsed = HealthSchema.parse(health);
    return reply.code(ok ? 200 : 503).send(parsed);
  });

  registerAuthRoutes(app, { auth });
  registerParkRoutes(app, {
    pool: options.pool,
    bookingService: bookings,
    now,
    nextSeq: () => sequence.next(),
  });
  registerSharingRoutes(app, { pool: options.pool, auth, bookings, rides, now, hub });

  return { app, hub, simulator, auth, bookings, rides };
}
