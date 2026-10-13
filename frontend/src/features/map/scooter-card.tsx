import type { Scooter } from '@sharing/shared';
import { X } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatusBadge } from '../../components/ui/status-badge';
import { MAP_CENTER_LATLNG } from '../../config/map';
import { SCOOTER_STATUS_INFO } from '../../config/scooter-status';
import { formatDistance, formatPercent } from '../../lib/format';
import { scooterDistanceM } from '../../lib/map/scooter-layer';

export interface ScooterCardProps {
  scooter: Scooter;
  /** Идёт запрос брони: кнопка занята. */
  busy: boolean;
  /** Текст ошибки, если бронь не удалась (например, самокат заняли первым). */
  error: string | null;
  onBook: (scooterId: string) => void;
  onClose: () => void;
}

/**
 * Карточка выбранного самоката с действием.
 *
 * Кнопка «Забронировать» активна только для свободного самоката; для остальных показывается
 * причина, по которой бронь невозможна, — пользователю не нужно догадываться, почему кнопка серая.
 */
export function ScooterCard({ scooter, busy, error, onBook, onClose }: ScooterCardProps) {
  const info = SCOOTER_STATUS_INFO[scooter.status];
  const bookable = scooter.status === 'free';

  return (
    <Card data-testid="scooter-card">
      <CardHeader className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-7"
          aria-label="Закрыть карточку самоката"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
        <CardTitle>Самокат {scooter.code}</CardTitle>
        <CardDescription>{scooter.model}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={scooter.status} />
          <span className="tabular ml-auto text-xs text-muted-foreground">
            {formatPercent(scooter.batteryPct)}
          </span>
          <span className="tabular text-xs text-muted-foreground">
            {formatDistance(scooterDistanceM(scooter, MAP_CENTER_LATLNG))}
          </span>
        </div>

        {error !== null && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="button" onClick={() => onBook(scooter.id)} disabled={!bookable || busy}>
          Забронировать
        </Button>

        {!bookable && info.hint !== null && (
          <p className="text-xs text-muted-foreground">{info.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
