import { useThemeStore } from '../stores/theme';
import type { Theme } from '../lib/theme';

export interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Тема интерфейса для компонентов. Значение живёт в общем сторе (см. `stores/theme.ts`),
 * поэтому переключатель в шапке и карта видят одну и ту же схему, а не каждый свою копию.
 */
export function useTheme(): UseThemeResult {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return { theme, setTheme, toggleTheme };
}
