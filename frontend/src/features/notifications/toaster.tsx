import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { playNotifySound } from '../../lib/notify-sound';
import { cn } from '../../lib/utils';
import { useNotificationsStore, type Notice, type NoticeTone } from '../../stores/notifications';

/** Сколько всплывающее оповещение висит само, если у него не задано своё время. */
const DEFAULT_AUTO_HIDE_MS = 6000;

const TONE_CLASS: Record<NoticeTone, string> = {
  info: 'border-border bg-card',
  warning: 'border-status-busy/50 bg-status-busy/10',
  danger: 'border-destructive/50 bg-destructive/10',
  success: 'border-status-free/50 bg-status-free/10',
};

/**
 * Всплывающие оповещения.
 *
 * Рисуются порталом поверх экрана (сверху по центру), поэтому их видно на любом экране и при
 * любом фокусе — карта, список, кабинет. Каждое само скрывается и закрывается крестиком;
 * появление сопровождается коротким звуком.
 */
export function Toaster(): ReactNode {
  const toasts = useNotificationsStore((state) => state.toasts);
  const dismissToast = useNotificationsStore((state) => state.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }
    // Звук один на появление: пачка одновременных оповещений не должна превращаться в трель.
    playNotifySound();
  }, [toasts.length]);

  if (toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div
      // Опускаемся ниже хедера и полосы состояний (высота приходит переменной из каркаса):
      // поверх хедера оповещение читается как сломанная вёрстка.
      style={{ top: 'calc(var(--notify-offset, 56px) + 8px)' }}
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-3"
      data-testid="toaster"
    >
      {toasts.map((notice) => (
        <Toast key={notice.key} notice={notice} onDismiss={() => dismissToast(notice.key)} />
      ))}
    </div>,
    document.body,
  );
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }): ReactNode {
  const autoHideMs = notice.autoHideMs ?? DEFAULT_AUTO_HIDE_MS;

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, autoHideMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoHideMs, onDismiss]);

  return (
    <div
      role="status"
      data-testid={`toast-${notice.key}`}
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border px-3 py-2 shadow-lg',
        TONE_CLASS[notice.tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notice.title}</p>
        {notice.description === undefined ? null : (
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{notice.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Закрыть оповещение"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
      >
        ×
      </button>
    </div>
  );
}
