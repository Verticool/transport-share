import { formatDuration, formatMinor, type Minor, type RideStatus } from '@sharing/shared';
import { Pause, Play, Square } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { cn } from '../../lib/utils';

export interface RidePanelProps {
  /** Код самоката, на котором идёт поездка. */
  scooterCode: string;
  status: RideStatus;
  /** Прошло от старта, секунды (без пауз). */
  elapsedSeconds: number;
  rideMinutes: number;
  pauseMinutes: number;
  /** Текущая сумма в минорных единицах. */
  amount: Minor;
  currencySymbol: string;
  /** Можно ли завершить поездку здесь: вне зоны обслуживания — нет. */
  canFinishHere: boolean;
  /** Связь с источником данных потеряна: сумма считается, но может отставать. */
  offline: boolean;
  busy: boolean;
  error: string | null;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
}

/**
 * Панель активной поездки: время, минуты по каждому тарифу и текущая сумма.
 *
 * Кнопка завершения неактивна вне зоны обслуживания — пользователь видит причину рядом с кнопкой,
 * а не узнаёт об отказе после нажатия (серверная проверка при этом остаётся: интерфейс не источник истины).
 */
export function RidePanel({
  scooterCode,
  status,
  elapsedSeconds,
  rideMinutes,
  pauseMinutes,
  amount,
  currencySymbol,
  canFinishHere,
  offline,
  busy,
  error,
  onPause,
  onResume,
  onFinish,
}: RidePanelProps) {
  const paused = status === 'paused';

  return (
    <Card data-testid="ride-panel">
      <CardHeader>
        <CardTitle>Поездка на {scooterCode}</CardTitle>
        <CardDescription>{paused ? 'Пауза — время тарифицируется отдельно' : 'Едем'}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between rounded-lg border bg-secondary/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">На счётчике</span>
          <span className="tabular text-2xl font-semibold" data-testid="ride-timer" role="timer">
            {formatDuration(elapsedSeconds)}
          </span>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border px-3 py-2">
            <dt className="text-muted-foreground">Езда</dt>
            <dd className="tabular text-sm font-medium" data-testid="ride-minutes">
              {rideMinutes} мин
            </dd>
          </div>
          <div className="rounded-lg border px-3 py-2">
            <dt className="text-muted-foreground">Пауза</dt>
            <dd className="tabular text-sm font-medium" data-testid="pause-minutes">
              {pauseMinutes} мин
            </dd>
          </div>
          <div className="rounded-lg border bg-accent/40 px-3 py-2">
            <dt className="text-muted-foreground">Сумма</dt>
            <dd className="tabular text-sm font-semibold" data-testid="ride-amount">
              {formatMinor(amount, currencySymbol)}
            </dd>
          </div>
        </dl>

        {offline && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="status">
            Связь пропала — поездка идёт, счёт продолжается. Покажем актуальные данные, когда связь вернётся.
          </p>
        )}

        {error !== null && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {paused ? (
            <Button type="button" className="flex-1" onClick={onResume} disabled={busy}>
              <Play aria-hidden />
              Продолжить
            </Button>
          ) : (
            <Button type="button" variant="secondary" className="flex-1" onClick={onPause} disabled={busy}>
              <Pause aria-hidden />
              Пауза
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className={cn('flex-1', paused && 'text-muted-foreground')}
            onClick={onFinish}
            disabled={busy || !canFinishHere}
            title={canFinishHere ? undefined : 'Завершить поездку можно только в зоне обслуживания'}
          >
            <Square aria-hidden />
            Завершить
          </Button>
        </div>

        {!canFinishHere && (
          <p className="text-xs text-muted-foreground">
            Вы за границей зоны обслуживания — вернитесь в зону, чтобы завершить поездку.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
