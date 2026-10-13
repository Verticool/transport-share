import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Обёртка над колбэк-версией scrypt: без приведения типов, которые запрещены рулсетом. */
function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** Длина ключа и соли. 64 байта ключа и 16 байт соли — обычные значения для scrypt. */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Формат строки в базе: `scrypt$<соль в base64>$<ключ в base64>`. */
const PREFIX = 'scrypt';

/**
 * Хеширует пароль.
 *
 * scrypt из стандартной библиотеки: без внешних зависимостей (в проекте запрещены лишние пакеты),
 * с солью на каждый пароль и с памятью, которую трудно обойти перебором.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Проверяет пароль против хеша.
 *
 * Сравнение — постоянное по времени (`timingSafeEqual`): иначе по времени ответа можно подбирать
 * пароль посимвольно. Ошибка формата — это «не подходит», а не исключение: испорченная строка
 * в базе не должна ронять вход.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return false;
  }

  const salt = Buffer.from(parts[1] ?? '', 'base64');
  const expected = Buffer.from(parts[2] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
