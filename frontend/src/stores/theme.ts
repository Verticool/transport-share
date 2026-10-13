import { create } from 'zustand';

import { writeLocalStorage } from '../lib/storage';
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

/**
 * Тема интерфейса — общее состояние приложения, а не состояние отдельного компонента.
 *
 * Почему стор, а не хук с `useState`: тему читают несколько независимых мест (переключатель
 * в шапке и канвас карты, который пересобирает цвета слоёв при смене схемы). С локальным
 * состоянием каждое из них получило бы собственную копию и карта осталась бы светлой.
 *
 * Смена темы сразу применяется к документу и сохраняется в хранилище; значение из хранилища
 * проходит zod-схему (RULES §F.3).
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),

  setTheme: (theme) => {
    applyTheme(theme);
    writeLocalStorage(THEME_STORAGE_KEY, theme);
    set({ theme });
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
}));
