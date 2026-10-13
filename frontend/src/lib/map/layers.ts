import type { ServiceZone } from '@sharing/shared';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import TileImage from 'ol/source/TileImage';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { fromLonLat } from 'ol/proj';
import type TileSource from 'ol/source/Tile';
import type { Basemap } from '../../config/map';
import { DEFAULT_BASEMAP } from '../../config/map';
import { readZoneColors } from '../theme-colors';

/** Зона обслуживания: полигон WGS84, порядок точек против часовой стрелки. */
export function zoneFeature(zone: ServiceZone): Feature<Polygon> {
  // ZONE.polygon хранит точки в градусах [lat, lng], а OL работает в EPSG:3857
  // где порядок осей [долгота, широта]. fromLonLat выполняет это преобразование.
  const ring = zone.polygon.map(([lat, lng]) => fromLonLat([lng, lat]));
  const first = ring[0];
  if (first === undefined) {
    throw new Error('Zone must have at least one point');
  }
  ring.push(first);
  const polygon = new Polygon([ring]);
  return new Feature<Polygon>(polygon);
}

/** Слой зоны обслуживания: заливка и контур берутся из токенов темы. */
export function createZoneLayer(zone: ServiceZone): VectorLayer<VectorSource<Feature<Polygon>>> {
  const colors = readZoneColors();
  const style = new Style({
    fill: new Fill({ color: colors.fill }),
    stroke: new Stroke({ color: colors.stroke, width: 2 }),
  });
  const source = new VectorSource({
    features: [zoneFeature(zone)],
  });
  return new VectorLayer({
    source,
    style,
    zIndex: 10,
  });
}

/** Слой подложки из реестра BASEMAPS (по умолчанию — первый элемент реестра). */
export function createBasemapLayer(basemap?: Basemap): TileLayer<TileSource> {
  const chosen = basemap ?? DEFAULT_BASEMAP;
  const source = new TileImage({
    url: chosen.url,
  });
  return new TileLayer({
    source,
  });
}
