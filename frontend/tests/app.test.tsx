import { PublicUserSchema } from '@sharing/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app/App';
import { readStoredTheme } from '../src/lib/theme';
import { useSessionStore } from '../src/stores/session';
import { readMockFile } from './helpers/mock-files';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

/** Вход в демонстрационного пользователя: экраны кабинета закрыты сессией. */
function signInDemoUser(): void {
  const users = PublicUserSchema.array().parse(JSON.parse(readMockFile('users.json')));
  const user = users[0];
  if (user === undefined) {
    throw new Error('в мок-данных нет пользователя');
  }
  useSessionStore.getState().signIn({ token: 'tk-test', refreshToken: 'rt-test', user });
}

describe('каркас интерфейса', () => {
  it('показывает название сервиса в хедере', () => {
    renderApp();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('движ')).toBeInTheDocument();
  });

  it('содержит основную навигацию из четырёх пунктов', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: 'Карта' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Поездки' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Счета' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Входящие' })).toBeInTheDocument();
  });

  it('на главной показывает карту парка', () => {
    renderApp('/');
    expect(screen.getByTestId('map-canvas')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Карта самокатов' })).toBeInTheDocument();
  });

  it('переключает тему и запоминает выбор', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const toggle = screen.getByTestId('theme-toggle');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(toggle);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('dvizh:theme')).toBe('dark');

    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(window.localStorage.getItem('dvizh:theme')).toBe('light');
  });

  it('читает тему из localStorage и отбрасывает мусор в нём', () => {
    window.localStorage.setItem('dvizh:theme', 'dark');
    expect(readStoredTheme()).toBe('dark');

    window.localStorage.setItem('dvizh:theme', 'не-тема');
    expect(readStoredTheme()).toBe('light');
  });

  it('без входа кабинет не открывается: экран поездок уводит на вход', () => {
    useSessionStore.getState().signOut();
    renderApp('/rides');

    expect(screen.getByRole('heading', { name: 'Вход в Движ' })).toBeInTheDocument();
  });

  it('вошедшему открывает экран поездок по маршруту', () => {
    signInDemoUser();
    renderApp('/rides');

    expect(screen.getByRole('heading', { name: 'Поездки' })).toBeInTheDocument();
  });

  it('показывает имя вошедшего и уводит в кабинет', async () => {
    const user = userEvent.setup();
    signInDemoUser();
    renderApp('/');

    const header = screen.getByRole('banner');
    await user.click(within(header).getByRole('button', { name: 'Демо' }));

    // Кабинет открылся: в нём есть переходы к своим разделам.
    expect(screen.getByRole('link', { name: 'История поездок' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });
});
