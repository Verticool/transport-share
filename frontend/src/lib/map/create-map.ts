import Map from 'ol/Map';
import View from 'ol/View';
import { fromLonLat } from 'ol/proj';
import { basemapFor, DEFAULT_BASEMAP, MAP_CENTER, MAP_ZOOM, ZONE } from '../../config/map';
import type { Theme } from '../../lib/theme';
import { createBasemapLayer, createZoneLayer } from './layers';

/** Представление карты: центр Бишкека из MAP_CENTER, зум MAP_ZOOM, ограничения зума по подложке. */
export function createMapView(): View {
  return new View({
    center: fromLonLat(MAP_CENTER),
    zoom: MAP_ZOOM,
    minZoom: 10,
    maxZoom: DEFAULT_BASEMAP.maxZoom,
  });
}

/** Карта без React: слои в порядке «подложка → зона», привязка к элементу. */
export function createParkMap(target: HTMLElement, theme: Theme = 'light'): Map {
  const basemap = createBasemapLayer(basemapFor(theme));
  const zone = createZoneLayer(ZONE);
  return new Map({
    target,
    layers: [basemap, zone],
    view: createMapView(),
    // Штатные контролы OpenLayers не подключаем: кнопки зума и подпись источника —
    // свои компоненты на токенах темы, а не стили сторонней библиотеки.
    controls: [],
  });
}
