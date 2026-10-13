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
 */
const StoredSessionSchema = z.object({
  token: z.string().min(1),
  user: PublicUserSchema,
});

export interface SessionState {
  token: string | null;
  user: PublicUser | null;
  signIn: (session: { token: string; user: PublicUser }) => void;
  signOut: () => void;
}

function readRawSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredSession(): { token: string; user: PublicUser } | null {
  const raw = readRawSession();
  if (raw === null) {
    return null;
  }

  const parsed = StoredSessionSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** Сессия пользователя: общая для шапки, кабинета и всех защищённых экранов. */
export const useSessionStore = create<SessionState>((set) => {
  const stored = readStoredSession();

  return {
    token: stored?.token ?? null,
    user: stored?.user ?? null,

    signIn: (session) => {
      writeLocalStorage(SESSION_STORAGE_KEY, JSON.stringify(session));
      set({ token: session.token, user: session.user });
    },

    signOut: () => {
      writeLocalStorage(SESSION_STORAGE_KEY, '');
      set({ token: null, user: null });
    },
  };
});
