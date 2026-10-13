import { statusToken } from '../config/scooter-status';
import type { ScooterStatus } from '@sharing/shared';

/**
 * Читает цвета статусов из темы (CSS-переменные на :root / .dark).
 *
 * Канвас OpenLayers не умеет читать CSS-переменные, поэтому цвета приходится доставать
 * вычисленным стилем в момент создания или перерисовки слоя. Это единственное место,
 * где CSS-токены превращаются в значения для карты — второй источник цвета не заводим.
 */
export function readStatusColors(): Record<ScooterStatus, string> {
  const styles = getComputedStyle(document.documentElement);
  const read = (status: ScooterStatus): string => {
    const value = styles.getPropertyValue(statusToken(status)).trim();
    return value.length > 0 ? value : 'currentColor';
  };

  return {
    free: read('free'),
    reserved: read('reserved'),
    in_ride: read('in_ride'),
    unavailable: read('unavailable'),
  };
}
