import { AlertTriangle, BatteryWarning, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { useNotificationsStore, type NoticeTone } from '../../stores/notifications';

/**
 * Постоянные состояния под хедером: нет связи, самокат садится, поездка закрыта по разряду.
 *
 * Полоса держится, пока состояние не снято: в отличие от всплывающих оповещений её нельзя
 * «пропустить», потому что она всегда на виду — даже когда взгляд на карте.
 */
const TONE_CLASS: Record<NoticeTone, string> = {
  info: 'border-border bg-secondary text-secondary-foreground',
  warning: 'border-status-busy/40 bg-status-busy/10 text-status-busy',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
  success: 'border-status-free/40 bg-status-free/10 text-status-free',
};

const TONE_ICON: Record<NoticeTone, LucideIcon> = {
  info: AlertTriangle,
  warning: BatteryWarning,
  danger: WifiOff,
  success: AlertTriangle,
};

export function StatusBanner(): ReactNode {
  const persistent = useNotificationsStore((state) => state.persistent);

  if (persistent.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 border-b bg-card" data-testid="status-banner">
      {persistent.map((notice) => {
        const Icon = TONE_ICON[notice.tone];
        return (
          <div
            key={notice.key}
            role="status"
            data-testid={`status-banner-${notice.key}`}
            className={cn('flex items-start gap-2 border-b px-3 py-2 last:border-b-0 sm:px-4', TONE_CLASS[notice.tone])}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 break-words text-xs leading-snug">
              <span className="font-medium">{notice.title}</span>
              {notice.description === undefined ? null : ` ${notice.description}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
