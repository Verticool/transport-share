import { Mail, Map, Receipt, Route, UserRound, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { ThemeToggle } from '../ui/theme-toggle';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useSessionStore } from '../../stores/session';

/**
 * Разделы интерфейса.
 *
 * На узком экране подписи заменяются иконками: четыре текстовых пункта не влезали вместе с
 * кнопкой входа — «Входящие» обрезалось, а часть панели уезжала за край (проверено замером 390 px).
 */
const NAV_ITEMS: { to: string; label: string; end: boolean; icon: LucideIcon }[] = [
  { to: '/', label: 'Карта', end: true, icon: Map },
  { to: '/rides', label: 'Поездки', end: false, icon: Route },
  { to: '/invoices', label: 'Счета', end: false, icon: Receipt },
  { to: '/inbox', label: 'Входящие', end: false, icon: Mail },
];

/**
 * Каркас интерфейса: хедер с названием сервиса, навигация, тема и вход.
 * Содержимое экранов приходит через Outlet — компоненты экранов не знают про этот слой.
 */
export function AppShell() {
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-4 sm:px-4">
        <NavLink to="/" className="flex items-baseline gap-0.5" aria-label="Движ — на главную">
          <span className="text-lg font-semibold tracking-tight">движ</span>
          <span className="text-lg font-semibold text-primary">.</span>
        </NavLink>

        {/* Навигация — единственная часть хедера, которой разрешено сжиматься и прокручиваться:
            иначе на узком экране кнопка входа уезжала за край (проверено замером 390 px). */}
        <nav
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Основная навигация"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  'shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:px-3',
                  isActive && 'bg-accent text-accent-foreground font-medium',
                )
              }
            >
              <item.icon className="size-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          {user === null ? (
            <Button variant="outline" size="sm" onClick={() => void navigate('/login')}>
              Войти
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void navigate('/account')}>
              <UserRound aria-hidden />
              {/* Имя убираем на узком экране: карточка парка важнее, а иконка узнаётся. */}
              <span className="hidden max-w-28 truncate sm:inline">{user.name}</span>
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
