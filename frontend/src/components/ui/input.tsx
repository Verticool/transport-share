import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils';

/** Поле ввода: цвета и границы — из токенов темы, состояния наведения и фокуса заданы явно. */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'hover:border-ring/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
