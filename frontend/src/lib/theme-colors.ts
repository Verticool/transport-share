import { statusToken } from '../config/scooter-status';
import type { ScooterStatus } from '@sharing/shared';

/**
 * Превращает токены темы в значения, понятные канвасу карты.
 *
 * Канвас OpenLayers не умеет читать CSS-переменные, поэтому цвета приходится доставать
 * вычисленным стилем в момент создания или перерисовки слоя. Это единственное место,
 * где CSS-токены становятся значениями для карты — второй источник цвета не заводим.
 */
function readThemeValue(token: string, fallback = 'currentColor'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}

/**
 * Цвета статусов самоката из темы (`--status-*` в global.css).
 * Используются и маркерами парка, и легендой — значения всегда совпадают с интерфейсом.
 */
export function readStatusColors(): Record<ScooterStatus, string> {
  return {
    free: readThemeValue(statusToken('free')),
    reserved: readThemeValue(statusToken('reserved')),
    in_ride: readThemeValue(statusToken('in_ride')),
    unavailable: readThemeValue(statusToken('unavailable')),
  };
}

/** Цвета зоны обслуживания: контур и заливка (последняя — с прозрачностью из темы). */
export interface ZoneColors {
  stroke: string;
  fill: string;
}

export function readZoneColors(): ZoneColors {
  return {
    stroke: readThemeValue('--zone-stroke'),
    fill: readThemeValue('--zone-fill'),
  };
}
