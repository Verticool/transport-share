import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app/App';

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

describe('каркас интерфейса', () => {
  it('показывает название сервиса в хедере', () => {
    renderApp();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('движ')).toBeInTheDocument();
  });

  it('содержит основную навигацию из трёх пунктов', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: 'Карта' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Кабинет' })).toBeInTheDocument();
  });

  it('на главной показывает контейнер карты', () => {
    renderApp('/');
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
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

  it('восстанавливает тему из localStorage и игнорирует мусор в нём', () => {
    window.localStorage.setItem('dvizh:theme', 'dark');
    const { unmount } = renderApp('/');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unmount();

    window.localStorage.setItem('dvizh:theme', 'не-тема');
    renderApp('/');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('открывает экран поездок по маршруту', () => {
    renderApp('/rides');
    expect(screen.getByRole('heading', { name: 'Поездки' })).toBeInTheDocument();
  });
});
