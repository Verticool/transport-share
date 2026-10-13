import { Moon, Sun } from 'lucide-react';

import { Button } from './button';
import { useTheme } from '../../hooks/use-theme';

/** Переключатель темы. Доступен с клавиатуры, состояние озвучивается через aria-label. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={nextLabel}
      title={nextLabel}
      data-testid="theme-toggle"
      data-theme={theme}
    >
      {theme === 'dark' ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </Button>
  );
}
