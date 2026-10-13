import { formatMinor } from '@sharing/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { formatDateTime, formatMinutes } from '../../lib/format';
import { RIDES_PAGE_SIZE, useRides } from '../account/use-account';

/** Причина завершения поездки — словами, а не техническим кодом. */
const END_REASON_LABEL: Record<string, string> = {
  user: 'Завершена вами',
  battery_depleted: 'Заряд закончился',
  service: 'Завершена сервисом',
};

/**
 * История поездок с постраничным просмотром.
 *
 * Пагинация серверная: экран запрашивает только свою страницу, а «всего» берёт из ответа —
 * иначе при росте истории пришлось бы тянуть её целиком.
 */
export function RidesPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useRides(page);

  const totalPages = Math.max(1, Math.ceil(data.total / RIDES_PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>Поездки</CardTitle>
          <CardDescription>
            {loading
              ? 'Загружаем историю…'
              : `Всего поездок: ${data.total} · страница ${page + 1} из ${totalPages}`}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {error !== null && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={reload}>
                Повторить
              </Button>
            </div>
          )}

          {error === null && (
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="rides-list">
              {data.items.map((ride) => {
                const minutes =
                  ride.finishedAt === null
                    ? 0
                    : Math.max(
                        1,
                        Math.round((Date.parse(ride.finishedAt) - Date.parse(ride.startedAt)) / 60_000),
                      );

                return (
                  <li
                    key={ride.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{formatDateTime(ride.startedAt)}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {formatMinutes(minutes)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ride.endReason === null ? 'Идёт' : (END_REASON_LABEL[ride.endReason] ?? ride.endReason)}
                    </span>
                    <span className="tabular ml-auto font-medium">
                      {ride.totalAmount === null
                        ? '—'
                        : formatMinor(ride.totalAmount, ride.currency === 'KGS' ? 'сом' : ride.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {error === null && !loading && data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Поездок пока нет</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPrev || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ChevronLeft aria-hidden />
              Назад
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasNext || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Вперёд
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
