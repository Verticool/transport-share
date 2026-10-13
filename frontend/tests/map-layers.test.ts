import { mustGet } from '@sharing/shared/testing/factories';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat, toLonLat } from 'ol/proj';
import TileImage from 'ol/source/TileImage';
import TileLayer from 'ol/layer/Tile';
import Style from 'ol/style/Style';
import { describe, expect, it } from 'vitest';

import { basemapFor, BASEMAPS, DEFAULT_BASEMAP, MAP_CENTER, MAP_ZOOM, ZONE } from '../src/config/map';
import { createMapView, createParkMap } from '../src/lib/map/create-map';
import {
  createBasemapLayer,
  createZoneLayer,
  zoneExtent,
  zoneFeature,
  ZONE_LAYER_Z_INDEX,
} from '../src/lib/map/layers';

/**
 * Геометрия проверяется через обратное преобразование (`toLonLat`), а не по «похожим» числам:
 * так тест ловит перепутанный порядок осей — самую незаметную ошибку в картах.
 * Доступ к элементам — через `mustGet`, чтобы не заводить запрещённые `!` и `as`.
 */
function ringOf(zone: typeof ZONE): number[][] {
  const geometry = zoneFeature(zone).getGeometry();
  if (!(geometry instanceof Polygon)) {
    throw new Error('зона должна превращаться в полигон');
  }
  return geometry.getCoordinates()[0] ?? [];
}

describe('слой зоны обслуживания', () => {
  it('зона превращается в один полигон', () => {
    expect(zoneFeature(ZONE).getGeometry()).toBeInstanceOf(Polygon);
  });

  it('кольцо замкнуто: первая точка совпадает с последней', () => {
    const ring = ringOf(ZONE);
    expect(mustGet(ring, 0)).toEqual(mustGet(ring, ring.length - 1));
  });

  it('вершин на одну больше, чем точек в зоне', () => {
    expect(ringOf(ZONE)).toHaveLength(ZONE.polygon.length + 1);
  });

  it('координаты переведены в EPSG:3857 без путаницы широты и долготы', () => {
    const [x, y] = toLonLat(mustGet(ringOf(ZONE), 0));
    const [zoneLat, zoneLng] = mustGet(ZONE.polygon, 0);
    expect(y).toBeCloseTo(zoneLat, 6);
    expect(x).toBeCloseTo(zoneLng, 6);
  });

  it('повторный вызов не портит исходную зону', () => {
    const before = ZONE.polygon.map((point) => [...point]);
    zoneFeature(ZONE);
    zoneFeature(ZONE);
    expect(ZONE.polygon).toEqual(before);
  });

  it('слой содержит одну фичу и лежит выше подложки (zIndex 10)', () => {
    const layer = createZoneLayer(ZONE);
    expect(layer.getSource()?.getFeatures()).toHaveLength(1);
    expect(layer.getZIndex()).toBe(ZONE_LAYER_Z_INDEX);
  });

  it('габариты зоны содержат все её точки — по ним подгоняется вид', () => {
    const extent = zoneExtent(ZONE);
    const [minX, minY, maxX, maxY] = [
      mustGet(extent, 0),
      mustGet(extent, 1),
      mustGet(extent, 2),
      mustGet(extent, 3),
    ];
    for (const [lat, lng] of ZONE.polygon) {
      const [x, y] = fromLonLat([lng, lat]);
      expect(x).toBeGreaterThanOrEqual(minX);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(minY);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });

  it('цвета заливки и контура берутся из токенов темы', () => {
    document.documentElement.style.setProperty('--zone-stroke', '#123456');
    document.documentElement.style.setProperty('--zone-fill', '#654321');

    const style = createZoneLayer(ZONE).getStyle();
    expect(style).toBeInstanceOf(Style);
    if (!(style instanceof Style)) {
      return;
    }
    expect(style.getFill()?.getColor()).toBe('#654321');
    expect(style.getStroke()?.getColor()).toBe('#123456');
  });
});

describe('подложка карты', () => {
  it('без аргумента берётся светлая подложка по умолчанию', () => {
    const source = createBasemapLayer().getSource();
    expect(source).toBeInstanceOf(TileImage);
    if (!(source instanceof TileImage)) {
      return;
    }
    expect(source.getUrls()).toEqual([DEFAULT_BASEMAP.url]);
  });

  it('для тёмной схемы берётся тёмная подложка, а не инверсия светлой', () => {
    expect(basemapFor('dark').url).toContain('World_Dark_Gray_Base');
    expect(basemapFor('light').url).toContain('World_Light_Gray_Base');
    expect(basemapFor('dark').url).not.toBe(basemapFor('light').url);
  });

  it('карта, собранная под тёмную схему, ставит подложку ниже зоны и тёмный источник', () => {
    const target = document.createElement('div');
    const map = createParkMap(target, 'dark');

    const basemapLayer = map.getLayers().item(0);
    expect(basemapLayer).toBeInstanceOf(TileLayer);
    expect(basemapLayer?.getZIndex() ?? 0).toBeLessThan(ZONE_LAYER_Z_INDEX);

    const source = createBasemapLayer(basemapFor('dark')).getSource();
    expect(source).toBeInstanceOf(TileImage);
    if (source instanceof TileImage) {
      expect(source.getUrls()?.[0]).toBe(basemapFor('dark').url);
    }

    map.setTarget(undefined);
  });
});

describe('представление и сборка карты', () => {
  it('центр, зум и границы зума соответствуют конфигу', () => {
    const view = createMapView();
    expect(view.getCenter()).toEqual(fromLonLat(MAP_CENTER));
    expect(view.getZoom()).toBe(MAP_ZOOM);
    expect(view.getMinZoom()).toBe(10);
    expect(view.getMaxZoom()).toBe(BASEMAPS[0]?.maxZoom);
  });

  it('карта собирается из двух слоёв: подложка и зона', () => {
    const target = document.createElement('div');
    const map = createParkMap(target);
    expect(map.getLayers().getLength()).toBe(2);
    expect(map.getView().getZoom()).toBe(MAP_ZOOM);
    map.setTarget(undefined);
  });

  it('штатные контролы OpenLayers отключены — их заменяют свои кнопки на токенах темы', () => {
    const target = document.createElement('div');
    const map = createParkMap(target);
    expect(map.getControls().getLength()).toBe(0);
    map.setTarget(undefined);
  });
});
