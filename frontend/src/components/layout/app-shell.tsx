import { NavLink, Outlet } from 'react-router-dom';

import { ThemeToggle } from '../ui/theme-toggle';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Карта', end: true },
  { to: '/rides', label: 'Поездки', end: false },
  { to: '/account', label: 'Кабинет', end: false },
];

/**
 * Каркас интерфейса: хедер с названием сервиса, навигация и переключатель темы.
 * Содержимое экранов приходит через Outlet — компоненты экранов не знают про этот слой.
 */
export function AppShell() {
  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4">
        <NavLink to="/" className="flex items-baseline gap-0.5" aria-label="Движ — на главную">
          <span className="text-lg font-semibold tracking-tight">движ</span>
          <span className="text-lg font-semibold text-primary">.</span>
        </NavLink>

        <nav className="flex items-center gap-1" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground font-medium',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm">
            Войти
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
