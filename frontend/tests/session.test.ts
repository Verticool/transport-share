import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicUser } from '@sharing/shared';

import { SESSION_STORAGE_KEY } from '../src/stores/session';

/**
 * Сессия и хранилище.
 *
 * Запись в localStorage — внешние данные: её мог оставить прошлый запуск, она могла испортиться.
 * Проверяем то, что однажды уже роняло приложение: пустая строка вместо JSON и выход, который
 * должен убирать запись, а не затирать её.
 */
const user: PublicUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'demo@sharing.kg',
  name: 'Демо',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const storedSession = (token = 'tk-access', refreshToken = 'rt-refresh'): string =>
  JSON.stringify({ token, refreshToken, user });

/** Стор читает хранилище при импорте, поэтому каждый случай берёт свежий модуль. */
async function loadSessionStore() {
  vi.resetModules();
  return import('../src/stores/session');
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('сессия', () => {
  it('пустая запись в хранилище не роняет приложение и убирается', async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, '');

    const { useSessionStore } = await loadSessionStore();

    expect(useSessionStore.getState().token).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('испорченная запись (не JSON) отбрасывается, а не роняет запуск', async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, '{"token": ');

    const { useSessionStore } = await loadSessionStore();

    expect(useSessionStore.getState().user).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('запись без токена обновления не считается входом', async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: 'tk', user }));

    const { useSessionStore } = await loadSessionStore();

    expect(useSessionStore.getState().token).toBeNull();
  });

  it('восстанавливает сохранённый вход вместе с токеном обновления', async () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, storedSession('tk-1', 'rt-1'));

    const { useSessionStore } = await loadSessionStore();

    expect(useSessionStore.getState().token).toBe('tk-1');
    expect(useSessionStore.getState().refreshToken).toBe('rt-1');
  });

  it('выход убирает запись из хранилища, а не оставляет пустую строку', async () => {
    const { useSessionStore } = await loadSessionStore();
    useSessionStore.getState().signIn({ token: 'tk-1', refreshToken: 'rt-1', user });
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(storedSession('tk-1', 'rt-1'));

    useSessionStore.getState().signOut();

    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(useSessionStore.getState().token).toBeNull();

    // Следующий запуск с пустым хранилищем — гость, и никаких исключений при разборе.
    const reloaded = await loadSessionStore();
    expect(reloaded.useSessionStore.getState().user).toBeNull();
  });

  it('продление заменяет оба токена и сохраняет профиль', async () => {
    const { useSessionStore } = await loadSessionStore();
    useSessionStore.getState().signIn({ token: 'tk-1', refreshToken: 'rt-1', user });

    useSessionStore.getState().updateTokens({ token: 'tk-2', refreshToken: 'rt-2' });

    expect(useSessionStore.getState().token).toBe('tk-2');
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe(storedSession('tk-2', 'rt-2'));
  });
});
