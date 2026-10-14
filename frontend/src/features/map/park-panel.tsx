import type { Scooter, ScooterStatus } from '@sharing/shared';
import { useMemo } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatusBadge } from '../../components/ui/status-badge';
import { MAP_CENTER_LATLNG } from '../../config/map';
import {
  SCOOTER_STATUS_DOT_CLASS,
  SCOOTER_STATUS_INFO,
  SCOOTER_STATUS_ORDER,
} from '../../config/scooter-status';
import { formatDistance, formatPercent } from '../../lib/format';
import { countByStatus, scooterDistanceM } from '../../lib/map/scooter-layer';
import { cn } from '../../lib/utils';

export interface ParkPanelProps {
  /** Самокаты, прошедшие фильтр: ровно то же показывается на карте. */
  scooters: Scooter[];
  /** Весь парк — для сводки и счётчиков: фильтр не должен прятать общую картину. */
  allScooters: Scooter[];
  /** Включённые состояния: фильтр общий для карты и списка. */
  statusFilter: ScooterStatus[];
  onToggleStatus: (status: ScooterStatus) => void;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** Состояние приходит живым потоком: пользователь видит, что данные свежие. */
  live?: boolean;
  onSelect: (scooterId: string) => void;
  onReload: () => void;
}

/**
 * Панель парка: сводка по состояниям, фильтр и список самокатов по удалённости от центра.
 *
 * Сводка работает и как фильтр: нажатие на строку состояния убирает или возвращает эти самокаты —
 * и на карте, и в списке. Сортировка по расстоянию от центра — это то, что нужно человеку
 * («что ближе»), а не порядок из файла данных.
 */
export function ParkPanel({
  scooters,
  allScooters,
  statusFilter,
  onToggleStatus,
  loading,
  error,
  selectedId,
  live = false,
  onSelect,
  onReload,
}: ParkPanelProps) {
  const counts = useMemo(() => countByStatus(allScooters), [allScooters]);
  const allEnabled = statusFilter.length === SCOOTER_STATUS_ORDER.length;

  const visible = useMemo(
    () =>
      [...scooters].sort(
        (left, right) =>
          scooterDistanceM(left, MAP_CENTER_LATLNG) - scooterDistanceM(right, MAP_CENTER_LATLNG),
      ),
    [scooters],
  );

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
            : `${counts.free} свободны из ${allScooters.length} в зоне обслуживания`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Примечание о видимости точек: в учебном стенде парк показан целиком всегда — так
            удобнее проверять сценарии. В рабочем приложении во время поездки на карте остались бы
            только самокат клиента и зона обслуживания. */}
        <p className="text-xs text-muted-foreground" data-testid="park-visibility-note">
          Показаны все самокаты — и во время поездки тоже: так удобнее тестировать. В рабочем
          приложении во время поездки на карте видны только ваш самокат и зона обслуживания.
        </p>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Фильтр по состоянию">
          {SCOOTER_STATUS_ORDER.map((status) => {
            const enabled = statusFilter.includes(status);
            return (
              <li key={status}>
                <button
                  type="button"
                  aria-pressed={enabled}
                  aria-label={`${SCOOTER_STATUS_INFO[status].label}: ${counts[status]}`}
                  onClick={() => onToggleStatus(status)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent',
                    enabled ? 'text-foreground' : 'text-muted-foreground line-through',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 rounded-full',
                      SCOOTER_STATUS_DOT_CLASS[status],
                      !enabled && 'opacity-40',
                    )}
                  />
                  <span className="truncate">{SCOOTER_STATUS_INFO[status].label}</span>
                  <span className="tabular ml-auto">{counts[status]}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {!allEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              // Возвращаем весь парк: снимать фильтр по одному состоянию — лишняя работа.
              for (const status of SCOOTER_STATUS_ORDER) {
                if (!statusFilter.includes(status)) {
                  onToggleStatus(status);
                }
              }
            }}
          >
            Показать все состояния
          </Button>
        )}

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
          <p className="text-xs text-muted-foreground" data-testid="park-empty">
            {allScooters.length === 0
              ? 'Самокатов нет'
              : 'Под выбранные состояния ничего не попало — включите другое состояние в фильтре'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
