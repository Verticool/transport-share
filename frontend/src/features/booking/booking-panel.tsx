import { BOOKING_TTL_MINUTES, formatDuration } from '@sharing/shared';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';

export interface BookingPanelProps {
  /** Код самоката, который держит пользователь. */
  scooterCode: string;
  /** Осталось до автоматического снятия, миллисекунды. */
  remainingMs: number;
  /** Пора предупредить: до снятия не больше BOOKING_TTL_MINUTES. */
  expiresSoon: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/**
 * Панель активной брони: сколько самокат ещё держится за пользователем и кнопка «снять».
 *
 * Время показывается в формате мм:сс и обновляется каждую секунду — пользователь должен видеть,
 * что срок идёт, а не узнавать об этом в момент снятия.
 */
export function BookingPanel({
  scooterCode,
  remainingMs,
  expiresSoon,
  busy,
  onStart,
  onCancel,
}: BookingPanelProps) {
  const totalSeconds = Math.ceil(remainingMs / 1000);

  return (
    <Card data-testid="booking-panel">
      <CardHeader>
        <CardTitle>Самокат {scooterCode} забронирован</CardTitle>
        <CardDescription>
          Поездка не начата — самокат освободится сам через {BOOKING_TTL_MINUTES} минут
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between rounded-lg border bg-secondary/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Осталось</span>
          <span
            className="tabular text-2xl font-semibold"
            data-testid="booking-countdown"
            role="timer"
            aria-live="off"
          >
            {formatDuration(totalSeconds)}
          </span>
        </div>

        {expiresSoon && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="status"
          >
            Бронь снимется через {Math.ceil(totalSeconds / 60)} мин — начните поездку или снимите бронь.
          </p>
        )}

        <Button type="button" onClick={onStart} disabled={busy}>
          Начать поездку
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Снять бронь
        </Button>
      </CardContent>
    </Card>
  );
}
