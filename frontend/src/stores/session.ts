import type { PublicUser } from '@sharing/shared';
import { PublicUserSchema } from '@sharing/shared';
import { create } from 'zustand';
import { z } from 'zod';

import { writeLocalStorage } from '../lib/storage';

export const SESSION_STORAGE_KEY = 'dvizh:session';

/**
 * Хранимая сессия.
 *
 * Значение из localStorage — такие же внешние данные, как ответ сервера, поэтому оно проходит
 * zod-схему: испорченная или устаревшая запись не должна ронять приложение при запуске.
 * Токен обновления лежит рядом с коротким токеном: без него доступ не продлить, и после его
 * истечения пользователю пришлось бы входить заново.
 */
const StoredSessionSchema = z.object({
  token: z.string().min(1),
  refreshToken: z.string().min(1),
  user: PublicUserSchema,
});

export interface SessionState {
  token: string | null;
  refreshToken: string | null;
  user: PublicUser | null;
  signIn: (session: { token: string; refreshToken: string; user: PublicUser }) => void;
  /** Обновление токенов: профиль не меняется, меняются только подписи. */
  updateTokens: (tokens: { token: string; refreshToken: string }) => void;
  signOut: () => void;
}

function readRawSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredSession(): { token: string; refreshToken: string; user: PublicUser } | null {
  const raw = readRawSession();
  if (raw === null) {
    return null;
  }

  const parsed = StoredSessionSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Сессия пользователя: общая для шапки, кабинета и всех защищённых экранов. */
export const useSessionStore = create<SessionState>((set, get) => {
  const stored = readStoredSession();

  const persist = (session: { token: string; refreshToken: string; user: PublicUser }): void => {
    writeLocalStorage(SESSION_STORAGE_KEY, JSON.stringify(session));
  };

  return {
    token: stored?.token ?? null,
    refreshToken: stored?.refreshToken ?? null,
    user: stored?.user ?? null,

    signIn: (session) => {
      persist(session);
      set({ token: session.token, refreshToken: session.refreshToken, user: session.user });
    },

    updateTokens: (tokens) => {
      const current = get();
      if (current.user === null) {
        return;
      }
      persist({ token: tokens.token, refreshToken: tokens.refreshToken, user: current.user });
      set({ token: tokens.token, refreshToken: tokens.refreshToken });
    },

    signOut: () => {
      writeLocalStorage(SESSION_STORAGE_KEY, '');
      set({ token: null, refreshToken: null, user: null });
    },
  };
});
