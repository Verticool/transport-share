import type { ScooterStatus } from '@sharing/shared';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import {
  SCOOTER_STATUS_BADGE_CLASS,
  SCOOTER_STATUS_DOT_CLASS,
  SCOOTER_STATUS_INFO,
} from '../../config/scooter-status';

/**
 * Бейдж статуса самоката. Цвет приходит из токенов темы (`--status-*` в global.css)
 * через статические классы из реестра статусов — тот же источник, что и у маркеров карты.
 */
export interface StatusBadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  status: ScooterStatus;
  /** Дополнительный текст справа, например заряд. */
  children?: ReactNode;
}

export function StatusBadge({ status, className, children, ...props }: StatusBadgeProps) {
  const info = SCOOTER_STATUS_INFO[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        SCOOTER_STATUS_BADGE_CLASS[status],
        className,
      )}
      data-status={status}
      {...props}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', SCOOTER_STATUS_DOT_CLASS[status])} />
      {info.label}
      {children}
    </span>
  );
}
