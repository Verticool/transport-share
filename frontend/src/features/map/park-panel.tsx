import type { Scooter } from '@sharing/shared';
import { useMemo, useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { MAP_CENTER_LATLNG } from '../../config/map';
import { SCOOTER_STATUS_INFO, SCOOTER_STATUS_ORDER, SCOOTER_STATUS_DOT_CLASS } from '../../config/scooter-status';
import { formatDistance, formatPercent } from '../../lib/format';
import { countByStatus, freeScooters, scooterDistanceM } from '../../lib/map/scooter-layer';
import { StatusBadge } from '../../components/ui/status-badge';
import { cn } from '../../lib/utils';

export interface ParkPanelProps {
  scooters: Scooter[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** Состояние приходит живым потоком: пользователь видит, что данные свежие. */
  live?: boolean;
  onSelect: (scooterId: string) => void;
  onReload: () => void;
}

/**
 * Панель парка: сводка по статусам, фильтр и список самокатов по удалённости от центра.
 *
 * Сортировка по расстоянию от центра — это то, что нужно пользователю («что ближе»), а не порядок
 * из файла данных: сервер коды не сортирует осмысленно для человека.
 */
export function ParkPanel({
  scooters,
  loading,
  error,
  selectedId,
  live = false,
  onSelect,
  onReload,
}: ParkPanelProps) {
  const [onlyFree, setOnlyFree] = useState(false);

  const counts = useMemo(() => countByStatus(scooters), [scooters]);
  const visible = useMemo(() => {
    const list = onlyFree ? freeScooters(scooters) : scooters;
    return [...list].sort(
      (left, right) =>
        scooterDistanceM(left, MAP_CENTER_LATLNG) - scooterDistanceM(right, MAP_CENTER_LATLNG),
    );
  }, [scooters, onlyFree]);

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Парк
          {live && (
            <span
              className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"
              data-testid="live-indicator"
            >
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              в эфире
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {loading
            ? 'Загружаем самокаты…'
            : `${counts.free} свободны из ${scooters.length} в зоне обслуживания`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Состояние парка">
          {SCOOTER_STATUS_ORDER.map((status) => (
            <li key={status} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', SCOOTER_STATUS_DOT_CLASS[status])}
              />
              <span className="truncate">{SCOOTER_STATUS_INFO[status].label}</span>
              <span className="tabular ml-auto text-foreground">{counts[status]}</span>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant={onlyFree ? 'default' : 'outline'}
          size="sm"
          aria-pressed={onlyFree}
          onClick={() => setOnlyFree((value) => !value)}
        >
          Только свободные
        </Button>

        {error !== null && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onReload}>
              Повторить
            </Button>
          </div>
        )}

        {error === null && (
          <ul
            className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
            aria-label="Самокаты поблизости"
            data-testid="park-list"
          >
            {visible.map((scooter) => (
              <li key={scooter.id}>
                <button
                  type="button"
                  onClick={() => onSelect(scooter.id)}
                  aria-current={scooter.id === selectedId}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                    scooter.id === selectedId && 'bg-accent',
                  )}
                >
                  <span className="font-medium">{scooter.code}</span>
                  <StatusBadge status={scooter.status} />
                  <span className="tabular ml-auto text-xs text-muted-foreground">
                    {formatPercent(scooter.batteryPct)}
                  </span>
                  <span className="tabular w-14 text-right text-xs text-muted-foreground">
                    {formatDistance(scooterDistanceM(scooter, MAP_CENTER_LATLNG))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error === null && visible.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground">Подходящих самокатов нет</p>
        )}
      </CardContent>
    </Card>
  );
}
