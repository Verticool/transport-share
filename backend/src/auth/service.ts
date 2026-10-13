import { randomUUID } from 'node:crypto';

import type { PublicUser } from '@sharing/shared';
import type { Pool } from 'pg';

import type { AppEnv } from '../config/env';
import { conflict, unauthorized } from '../http/errors';
import { findUserByEmail, findUserById, insertUser } from '../repo/users';
import { findActiveSession, insertSession, revokeSession } from '../repo/sessions';
import { toPublicUser } from '../repo/rows';
import { hashPassword, verifyPassword } from './password';
import { generateRefreshToken, signAccessToken, verifyAccessToken } from './tokens';

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface AuthDeps {
  pool: Pool;
  env: AppEnv;
  now: () => number;
}

/**
 * Аутентификация.
 *
 * Два токена: короткий доступ подписан HMAC-ом (проверяется без базы) и долгое обновление лежит
 * в таблице сессий (его можно отозвать). Так выход действительно закрывает доступ, а не ждёт
 * истечения токена.
 */
export class AuthService {
  private readonly pool: Pool;
  private readonly env: AppEnv;
  private readonly now: () => number;

  constructor(deps: AuthDeps) {
    this.pool = deps.pool;
    this.env = deps.env;
    this.now = deps.now;
  }

  private issueAccessToken(user: PublicUser): { token: string; expiresAt: string } {
    return signAccessToken(
      { sub: user.id, email: user.email },
      { secret: this.env.ACCESS_TOKEN_SECRET, ttlMinutes: this.env.ACCESS_TOKEN_TTL_MINUTES, nowMs: this.now() },
    );
  }

  private async startSession(user: PublicUser, userAgent?: string): Promise<AuthSession> {
    const access = this.issueAccessToken(user);
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(
      this.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await insertSession(this.pool, {
      id: randomUUID(),
      userId: user.id,
      token: refreshToken,
      expiresAt: refreshExpiresAt,
      ...(userAgent === undefined ? {} : { userAgent }),
    });

    return {
      user,
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  async register(
    input: { email: string; password: string; name: string },
    userAgent?: string,
  ): Promise<AuthSession> {
    const existing = await findUserByEmail(this.pool, input.email);
    if (existing !== null) {
      throw conflict('Пользователь с такой почтой уже зарегистрирован');
    }

    const row = await insertUser(this.pool, {
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
    });

    return this.startSession(toPublicUser(row), userAgent);
  }

  async login(email: string, password: string, userAgent?: string): Promise<AuthSession> {
    const found = await findUserByEmail(this.pool, email);

    // Одинаковый ответ на «нет пользователя» и «неверный пароль»: адрес не должен утекать.
    if (found === null || !(await verifyPassword(password, found.passwordHash))) {
      throw unauthorized('Неверная почта или пароль');
    }

    return this.startSession(found.user, userAgent);
  }

  /** Обновление доступа: старая сессия гасится, выдаётся новая пара токенов. */
  async refresh(refreshToken: string, userAgent?: string): Promise<AuthSession> {
    const session = await findActiveSession(this.pool, refreshToken);
    if (session === null) {
      throw unauthorized('Сессия истекла — войдите заново');
    }

    const found = await findUserById(this.pool, session.user_id);
    if (found === null) {
      throw unauthorized('Сессия истекла — войдите заново');
    }

    await revokeSession(this.pool, refreshToken);
    return this.startSession(found.user, userAgent);
  }

  async logout(refreshToken: string): Promise<void> {
    await revokeSession(this.pool, refreshToken);
  }

  /** Пользователь по токену доступа: подпись и срок проверяются без обращения к базе. */
  async userByAccessToken(token: string): Promise<PublicUser> {
    const payload = verifyAccessToken(token, { secret: this.env.ACCESS_TOKEN_SECRET, nowMs: this.now() });
    if (payload === null) {
      throw unauthorized('Токен недействителен — войдите заново');
    }

    const found = await findUserById(this.pool, payload.sub);
    if (found === null) {
      throw unauthorized('Пользователь не найден');
    }
    return found.user;
  }
}
