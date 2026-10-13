import type { ServiceZone } from '@sharing/shared';
import { SERVICE_ZONE } from '@sharing/shared';

import type { Theme } from '../lib/theme';

/** Схемы интерфейса, для которых есть своя подложка карты. */
export type BasemapId = Theme;

/**
 * Реестр подложек карты: смена провайдера — одна строка здесь, а не правка компонента.
 *
 * ArcGIS Light Gray Canvas выбран как единственный keyless-вариант с реальными тайлами
 * (проверено: не заглушка «API key required», размер тайла > 4 КБ). Порядок осей у ArcGIS — {z}/{y}/{x}.
 */
export interface Basemap {
  id: BasemapId;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

const LIGHT_BASEMAP: Basemap = {
  id: 'light',
  label: 'Светлая',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ',
  maxZoom: 16,
};

const DARK_BASEMAP: Basemap = {
  id: 'dark',
  label: 'Тёмная',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ',
  maxZoom: 16,
};

export const BASEMAPS: Basemap[] = [LIGHT_BASEMAP, DARK_BASEMAP];

/** Подложка по умолчанию — отдельная константа, а не `BASEMAPS[0]`: так карта не зависит от порядка в реестре. */
export const DEFAULT_BASEMAP: Basemap = LIGHT_BASEMAP;

/**
 * Подложка под схему интерфейса.
 *
 * Светлые тайлы под тёмной темой выглядят как чужеродное пятно, поэтому у карты две подложки:
 * светлая серая и тёмная серая — обе отдаются ArcGIS без ключа (проверено: реальные тайлы, не заглушки).
 */
export function basemapFor(theme: Theme): Basemap {
  return theme === 'dark' ? DARK_BASEMAP : LIGHT_BASEMAP;
}

/** Центр и стартовый зум карты: центр Бишкека, зона обслуживания видна целиком. */
export const MAP_CENTER: [number, number] = [74.5698, 42.8746];
export const MAP_ZOOM = 13;

/** Зона обслуживания для отрисовки: тот же объект, что используется расчётами. */
export const ZONE: ServiceZone = SERVICE_ZONE;
