import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/auth/password';

/**
 * Пароли не хранятся в открытом виде: в базе лежит scrypt-хеш с солью. Проверка сравнивает
 * постоянное по времени значение, а испорченная строка в базе означает «не подходит», а не сбой.
 */
describe('пароли', () => {
  it('не хранит пароль в открытом виде', async () => {
    const hash = await hashPassword('demo1234');

    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('demo1234');
  });

  it('даёт разные хеши для одинаковых паролей: соль на каждый пароль своя', async () => {
    const first = await hashPassword('demo1234');
    const second = await hashPassword('demo1234');

    expect(first).not.toBe(second);
  });

  it('принимает верный пароль', async () => {
    const hash = await hashPassword('demo1234');

    await expect(verifyPassword('demo1234', hash)).resolves.toBe(true);
  });

  it('отклоняет неверный пароль', async () => {
    const hash = await hashPassword('demo1234');

    await expect(verifyPassword('demo12345', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('не падает на испорченной строке в базе', async () => {
    await expect(verifyPassword('demo1234', 'не-хеш')).resolves.toBe(false);
    await expect(verifyPassword('demo1234', 'scrypt$$')).resolves.toBe(false);
    await expect(verifyPassword('demo1234', 'md5$abc$def')).resolves.toBe(false);
  });
});
