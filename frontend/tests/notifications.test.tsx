import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusBanner } from '../src/features/notifications/status-banner';
import { Toaster } from '../src/features/notifications/toaster';
import { useConnectivity } from '../src/features/notifications/use-connectivity';
import { useNotificationsStore } from '../src/stores/notifications';

/**
 * Оповещения проверяются как поведение для пользователя: постоянные состояния висят полосой,
 * всплывающие появляются и сами скрываются, а состояние сети меняет одно на другое.
 */
beforeEach(() => {
  useNotificationsStore.getState().reset();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('оповещения', () => {
  it('постоянное состояние висит полосой, повторный вызов обновляет его, а не дублирует', () => {
    const { setPersistent } = useNotificationsStore.getState();

    act(() => {
      setPersistent({ key: 'low-battery', title: 'Батарея почти пуста: заряд 15 %', tone: 'warning' });
    });
    act(() => {
      setPersistent({ key: 'low-battery', title: 'Батарея почти пуста: заряд 9 %', tone: 'warning' });
    });

    render(<StatusBanner />);

    expect(screen.getAllByTestId('status-banner-low-battery')).toHaveLength(1);
    expect(screen.getByTestId('status-banner-low-battery')).toHaveTextContent('заряд 9 %');
  });

  it('полосы нет, когда состояний нет', () => {
    render(<StatusBanner />);

    expect(screen.queryByTestId('status-banner')).toBeNull();
  });

  it('всплывающее оповещение появляется поверх экрана и скрывается само', () => {
    vi.useFakeTimers();
    const { toast } = useNotificationsStore.getState();

    render(<Toaster />);
    act(() => {
      toast({ key: 'ride-battery-finished', title: 'Поездка завершена: самокат разрядился', tone: 'info', autoHideMs: 3000 });
    });

    expect(screen.getByTestId('toast-ride-battery-finished')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(screen.queryByTestId('toast-ride-battery-finished')).toBeNull();
  });

  it('всплывающее оповещение закрывается крестиком', async () => {
    const user = userEvent.setup();
    const { toast } = useNotificationsStore.getState();

    render(<Toaster />);
    act(() => {
      toast({ key: 'network-restored', title: 'Доступ восстановлен', tone: 'success' });
    });

    const close = screen.getByRole('button', { name: 'Закрыть оповещение' });
    await user.click(close);

    expect(screen.queryByTestId('toast-network-restored')).toBeNull();
  });

  it('потеря сети даёт постоянную полосу, а возвращение — оповещение и снятие полосы', () => {
    renderHook(() => useConnectivity());
    render(<StatusBanner />);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByTestId('status-banner-network')).toHaveTextContent('Нет доступа к интернету');

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByTestId('status-banner-network')).toBeNull();
    expect(useNotificationsStore.getState().toasts.some((item) => item.key === 'network-restored')).toBe(true);
  });
});
