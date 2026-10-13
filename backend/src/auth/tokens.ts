import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Токены доступа.
 *
 * Формат — JWT (HS256) на стандартной библиотеке: подпись и проверка занимают десяток строк, и
 * внешняя зависимость ради этого не нужна. Разделение на «короткий доступ» и «долгое обновление»
 * даёт то, что нужно: доступ нельзя отозвать (он живёт минуты), а сессию можно погасить (она в базе).
 */
export interface AccessTokenPayload {
  /** Идентификатор пользователя. */
  sub: string;
  email: string;
  /** Время выдачи и истечения, секунды Unix. */
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Подписывает токен доступа. */
export function signAccessToken(
  payload: Omit<AccessTokenPayload, 'iat' | 'exp'>,
  options: { secret: string; ttlMinutes: number; nowMs: number },
): { token: string; expiresAt: string } {
  const iat = Math.floor(options.nowMs / 1000);
  const exp = iat + options.ttlMinutes * 60;
  const body: AccessTokenPayload = { ...payload, iat, exp };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify(body));
  const signature = sign(`${header}.${claims}`, options.secret);

  return {
    token: `${header}.${claims}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Проверяет токен доступа.
 *
 * Возвращает `null` вместо исключения: недействительный токен — ожидаемая ситуация (истёк,
 * подделан, мусор в заголовке), а не сбой. Сравнение подписи — постоянное по времени.
 */
export function verifyAccessToken(
  token: string,
  options: { secret: string; nowMs: number },
): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, claims, signature] = parts;
  if (header === undefined || claims === undefined || signature === undefined) {
    return null;
  }

  const expected = sign(`${header}.${claims}`, options.secret);
  const given = Buffer.from(signature, 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  if (given.length !== mine.length || !timingSafeEqual(given, mine)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record: Record<string, unknown> = { ...parsed };
  const sub = record['sub'];
  const email = record['email'];
  const iat = record['iat'];
  const exp = record['exp'];

  if (typeof sub !== 'string' || typeof email !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') {
    return null;
  }
  if (exp * 1000 <= options.nowMs) {
    return null;
  }

  return { sub, email, iat, exp };
}

/** Токен обновления: случайная строка, её хеш хранится в базе. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
