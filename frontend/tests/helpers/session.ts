import { PublicUserSchema, type PublicUser } from '@sharing/shared';

import { useSessionStore } from '../../src/stores/session';
import { readMockFile } from './mock-files';

/** Доступ демонстрационного пользователя: на мок-стадии пароль один для всех (см. мок-клиент). */
export const DEMO_EMAIL = 'demo@sharing.kg';
export const DEMO_PASSWORD = 'demo1234';

/** Второй пользователь — нужен там, где проверяется «двое на один самокат». */
export const OTHER_EMAIL = 'alan@example.com';

export function mockUsers(): PublicUser[] {
  return PublicUserSchema.array().parse(JSON.parse(readMockFile('users.json')));
}

export function mockUserByEmail(email: string): PublicUser {
  const user = mockUsers().find((item) => item.email === email);
  if (user === undefined) {
    throw new Error(`в мок-данных нет пользователя ${email}`);
  }
  return user;
}

/**
 * Токен в том формате, который выдаёт мок-сервер.
 *
 * Данные проверяют токен сами (`tk-<идентификатор>-<выдача>`), не полагаясь на память процесса:
 * так сессия переживает перезагрузку страницы. Тестам это позволяет подставить сессию, не
 * выполняя вход целиком.
 */
export function tokenFor(user: PublicUser): string {
  return `tk-${user.id}-1700000000000`;
}

/** Кладёт сессию в стор: хуки берут токен оттуда, как в приложении. */
export function signInAs(user: PublicUser): string {
  const token = tokenFor(user);
  useSessionStore.getState().signIn({ token, user });
  return token;
}

export function signInAsDemo(): string {
  return signInAs(mockUserByEmail(DEMO_EMAIL));
}

export function signOutSession(): void {
  useSessionStore.getState().signOut();
}
