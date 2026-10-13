import type { LatLng, ServiceZone } from './domain.ts';

export const EARTH_RADIUS_M = 6371008.8;

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

function toDeg(rad: number): number {
  return rad * 180 / Math.PI;
}

/**
 * Точка полигона по индексу.
 * Полигон приходит из валидированной зоны (схема гарантирует минимум 3 точки), но `noUncheckedIndexedAccess`
 * требует явной обработки случая «индекса нет» — превращаем его в понятную ошибку вместо `polygon[i]!`.
 */
function at(polygon: [number, number][], index: number): [number, number] {
  const point = polygon[index];
  if (point === undefined) {
    throw new Error(`zone polygon: точки с индексом ${index} нет (длина полигона ${polygon.length})`);
  }
  return point;
}

/** Ребро полигона: от точки `index` к точке `(index + 1) % n`. */
function edge(polygon: [number, number][], index: number): { a: LatLng; b: LatLng } {
  const [aLat, aLng] = at(polygon, index);
  const [bLat, bLng] = at(polygon, (index + 1) % polygon.length);
  return { a: { lat: aLat, lng: aLng }, b: { lat: bLat, lng: bLng } };
}

/** Опорная точка локальной системы координат — первая точка полигона. */
function polygonOrigin(polygon: [number, number][]): LatLng {
  const [lat, lng] = at(polygon, 0);
  return { lat, lng };
}

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const aVal = sinDLat * sinDLat + sinDLng * sinDLng * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));

  return EARTH_RADIUS_M * c;
}

function isPointOnSegment(p: LatLng, segA: LatLng, segB: LatLng): boolean {
  const cross = (p.lng - segA.lng) * (segB.lat - segA.lat) - (p.lat - segA.lat) * (segB.lng - segA.lng);
  if (Math.abs(cross) > 1e-12) {
    return false;
  }
  const dot = (p.lng - segA.lng) * (p.lng - segB.lng) + (p.lat - segA.lat) * (p.lat - segB.lat);
  return dot <= 0;
}

export function isInsideZone(point: LatLng, zone: ServiceZone): boolean {
  const { polygon } = zone;
  const n = polygon.length;
  let inside = false;

  for (let i = 0; i < n; i++) {
    const { a: segA, b: segB } = edge(polygon, i);

    if (isPointOnSegment(point, segA, segB)) {
      return true;
    }

    const intersects = ((segA.lat > point.lat) !== (segB.lat > point.lat)) &&
      (point.lng < (segB.lng - segA.lng) * (point.lat - segB.lat) / (segB.lat - segA.lat) + segA.lng);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function toLocalMeters(lat: number, lng: number, ref: LatLng): { x: number; y: number } {
  const rad = Math.PI / 180;
  const refRadLat = ref.lat * rad;
  const refRadLng = ref.lng * rad;
  const latRad = lat * rad;
  const lngRad = lng * rad;

  const x = (lngRad - refRadLng) * Math.cos(refRadLat) * EARTH_RADIUS_M;
  const y = (latRad - refRadLat) * EARTH_RADIUS_M;

  return { x, y };
}

function fromLocalMeters(x: number, y: number, ref: LatLng): LatLng {
  const rad = Math.PI / 180;
  const refRadLat = ref.lat * rad;

  const lat = ref.lat + (y / EARTH_RADIUS_M) / rad;
  const lng = ref.lng + (x / (EARTH_RADIUS_M * Math.cos(refRadLat))) / rad;

  return { lat, lng };
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * dx;
  const projY = ay + t * dy;

  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { x: ax, y: ay };
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return { x: ax + t * dx, y: ay + t * dy };
}

export function distanceToZoneBoundaryM(point: LatLng, zone: ServiceZone): number {
  const { polygon } = zone;
  const ref = polygonOrigin(polygon);
  const p = toLocalMeters(point.lat, point.lng, ref);

  let minDist = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const { a, b } = edge(polygon, i);
    const localA = toLocalMeters(a.lat, a.lng, ref);
    const localB = toLocalMeters(b.lat, b.lng, ref);

    const dist = pointToSegmentDistance(p.x, p.y, localA.x, localA.y, localB.x, localB.y);
    minDist = Math.min(minDist, dist);
  }

  return minDist;
}

export function zoneBBox(zone: ServiceZone): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const { polygon } = zone;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const coord of polygon) {
    minLat = Math.min(minLat, coord[0]);
    maxLat = Math.max(maxLat, coord[0]);
    minLng = Math.min(minLng, coord[1]);
    maxLng = Math.max(maxLng, coord[1]);
  }

  return { minLat, minLng, maxLat, maxLng };
}

export function zoneCenter(zone: ServiceZone): LatLng {
  const { polygon } = zone;
  const n = polygon.length;

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const { a, b } = edge(polygon, i);
    const cross = a.lng * b.lat - b.lng * a.lat;
    area += cross;
    cx += (a.lng + b.lng) * cross;
    cy += (a.lat + b.lat) * cross;
  }

  area *= 0.5;
  cx /= 6 * area;
  cy /= 6 * area;

  return { lat: cy, lng: cx };
}

export function clampToZone(point: LatLng, zone: ServiceZone): LatLng {
  if (isInsideZone(point, zone)) {
    return point;
  }

  const { polygon } = zone;
  const ref = polygonOrigin(polygon);
  const p = toLocalMeters(point.lat, point.lng, ref);

  let minDist = Infinity;
  let closestEdgeIndex = 0;
  let closestLocal: { x: number; y: number } = { x: 0, y: 0 };

  for (let i = 0; i < polygon.length; i++) {
    const { a, b } = edge(polygon, i);
    const localA = toLocalMeters(a.lat, a.lng, ref);
    const localB = toLocalMeters(b.lat, b.lng, ref);

    const cp = closestPointOnSegment(p.x, p.y, localA.x, localA.y, localB.x, localB.y);
    const dist = Math.sqrt((p.x - cp.x) ** 2 + (p.y - cp.y) ** 2);

    if (dist < minDist) {
      minDist = dist;
      closestEdgeIndex = i;
      closestLocal = cp;
    }
  }

  const { a, b } = edge(polygon, closestEdgeIndex);
  const localA = toLocalMeters(a.lat, a.lng, ref);
  const localB = toLocalMeters(b.lat, b.lng, ref);

  const nx = -(localB.y - localA.y);
  const ny = localB.x - localA.x;
  const norm = Math.sqrt(nx * nx + ny * ny);

  // Вырожденное ребро (две точки совпали): нормали нет — возвращаем точку на границе как есть.
  if (norm === 0) {
    return fromLocalMeters(closestLocal.x, closestLocal.y, ref);
  }

  const offsetCandidate = (offset: number): LatLng | null => {
    for (const dir of [1, -1]) {
      const candidate = fromLocalMeters(
        closestLocal.x + (nx / norm) * offset * dir,
        closestLocal.y + (ny / norm) * offset * dir,
        ref,
      );
      if (isInsideZone(candidate, zone)) {
        return candidate;
      }
    }
    return null;
  };

  const fiveMetersInside = offsetCandidate(5);
  if (fiveMetersInside !== null) {
    return fiveMetersInside;
  }

  // Fallback: уменьшаем отступ, пока точка не окажется внутри зоны.
  for (let off = 4.5; off >= 1; off -= 0.5) {
    const candidate = offsetCandidate(off);
    if (candidate !== null) {
      return candidate;
    }
  }

  return fromLocalMeters(closestLocal.x, closestLocal.y, ref);
}

export function randomPointInZone(zone: ServiceZone, rng: () => number): LatLng {
  const bbox = zoneBBox(zone);
  const latRange = bbox.maxLat - bbox.minLat;
  const lngRange = bbox.maxLng - bbox.minLng;

  for (let attempt = 0; attempt < 10000; attempt++) {
    const lat = bbox.minLat + rng() * latRange;
    const lng = bbox.minLng + rng() * lngRange;

    if (isInsideZone({ lat, lng }, zone)) {
      return { lat, lng };
    }
  }

  return zoneCenter(zone);
}

export function moveTowards(from: LatLng, to: LatLng, distanceM: number): LatLng {
  const dist = haversineM(from, to);

  if (dist <= distanceM) {
    return to;
  }

  const bearing = bearingDeg(from, to);
  return moveByBearing(from, distanceM, bearing);
}

export function moveByBearing(from: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const d = distanceM / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);

  const lat1 = toRad(from.lat);
  const lng1 = toRad(from.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );

  const lng2 = lng1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: toDeg(lat2),
    lng: toDeg(lng2),
  };
}

export function bearingDeg(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);

  const x = Math.sin(dLng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = toDeg(Math.atan2(x, y));
  bearing = (bearing + 360) % 360;

  return bearing;
}
