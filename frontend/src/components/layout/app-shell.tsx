import { Bell, BellOff, Mail, Map, Receipt, Route, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { StatusBanner } from '../../features/notifications/status-banner';
import { Toaster } from '../../features/notifications/toaster';
import { useConnectivity } from '../../features/notifications/use-connectivity';
import { notifySoundEnabled, setNotifySoundEnabled } from '../../lib/notify-sound';
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
  // Связь отслеживается на уровне каркаса: полоса «нет интернета» должна быть видна на любом экране.
  useConnectivity();
  const [soundOn, setSoundOn] = useState(() => notifySoundEnabled());
  const headerRef = useRef<HTMLElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateOffset = (): void => {
      const headerHeight = headerRef.current?.offsetHeight ?? 56;
      const bannerHeight = bannerRef.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--notify-offset', `${headerHeight + bannerHeight}px`);
    };

    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    if (headerRef.current !== null) {
      observer.observe(headerRef.current);
    }
    if (bannerRef.current !== null) {
      observer.observe(bannerRef.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header
        ref={headerRef}
        className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-4 sm:px-4"
      >
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
          <Button
            variant="ghost"
            size="icon"
            aria-label={soundOn ? 'Выключить звук оповещений' : 'Включить звук оповещений'}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setNotifySoundEnabled(next);
            }}
          >
            {soundOn ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          </Button>
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

      {/* Полоса состояний меняет высоту (сколько состояний — столько полос), поэтому её высота
          вместе с хедером отдаётся в CSS: всплывающие оповещения встают ниже них, а не поверх. */}
      <div ref={bannerRef}>
        <StatusBanner />
      </div>
      <Toaster />

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
