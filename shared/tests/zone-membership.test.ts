import { describe, expect, it } from 'vitest';

import { SERVICE_ZONE } from '../src/constants.ts';
import { isInsideZone } from '../src/zone.ts';

/**
 * Регрессия на определение «внутри зоны».
 *
 * Почему отдельный файл: реализация `isInsideZone` уже один раз содержала ошибку — в формуле
 * пересечения параметр вдоль ребра считался от одной вершины, а свободный член от другой.
 * Из-за этого точки за границей (до ширины ребра) считались внутренними, то есть правило
 * «завершить поездку вне зоны нельзя» не срабатывало, и генератор мок-данных ставил самокаты
 * за пределами полигона. На глаз такое не видно, поэтому здесь сравнение с независимой
 * реализацией (классический PNPOLY) на сетке точек, а не несколько «удобных» примеров.
 */
function pnpoly(point: { lat: number; lng: number }, ring: readonly (readonly number[])[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const current = ring[i];
    const previous = ring[j];
    if (current === undefined || previous === undefined) {
      throw new Error('в полигоне зоны есть пропущенная вершина');
    }
    const [yi, xi] = current;
    const [yj, xj] = previous;
    if (yi === undefined || xi === undefined || yj === undefined || xj === undefined) {
      throw new Error('вершина полигона должна содержать две координаты');
    }
    if ((yi > point.lat) !== (yj > point.lat) && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

describe('isInsideZone', () => {
  it('центр города внутри зоны', () => {
    expect(isInsideZone({ lat: 42.8746, lng: 74.5698 }, SERVICE_ZONE)).toBe(true);
  });

  it('точка на границе считается внутри', () => {
    const first = SERVICE_ZONE.polygon[0];
    if (first === undefined) {
      throw new Error('у зоны нет вершин');
    }
    expect(isInsideZone({ lat: first[0], lng: first[1] }, SERVICE_ZONE)).toBe(true);
  });

  it('точки, которые раньше ошибочно считались внутренними, теперь снаружи', () => {
    // Координаты из набора мок-данных: при прежней формуле они попадали «внутрь» зоны.
    const known = [
      { lat: 42.89635488328152, lng: 74.54345089455369, code: 'SC-007' },
      { lat: 42.894337445269336, lng: 74.52812836332713, code: 'SC-010' },
      { lat: 42.888919862586775, lng: 74.52661812884035, code: 'SC-017' },
      { lat: 42.83309487909288, lng: 74.62583887748653, code: 'SC-028' },
      { lat: 42.88349323230283, lng: 74.52835865928792, code: 'SC-038' },
    ];

    for (const point of known) {
      expect(isInsideZone(point, SERVICE_ZONE), `${point.code} должен быть вне зоны`).toBe(false);
    }
  });

  it('совпадает с независимой реализацией на сетке точек вокруг зоны', () => {
    const step = 0.004;
    let compared = 0;
    let mismatches = 0;

    for (let lat = 42.80; lat <= 42.92; lat += step) {
      for (let lng = 74.50; lng <= 74.66; lng += step) {
        const point = { lat, lng };
        compared += 1;

        const ours = isInsideZone(point, SERVICE_ZONE);
        // Границы полигона: там расхождение допустимо (наша функция считает границу внутренней),
        // поэтому точки ровно на ребре из сравнения исключаем.
        const onBoundary = SERVICE_ZONE.polygon.some((_, index) => {
          const a = SERVICE_ZONE.polygon[index];
          const b = SERVICE_ZONE.polygon[(index + 1) % SERVICE_ZONE.polygon.length];
          if (a === undefined || b === undefined) {
            return false;
          }
          const cross = (lng - a[1]) * (b[0] - a[0]) - (lat - a[0]) * (b[1] - a[1]);
          return Math.abs(cross) < 1e-9;
        });
        if (onBoundary) {
          continue;
        }

        if (ours !== pnpoly(point, SERVICE_ZONE.polygon)) {
          mismatches += 1;
        }
      }
    }

    expect(compared).toBeGreaterThan(500);
    expect(mismatches).toBe(0);
  });
});
