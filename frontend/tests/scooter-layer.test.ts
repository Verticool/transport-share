import { makeScooter } from '@sharing/shared/testing/factories';
import { beforeAll, describe, expect, it } from 'vitest';
import Point from 'ol/geom/Point';
import { toLonLat } from 'ol/proj';
import Circle from 'ol/style/Circle';

import {
  countByStatus,
  createMarkerStyle,
  createParkLayer,
  freeScooters,
  scooterFeature,
  SCOOTER_ID_PROPERTY,
} from '../src/lib/map/scooter-layer';

/** Цвет маркера берётся из темы, поэтому переменные подставляем до проверок стиля. */
beforeAll(() => {
  const root = document.documentElement;
  root.style.setProperty('--status-free', '#00ff00');
  root.style.setProperty('--status-reserved', '#0000ff');
  root.style.setProperty('--status-in-ride', '#ff8800');
  root.style.setProperty('--status-unavailable', '#888888');
});

describe('объект самоката на карте', () => {
  it('ставит точку в проекции карты по координатам самоката', () => {
    const scooter = makeScooter({ lat: 42.87, lng: 74.6 });
    const geometry = scooterFeature(scooter).getGeometry();

    expect(geometry).toBeInstanceOf(Point);
    if (geometry instanceof Point) {
      const [lng, lat] = toLonLat(geometry.getCoordinates());
      expect(lat).toBeCloseTo(42.87, 6);
      expect(lng).toBeCloseTo(74.6, 6);
    }
  });

  it('несёт идентификатор и статус в свойствах — попап и стиль читают их без поиска в массиве', () => {
    const scooter = makeScooter({ id: 'sct-42', code: 'DV-042', status: 'reserved', batteryPct: 63 });
    const feature = scooterFeature(scooter);

    expect(feature.getId()).toBe('sct-42');
    expect(feature.get(SCOOTER_ID_PROPERTY)).toBe('sct-42');
    expect(feature.get('status')).toBe('reserved');
    expect(feature.get('batteryPct')).toBe(63);
  });
});

describe('слой парка', () => {
  it('создаёт по объекту на каждый самокат', () => {
    const scooters = [
      makeScooter({ id: 'a', code: 'DV-001' }),
      makeScooter({ id: 'b', code: 'DV-002' }),
      makeScooter({ id: 'c', code: 'DV-003' }),
    ];

    const layer = createParkLayer(scooters, 'light');
    expect(layer.getSource()?.getFeatures()).toHaveLength(3);
  });

  it('рисует маркеры выше зоны обслуживания', () => {
    expect(createParkLayer([], 'light').getZIndex()).toBe(20);
  });
});

describe('стиль маркеров', () => {
  /** Разбирает результат стиль-функции в цвет заливки маркера. */
  function fillOf(status: string, theme: 'light' | 'dark' = 'light'): unknown {
    const feature = scooterFeature(makeScooter());
    feature.set('status', status);
    // Второй аргумент стиль-функции — разрешение; цвет от него не зависит.
    const style = createMarkerStyle(theme)(feature, 1);
    if (Array.isArray(style) || style === undefined) {
      return null;
    }
    const image = style.getImage();
    return image instanceof Circle ? (image.getFill()?.getColor() ?? null) : null;
  }

  it('берёт цвет из токена темы для каждого статуса', () => {
    expect(['free', 'reserved', 'in_ride', 'unavailable'].map((status) => fillOf(status))).toEqual([
      '#00ff00',
      '#0000ff',
      '#ff8800',
      '#888888',
    ]);
  });

  it('незнакомый статус показывается как недоступный, а не как свободный', () => {
    expect(fillOf('что-то новое')).toBe('#888888');
  });
});

describe('сводка по парку', () => {
  const scooters = [
    makeScooter({ status: 'free' }),
    makeScooter({ status: 'free' }),
    makeScooter({ status: 'in_ride' }),
    makeScooter({ status: 'unavailable' }),
  ];

  it('считает самокаты по каждому статусу', () => {
    expect(countByStatus(scooters)).toEqual({ free: 2, reserved: 0, in_ride: 1, unavailable: 1 });
  });

  it('отдаёт только свободные для списка «только свободные»', () => {
    expect(freeScooters(scooters)).toHaveLength(2);
  });
});
