import type { FastifyRequest } from 'fastify';

import { unauthorized } from './errors';

/**
 * Токен доступа из заголовка `Authorization`.
 *
 * Формат строго `Bearer <токен>`: любое отклонение — это отсутствие доступа, а не «попробуем
 * угадать», иначе однажды кто-то передаст токен в query-параметре и он попадёт в логи.
 */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
    return null;
  }
  return token;
}

/** Тот же токен, но обязательный: для ручек, где гость не имеет смысла. */
export function requireBearerToken(request: FastifyRequest): string {
  const token = bearerToken(request);
  if (token === null) {
    throw unauthorized();
  }
  return token;
}
