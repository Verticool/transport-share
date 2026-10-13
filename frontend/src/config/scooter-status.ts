import type { ScooterStatus } from '@sharing/shared';

/**
 * Подписи статусов самоката (docs/BRAND.md).
 *
 * Цвета здесь НЕ хранятся: источник цветов — токены темы в global.css
 * (`--status-free`, `--status-reserved`, `--status-in-ride`, `--status-unavailable`).
 * Иначе тема и карта разъедутся: интерфейс берёт цвет Tailwind-классами
 * (`bg-status-free`, `text-status-in-ride`), канвас карты — через `readStatusColors()`.
 */
export interface ScooterStatusInfo {
  /** Подпись в интерфейсе. */
  label: string;
  /** Причина недоступности для карточки; null — причина не нужна. */
  hint: string | null;
}

export const SCOOTER_STATUS_INFO: Record<ScooterStatus, ScooterStatusInfo> = {
  free: { label: 'Свободен', hint: null },
  reserved: { label: 'Забронирован', hint: 'Самокат держат за другим пользователем' },
  in_ride: { label: 'В поездке', hint: 'На самокате едут' },
  unavailable: { label: 'Недоступен', hint: 'Низкий заряд или обслуживание' },
};

/** Порядок отображения в легенде: от доступного к недоступному. */
export const SCOOTER_STATUS_ORDER: ScooterStatus[] = ['free', 'reserved', 'in_ride', 'unavailable'];

/** Имя CSS-переменной статуса — единственное место, где оно строится (in_ride → in-ride). */
export function statusToken(status: ScooterStatus): string {
  return `--status-${status.replace('_', '-')}`;
}

/**
 * Классы бейджа по статусу.
 *
 * Строки статические и лежат целиком в исходнике: Tailwind собирает классы сканированием
 * файлов, поэтому склеенное из шаблона имя (`text-status-${status}`) он не найдёт и цвет
 * молча пропадёт. Один список — один источник.
 */
export const SCOOTER_STATUS_BADGE_CLASS: Record<ScooterStatus, string> = {
  free: 'bg-status-free/15 text-status-free border-status-free/30',
  reserved: 'bg-status-reserved/15 text-status-reserved border-status-reserved/30',
  in_ride: 'bg-status-in-ride/15 text-status-in-ride border-status-in-ride/30',
  unavailable: 'bg-status-unavailable/15 text-status-unavailable border-status-unavailable/30',
};

/** Класс точки-индикатора того же цвета (кружок внутри бейджа). */
export const SCOOTER_STATUS_DOT_CLASS: Record<ScooterStatus, string> = {
  free: 'bg-status-free',
  reserved: 'bg-status-reserved',
  in_ride: 'bg-status-in-ride',
  unavailable: 'bg-status-unavailable',
};
