import { zodParseLocalStorage } from '../lib/storage';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dvizh:theme';

/** Значение из localStorage — это внешние данные, поэтому проходит zod-схему с фолбэком. */
export function readStoredTheme(): Theme {
  // Аргументы: ключ, значение по умолчанию (светлая тема), затем список допустимых значений.
  return zodParseLocalStorage(THEME_STORAGE_KEY, 'light', 'light', 'dark');
}

/** Применяет тему к корневому элементу: класс .dark включает тёмную схему токенов. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme;
}
