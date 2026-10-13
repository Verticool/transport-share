import { useCallback, useEffect, useState } from 'react';

import { writeLocalStorage } from '../lib/storage';
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';

export interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Тема интерфейса: светлая по умолчанию, тёмная — по переключателю.
 *
 * Тема применяется классом на <html> (токены в global.css), выбор сохраняется в localStorage.
 * Запись в хранилище идёт из эффекта, а не из обработчика: так состояние и хранилище
 * не могут разойтись при любом способе смены темы.
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    writeLocalStorage(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme };
}
