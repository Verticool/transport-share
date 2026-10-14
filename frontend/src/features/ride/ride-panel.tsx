import { formatDuration, formatMinor, type Minor, type RideStatus, type SteerDirection } from '@sharing/shared';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';

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
  /** Возврат самоката в зону: за границей завершить поездку нельзя. */
  onPushToZone: () => void;
  /** Руль для проверки границы зоны: сдвинуть самокат на шаг в выбранную сторону. */
  onSteer: (direction: SteerDirection) => void;
}

/**
 * Панель активной поездки: время, минуты по каждому тарифу и текущая сумма.
 *
 * Кнопка завершения неактивна вне зоны обслуживания — пользователь видит причину рядом с кнопкой,
 * а не узнаёт об отказе после нажатия (серверная проверка при этом остаётся: интерфейс не источник истины).
 */
/** Кнопка руля: одна сторона света, крупная цель для нажатия. */
function SteerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button type="button" variant="outline" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

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
  onPushToZone,
  onSteer,
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
          <div
            className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3"
            data-testid="outside-zone"
          >
            <p className="text-xs text-destructive">
              Самокат за границей зоны обслуживания — завершить поездку здесь нельзя, пока он не
              вернётся в зелёную зону. Поездка не закрыта: время и минуты продолжают
              тарифицироваться.
            </p>
            <p className="text-xs text-muted-foreground">
              Самокат на ходу, так что доехать до зоны можно рулём (ниже) — или вернуть его
              одним действием.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onPushToZone} disabled={busy}>
              Вернуть самокат в зону
            </Button>
          </div>
        )}

        {/* Руль стенда: у настоящего самоката его нет, но без него нельзя проверить границу зоны —
            симулятор возит технику сам и всегда внутри зоны. На паузе мотор выключен, поэтому
            кнопки недоступны: сначала нужно продолжить поездку. */}
        <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="ride-steer">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium">Управление самокатом</span>
            <span className="text-xs text-muted-foreground">20 м за нажатие</span>
          </div>
          <div className="grid w-32 grid-cols-3 justify-items-center gap-1 self-center">
            <span aria-hidden />
            <SteerButton label="Сдвинуть самокат на север" disabled={busy || paused} onClick={() => onSteer('north')}>
              <ArrowUp className="size-4" aria-hidden />
            </SteerButton>
            <span aria-hidden />
            <SteerButton label="Сдвинуть самокат на запад" disabled={busy || paused} onClick={() => onSteer('west')}>
              <ArrowLeft className="size-4" aria-hidden />
            </SteerButton>
            <span aria-hidden />
            <SteerButton label="Сдвинуть самокат на восток" disabled={busy || paused} onClick={() => onSteer('east')}>
              <ArrowRight className="size-4" aria-hidden />
            </SteerButton>
            <span aria-hidden />
            <SteerButton label="Сдвинуть самокат на юг" disabled={busy || paused} onClick={() => onSteer('south')}>
              <ArrowDown className="size-4" aria-hidden />
            </SteerButton>
            <span aria-hidden />
          </div>
          <p className="text-xs text-muted-foreground">
            {paused
              ? 'На паузе мотор выключен — сначала продолжите поездку.'
              : 'Нужно, чтобы проверить границу зоны: выехать за неё и вернуться.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
