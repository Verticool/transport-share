import { LoginRequestSchema, RegisterRequestSchema } from '@sharing/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthService } from '../auth/service';
import { invalidPayload, unauthorized } from '../http/errors';
import { bearerToken } from '../http/context';

/** Тело выхода и обновления: токен обновления приходит в теле, чтобы не попадать в логи прокси. */
const RefreshRequestSchema = z.object({ refreshToken: z.string().min(1) });

/** Ответ входа: токены и профиль. */
const SessionResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }).passthrough(),
  token: z.string(),
  expiresAt: z.string(),
  refreshToken: z.string(),
});

interface AuthRoutesOptions {
  auth: AuthService;
}

function userAgentOf(headers: Record<string, unknown>): string | undefined {
  const value = headers['user-agent'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Ручки аутентификации.
 *
 * Все тела проверяются zod-схемами из общего пакета: контракт один для фронта и бэкенда, поэтому
 * расхождение в полях становится ошибкой валидации, а не молча потерянным значением.
 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const { auth } = options;

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Проверьте почту, пароль и имя');
    }

    const session = await auth.register(parsed.data, userAgentOf(request.headers));
    return reply.code(201).send(
      SessionResponseSchema.parse({
        user: session.user,
        token: session.accessToken,
        expiresAt: session.accessExpiresAt,
        refreshToken: session.refreshToken,
      }),
    );
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Укажите почту и пароль');
    }

    const session = await auth.login(parsed.data.email, parsed.data.password, userAgentOf(request.headers));
    return reply.code(200).send(
      SessionResponseSchema.parse({
        user: session.user,
        token: session.accessToken,
        expiresAt: session.accessExpiresAt,
        refreshToken: session.refreshToken,
      }),
    );
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Не указан токен обновления');
    }

    const session = await auth.refresh(parsed.data.refreshToken, userAgentOf(request.headers));
    return reply.code(200).send(
      SessionResponseSchema.parse({
        user: session.user,
        token: session.accessToken,
        expiresAt: session.accessExpiresAt,
        refreshToken: session.refreshToken,
      }),
    );
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw invalidPayload('Не указан токен обновления');
    }

    await auth.logout(parsed.data.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/me', async (request, reply) => {
    const token = bearerToken(request);
    if (token === null) {
      throw unauthorized();
    }

    const user = await auth.userByAccessToken(token);
    return reply.code(200).send({ user: user });
  });
}
