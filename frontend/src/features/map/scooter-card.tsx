import type { Scooter } from '@sharing/shared';
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button';
import { LOW_BATTERY_THRESHOLD } from '@sharing/shared';

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
  /** Пользователь не вошёл: бронь принадлежит аккаунту, поэтому вместо кнопки — переход на вход. */
  needsAuth: boolean;
  /**
   * Почему бронь сейчас недоступна, если дело не в самом самокате: у пользователя уже идёт поездка
   * или есть бронь. Без этого человек видит серую кнопку и не понимает, что делать.
   */
  blockedBy?: { kind: 'ride' | 'booking'; scooterCode: string } | null;
  onBook: (scooterId: string) => void;
  onClose: () => void;
}

/**
 * Карточка выбранного самоката с действием.
 *
 * Кнопка «Забронировать» активна только для свободного самоката; для остальных показывается
 * причина, по которой бронь невозможна, — пользователю не нужно догадываться, почему кнопка серая.
 */
export function ScooterCard({
  scooter,
  busy,
  error,
  needsAuth,
  blockedBy = null,
  onBook,
  onClose,
}: ScooterCardProps) {
  const info = SCOOTER_STATUS_INFO[scooter.status];
  const bookable = scooter.status === 'free' && blockedBy === null;

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
        {/* Предупреждаем до брони: с таким зарядом поездка будет короткой, и человек вправе выбрать другой. */}
        {scooter.batteryPct < LOW_BATTERY_THRESHOLD && (
          <p
            className="break-words rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="scooter-low-battery"
            role="status"
          >
            {`Батарея почти пуста — заряд ${scooter.batteryPct} %: самокат отключится сам, поездка будет короткой.`}
          </p>
        )}
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

        {needsAuth ? (
          <Button asChild>
            <Link to="/login">Войти, чтобы забронировать</Link>
          </Button>
        ) : (
          <Button type="button" onClick={() => onBook(scooter.id)} disabled={!bookable || busy}>
            Забронировать
          </Button>
        )}

        {blockedBy !== null && (
          <p className="text-xs text-muted-foreground" data-testid="scooter-card-blocked">
            {blockedBy.kind === 'ride'
              ? `У вас идёт поездка на ${blockedBy.scooterCode}: завершите её, чтобы взять другой самокат — две поездки одновременно не поддерживаются.`
              : `У вас есть бронь на ${blockedBy.scooterCode}: начните поездку или снимите бронь — вторая бронь одновременно не поддерживается.`}
          </p>
        )}

        {blockedBy === null && !bookable && info.hint !== null && (
          <p className="text-xs text-muted-foreground">{info.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
