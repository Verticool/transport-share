import type { Scooter, ScooterStatus } from '@sharing/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

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
/** Колонки, по которым сортируется список. */
type SortKey = 'status' | 'battery' | 'distance';

interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

/** Порядок по умолчанию — по доступности: свободные, забронированные, в поездке, недоступные. */
const DEFAULT_SORT: SortState = { key: 'status', direction: 'asc' };

/** Заголовок колонки: клик задаёт сортировку, повторный — переворачивает порядок. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Сортировать по «${label}»`}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      data-testid={`park-sort-${sortKey}`}
      className={cn(
        'flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground',
        align === 'right' && 'justify-end',
        active && 'font-medium text-foreground',
      )}
    >
      {label}
      {/* Стрелка показывает, куда смотрит порядок: без неё непонятно, активна ли колонка. */}
      {active && <span aria-hidden>{sort.direction === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

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
    const list = listRef.current;
    const row = list?.querySelector(`[data-scooter-id="${selectedId}"]`) ?? null;
    // Прокручивается именно колонка панелей: у списка своего скролла нет, иначе содержимое
    // вылезало за фон карточки (замер: список 1360 px при карточке 492 px).
    const container = list?.closest('[data-scroll-container]') ?? null;
    scrollRowIntoList(container, row);
  }, [selectedId]);

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  // Точка отсчёта одна и та же для всего парка — центр зоны обслуживания. Это НЕ «сколько проехал
  // самокат»: при движении к центру число уменьшается, от центра — растёт, и это ожидаемо для
  // удалённости. Раньше колонка была без подписи, и её читали как пройденный путь.
  const distances = useMemo(() => {
    const center = zoneCenter(SERVICE_ZONE);
    return new Map(scooters.map((scooter) => [scooter.id, scooterDistanceM(scooter, center)]));
  }, [scooters]);

  const visible = useMemo(() => {
    const rank = new Map(SCOOTER_STATUS_ORDER.map((status, index) => [status, index]));
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...scooters].sort((left, right) => {
      if (sort.key === 'battery') {
        return factor * (left.batteryPct - right.batteryPct);
      }
      if (sort.key === 'distance') {
        return factor * ((distances.get(left.id) ?? 0) - (distances.get(right.id) ?? 0));
      }
      // По доступности: внутри одной группы — по удалённости, чтобы порядок был предсказуемым.
      const byStatus = factor * ((rank.get(left.status) ?? 0) - (rank.get(right.status) ?? 0));
      return byStatus !== 0
        ? byStatus
        : (distances.get(left.id) ?? 0) - (distances.get(right.id) ?? 0);
    });
  }, [scooters, distances, sort]);

  /** Клик по колонке: та же колонка переворачивает порядок, новая — начинает с возрастания. */
  const toggleSort = (key: SortKey): void => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  };

  return (
    // Карточка растягивается по содержимому (без flex-1 и min-h-0): иначе она сжималась до высоты
    // колонки, а таблица выходила за её фон, и фон «отсекался».
    <Card className="flex flex-none flex-col">
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
            className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] items-center gap-2 px-2 text-xs text-muted-foreground"
            data-testid="park-list-header"
          >
            <SortHeader label="Самокат" sortKey="status" sort={sort} onSort={toggleSort} />
            <SortHeader label="Заряд" sortKey="battery" sort={sort} onSort={toggleSort} align="right" />
            <SortHeader label="До центра" sortKey="distance" sort={sort} onSort={toggleSort} align="right" />
          </div>
        )}

        {error === null && (
          <ul
            ref={listRef}
            /*
             * Прокрутка одна на всех размерах — у колонки панелей. Список растёт по содержимому
             * и никогда не обрезается своим overflow: именно из-за него таблица выходила за фон
             * карточки. Отрицательные отступы только на широком экране.
             */
            className="lg:-mx-1 lg:px-1"
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
                    'grid w-full grid-cols-[minmax(0,1fr)_3rem_5rem] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
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
