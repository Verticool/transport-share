import type { Scooter, ScooterStatus } from '@sharing/shared';
import { useEffect, useMemo, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatusBadge } from '../../components/ui/status-badge';
import { SERVICE_ZONE, zoneCenter } from '@sharing/shared';

import { scrollRowIntoList } from './park-list-scroll';
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
  // Список отсортирован по удалённости и прокручивается: выбранный самокат мог оказаться за
  // пределами вида, и тогда непонятно, что именно открыто в панели. Подводим список к выбору.
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    scrollRowIntoList(listRef.current, listRef.current?.querySelector(`[data-scooter-id="${selectedId}"]`) ?? null);
  }, [selectedId]);

  // Точка отсчёта одна и та же для всего парка — центр зоны обслуживания. Это НЕ «сколько проехал
  // самокат»: при движении к центру число уменьшается, от центра — растёт, и это ожидаемо для
  // удалённости. Раньше колонка была без подписи, и её читали как пройденный путь.
  const distances = useMemo(() => {
    const center = zoneCenter(SERVICE_ZONE);
    return new Map(scooters.map((scooter) => [scooter.id, scooterDistanceM(scooter, center)]));
  }, [scooters]);

  const visible = useMemo(
    () => [...scooters].sort((left, right) => (distances.get(left.id) ?? 0) - (distances.get(right.id) ?? 0)),
    [scooters, distances],
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
        <p className="text-[11px] leading-snug text-muted-foreground" data-testid="park-visibility-note">
          Парк показан целиком, в том числе в поездке, — это стенд для проверки. В рабочем
          приложении во время поездки видны только ваш самокат и зона.
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

        {/* Шапка колонок той же сеткой, что и строки: иначе числа не совпадают с подписями.
            Подпись колонки важна: это удалённость от центра зоны, а не путь поездки. */}
        {error === null && visible.length > 0 && (
          <div
            className="grid grid-cols-[minmax(0,1fr)_2.5rem_4.5rem] items-center gap-2 px-2 text-xs text-muted-foreground"
            data-testid="park-list-header"
          >
            <span className="font-medium">Самокат</span>
            <span className="text-right">Заряд</span>
            <span className="whitespace-nowrap text-right">До центра</span>
          </div>
        )}

        {error === null && (
          <ul
            ref={listRef}
            // min-h-32: список не сжимается в ноль, когда панель (бронь или поездка) разрастается.
            // Иначе строки уезжают за пределы вида, и клик по ним невозможен (проверено e2e).
            className="-mx-1 min-h-32 flex-1 overflow-y-auto px-1"
            aria-label="Самокаты: удалённость от центра зоны обслуживания"
            data-testid="park-list"
          >
            {visible.map((scooter) => (
              <li key={scooter.id}>
                <button
                  type="button"
                  data-scooter-id={scooter.id}
                  onClick={() => onSelect(scooter.id)}
                  aria-current={scooter.id === selectedId}
                  className={cn(
                    'grid w-full grid-cols-[minmax(0,1fr)_2.5rem_4.5rem] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                    scooter.id === selectedId && 'bg-accent',
                  )}
                >
                  {/* Код и состояние делят первую колонку: состояние усекается, а не выдавливает
                      числа за край строки. */}
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Код не переносится: «SC-040» в две строки ломало ровные строки таблицы. */}
                    <span className="whitespace-nowrap font-medium">{scooter.code}</span>
                    <StatusBadge status={scooter.status} className="min-w-0 truncate" />
                  </span>
                  <span className="tabular text-right text-xs text-muted-foreground">
                    {formatPercent(scooter.batteryPct)}
                  </span>
                  <span className="tabular text-right text-xs text-muted-foreground">
                    {formatDistance(distances.get(scooter.id) ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Когда фильтр не полный, список — это не весь парк: без этой строки кажется, что
            самокаты пропали (именно так и читается «не отображается SC-010 и SC-013»). */}
        {error === null && !loading && visible.length !== allScooters.length && (
          <p className="text-xs text-muted-foreground" data-testid="park-shown-count">
            {`Показано ${visible.length} из ${allScooters.length} — остальные скрыты фильтром состояний`}
          </p>
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
