import { ScooterStatusSchema, haversineM, type LatLng, type Scooter, type ScooterStatus } from '@sharing/shared';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import Circle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import type { StyleFunction } from 'ol/style/Style';
import { z } from 'zod';

import { SCOOTER_STATUS_ORDER } from '../../config/scooter-status';
import { readStatusColors } from '../theme-colors';

/** Порядок слоёв: маркеры парка всегда выше зоны обслуживания. */
export const PARK_LAYER_Z_INDEX = 20;

/** Радиус маркера в пикселях — подобран так, чтобы точки не сливались в центре города. */
const MARKER_RADIUS = 7;

/** Идентификатор самоката в свойствах объекта карты. */
export const SCOOTER_ID_PROPERTY = 'scooterId';

/**
 * Координаты самоката в виде, которым пользуются расчёты (`LatLng`): в доменной модели
 * широта и долгота лежат двумя полями, и собирать объект в каждом месте — приглашение перепутать оси.
 */
export function scooterLatLng(scooter: Scooter): LatLng {
  return { lat: scooter.lat, lng: scooter.lng };
}

/** Расстояние от точки отсчёта до самоката, метры. */
export function scooterDistanceM(scooter: Scooter, from: LatLng): number {
  return haversineM(scooterLatLng(scooter), from);
}

/**
 * Объект карты для самоката: положение берётся из данных парка (в проде — от GPS-симулятора).
 * Идентификатор и статус кладём в свойства: попап и стиль читают их без повторного поиска в массиве.
 */
export function scooterFeature(scooter: Scooter): Feature<Point> {
  const feature = new Feature<Point>({
    geometry: new Point(fromLonLat([scooter.lng, scooter.lat])),
  });
  feature.setId(scooter.id);
  feature.set(SCOOTER_ID_PROPERTY, scooter.id);
  feature.set('status', scooter.status);
  feature.set('code', scooter.code);
  feature.set('batteryPct', scooter.batteryPct);
  return feature;
}

/**
 * Идентификатор самоката из свойств объекта карты.
 *
 * Свойства объекта — такие же внешние данные, как ответ сервера, поэтому значение проверяется
 * схемой: клик по объекту не должен превращаться в исключение из-за неожиданного типа.
 */
export function readScooterId(feature: FeatureLike): string | null {
  const parsed = z.string().min(1).safeParse(feature.get(SCOOTER_ID_PROPERTY));
  return parsed.success ? parsed.data : null;
}

/**
 * Стиль маркеров: цвет — из токенов темы (тот же источник, что у бейджей в интерфейсе).
 *
 * Стиль зависит от статуса конкретного объекта, поэтому отдаётся функцией: OpenLayers вызовет
 * её при отрисовке, а цвета кэшируются — иначе на 40 самокатах создавались бы сотни объектов
 * стиля на каждый кадр.
 */
export function createMarkerStyle(theme: 'light' | 'dark', selectedId?: string | null): StyleFunction {
  const colors = readStatusColors();
  const outline = theme === 'dark' ? 'oklch(0.23 0.018 260)' : 'oklch(1 0 0)';
  // Выбранный самокат отмечается кольцом цвета текста: точка на карте должна отвечать на выбор
  // так же заметно, как строка в списке (иначе непонятно, что именно открыто в панели).
  const selectionColor = theme === 'dark' ? 'oklch(0.97 0.005 260)' : 'oklch(0.21 0.02 260)';
  const cache = new Map<ScooterStatus, Style>();
  const selectedCache = new Map<ScooterStatus, Style>();

  const styleFor = (status: ScooterStatus): Style => {
    const cached = cache.get(status);
    if (cached !== undefined) {
      return cached;
    }
    const style = new Style({
      image: new Circle({
        radius: MARKER_RADIUS,
        fill: new Fill({ color: colors[status] }),
        stroke: new Stroke({ color: outline, width: 2 }),
      }),
    });
    cache.set(status, style);
    return style;
  };

  const selectedStyleFor = (status: ScooterStatus): Style => {
    const cached = selectedCache.get(status);
    if (cached !== undefined) {
      return cached;
    }
    const style = new Style({
      image: new Circle({
        radius: MARKER_RADIUS + 3,
        fill: new Fill({ color: colors[status] }),
        stroke: new Stroke({ color: selectionColor, width: 3 }),
      }),
    });
    selectedCache.set(status, style);
    return style;
  };

  return (feature: FeatureLike) => {
    const parsed = ScooterStatusSchema.safeParse(feature.get('status'));
    // Незнакомый статус нельзя показать как «свободен»: на карте он выглядит недоступным.
    const status = parsed.success ? parsed.data : 'unavailable';
    return selectedId != null && readScooterId(feature) === selectedId
      ? selectedStyleFor(status)
      : styleFor(status);
  };
}

/** Слой парка: по одному объекту на самокат, стиль — цвет статуса из темы. */
export function createParkLayer(scooters: Scooter[], theme: 'light' | 'dark'): VectorLayer<VectorSource<Feature<Point>>> {
  const source = new VectorSource<Feature<Point>>({
    features: scooters.map((scooter) => scooterFeature(scooter)),
  });
  return new VectorLayer({
    source,
    style: createMarkerStyle(theme),
    zIndex: PARK_LAYER_Z_INDEX,
  });
}

/**
 * Победитель клика по карте: ближайший к точке клика маркер.
 *
 * OpenLayers обходит объекты в порядке слоя и отдаёт первый попавшийся в радиусе попадания. При
 * близко стоящих самокатах это мог быть не тот, по которому щёлкнули: пользователь видел в панели
 * соседний самокат. Поэтому из всех кандидатов берём ближайший по экранному расстоянию.
 */
export function nearestScooterId(
  candidates: { id: string; pixel: number[] }[],
  point: number[],
): string | null {
  const [px, py] = point;
  if (px === undefined || py === undefined) {
    return null;
  }
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const [cx, cy] = candidate.pixel;
    if (cx === undefined || cy === undefined) {
      continue;
    }
    const distance = Math.hypot(cx - px, cy - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = candidate.id;
    }
  }
  return bestId;
}

/** Сколько самокатов каждого статуса в наборе — для легенды и счётчика парка. */
export function countByStatus(scooters: Scooter[]): Record<ScooterStatus, number> {
  const counts: Record<ScooterStatus, number> = {
    free: 0,
    reserved: 0,
    in_ride: 0,
    unavailable: 0,
  };
  for (const scooter of scooters) {
    counts[scooter.status] += 1;
  }
  return counts;
}

/** Самокаты, доступные для брони, — то, что видит пользователь в списке «только свободные». */
export function freeScooters(scooters: Scooter[]): Scooter[] {
  return scooters.filter((scooter) => scooter.status === 'free');
}

/** Порядок статусов для легенды берётся из общего реестра, чтобы легенда и бейджи не расходились. */
export const LEGEND_ORDER: ScooterStatus[] = SCOOTER_STATUS_ORDER;
