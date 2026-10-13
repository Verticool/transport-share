import { describe, it, expect } from 'vitest';
import { SERVICE_ZONE } from '../src/constants.ts';
import {
  haversineM,
  isInsideZone,
  distanceToZoneBoundaryM,
  zoneBBox,
  zoneCenter,
  clampToZone,
  randomPointInZone,
  moveTowards,
  moveByBearing,
  bearingDeg,
} from '../src/zone.ts';
import { mustGet } from '../src/testing/factories.ts';

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b7975) | 0;
    const t = Math.imul(seed, seed) | 0;
    return (t >>> 0) / 4294967296;
  };
}

describe('zone', () => {
  describe('haversineM', () => {
    it('zero distance for identical points', () => {
      const a = { lat: 42.8746, lng: 74.5698 };
      expect(haversineM(a, a)).toBe(0);
    });

    it('symmetry', () => {
      const a = { lat: 42.8746, lng: 74.5698 };
      const b = { lat: 42.8846, lng: 74.5698 };
      expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 0);
    });

    it('1 degree of latitude ≈ 111100 m', () => {
      const center = { lat: 42.8746, lng: 74.5698 };
      const north = { lat: 42.8846, lng: 74.5698 };
      const dist = haversineM(center, north);
      expect(dist).toBeGreaterThan(1097);
      expect(dist).toBeLessThan(1127);
    });

    it('short distance accuracy within 1%', () => {
      const a = { lat: 42.8746, lng: 74.5698 };
      const b = { lat: 42.8790, lng: 74.5740 };
      const dist = haversineM(a, b);
      expect(dist).toBeGreaterThan(589);
      expect(dist).toBeLessThan(601);
    });
  });

  describe('isInsideZone', () => {
    it('center of Bishkek is inside', () => {
      const center = { lat: 42.8746, lng: 74.5698 };
      expect(isInsideZone(center, SERVICE_ZONE)).toBe(true);
    });

    it('point far outside is outside', () => {
      const outside = { lat: 42.95, lng: 74.6 };
      expect(isInsideZone(outside, SERVICE_ZONE)).toBe(false);
    });

    it('all 8 vertices are inside (boundary inclusive)', () => {
      const vertices = SERVICE_ZONE.polygon;
      for (const [lat, lng] of vertices) {
        expect(isInsideZone({ lat, lng }, SERVICE_ZONE)).toBe(true);
      }
    });

    it('point on midpoint of edge is inside', () => {
      const [lat1, lng1] = mustGet(SERVICE_ZONE.polygon, 0);
      const [lat2, lng2] = mustGet(SERVICE_ZONE.polygon, 1);
      const mid = { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
      expect(isInsideZone(mid, SERVICE_ZONE)).toBe(true);
    });
  });

  describe('distanceToZoneBoundaryM', () => {
    it('vertex → 0 ± 1 m', () => {
      for (const [lat, lng] of SERVICE_ZONE.polygon) {
        const dist = distanceToZoneBoundaryM({ lat, lng }, SERVICE_ZONE);
        expect(dist).toBeLessThan(1);
      }
    });

    it('center zone → between 1000 and 4000 m', () => {
      const center = zoneCenter(SERVICE_ZONE);
      const dist = distanceToZoneBoundaryM(center, SERVICE_ZONE);
      expect(dist).toBeGreaterThan(1000);
      expect(dist).toBeLessThan(4000);
    });

    it('outside point → > 0', () => {
      const outside = { lat: 42.95, lng: 74.6 };
      const dist = distanceToZoneBoundaryM(outside, SERVICE_ZONE);
      expect(dist).toBeGreaterThan(0);
    });

    it('point 1 km from boundary inside → ≈ 1000 ± 50 m', () => {
      const center = zoneCenter(SERVICE_ZONE);
      // Move from center towards nearest boundary by (centerDist - 1000)m
      // Find closest edge and its outward normal
      const { polygon } = SERVICE_ZONE;
      const n = polygon.length;
      const [refLat, refLng] = mustGet(polygon, 0);
      const ref = { lat: refLat, lng: refLng };
      let minDist = Infinity;
      let closestEdge = 0;
      let closestLocal = { x: 0, y: 0 };

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [aLat, aLng] = mustGet(polygon, i);
        const [bLat2, bLng2] = mustGet(polygon, j);
        const segA = { lat: aLat, lng: aLng };
        const segB = { lat: bLat2, lng: bLng2 };
        const p = toLocalMeters(center.lat, center.lng, ref);
        const a = toLocalMeters(segA.lat, segA.lng, ref);
        const b = toLocalMeters(segB.lat, segB.lng, ref);
        const cp = closestPointOnSegment(p.x, p.y, a.x, a.y, b.x, b.y);
        const dist = Math.sqrt((p.x - cp.x) ** 2 + (p.y - cp.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closestEdge = i;
          closestLocal = cp;
        }
      }

      const i = closestEdge;
      const j = (i + 1) % n;
      const [eALat, eALng] = mustGet(polygon, i);
      const [eBLat, eBLng] = mustGet(polygon, j);
      const segA = { lat: eALat, lng: eALng };
      const segB = { lat: eBLat, lng: eBLng };
      const a = toLocalMeters(segA.lat, segA.lng, ref);
      const b = toLocalMeters(segB.lat, segB.lng, ref);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Outward normal (right of edge for CCW polygon)
      const nx = dy;
      const ny = -dx;
      const norm = Math.sqrt(nx * nx + ny * ny);
      const moveDist = 1000;
      const moveX = (nx / norm) * moveDist;
      const moveY = (ny / norm) * moveDist;
      const resultLocal = {
        x: closestLocal.x - moveX,
        y: closestLocal.y - moveY,
      };
      const point1km = fromLocalMeters(resultLocal.x, resultLocal.y, ref);
      const dist1km = distanceToZoneBoundaryM(point1km, SERVICE_ZONE);
      expect(dist1km).toBeGreaterThan(950);
      expect(dist1km).toBeLessThan(1050);
    });
  });

  describe('zoneBBox', () => {
    it('matches min/max of polygon coordinates', () => {
      const { polygon } = SERVICE_ZONE;
      let minLat = Infinity, maxLat = -Infinity;
      let minLng = Infinity, maxLng = -Infinity;
      for (const [lat, lng] of polygon) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      const bbox = zoneBBox(SERVICE_ZONE);
      expect(bbox.minLat).toBe(minLat);
      expect(bbox.maxLat).toBe(maxLat);
      expect(bbox.minLng).toBe(minLng);
      expect(bbox.maxLng).toBe(maxLng);
    });
  });

  describe('clampToZone', () => {
    it('far outside point → inside zone', () => {
      const outside = { lat: 43.0, lng: 74.7 };
      const result = clampToZone(outside, SERVICE_ZONE);
      expect(isInsideZone(result, SERVICE_ZONE)).toBe(true);
    });

    it('inside point → practically unchanged (< 1 m shift)', () => {
      const center = zoneCenter(SERVICE_ZONE);
      const result = clampToZone(center, SERVICE_ZONE);
      const shift = haversineM(center, result);
      expect(shift).toBeLessThan(1);
    });
  });

  describe('randomPointInZone', () => {
    it('500 points all inside zone', () => {
      const rng = mulberry32(42);
      for (let k = 0; k < 500; k++) {
        const point = randomPointInZone(SERVICE_ZONE, rng);
        expect(isInsideZone(point, SERVICE_ZONE)).toBe(true);
      }
    });

    it('deterministic with same seed', () => {
      const rng1 = mulberry32(123);
      const rng2 = mulberry32(123);
      const p1 = randomPointInZone(SERVICE_ZONE, rng1);
      const p2 = randomPointInZone(SERVICE_ZONE, rng2);
      expect(p1.lat).toBe(p2.lat);
      expect(p1.lng).toBe(p2.lng);
    });
  });

  describe('moveTowards', () => {
    it('move less than distance to target → point between them', () => {
      const from = { lat: 42.8746, lng: 74.5698 };
      const to = { lat: 42.8846, lng: 74.5698 };
      const halfDist = haversineM(from, to) / 2;
      const result = moveTowards(from, to, halfDist);
      const distFrom = haversineM(from, result);
      const distTo = haversineM(result, to);
      expect(distFrom).toBeGreaterThan(0);
      expect(distTo).toBeGreaterThan(0);
      expect(distFrom + distTo).toBeCloseTo(haversineM(from, to), 0);
    });

    it('target closer than step → returns target', () => {
      const from = { lat: 42.8746, lng: 74.5698 };
      const to = { lat: 42.8747, lng: 74.5699 };
      const result = moveTowards(from, to, 10000);
      expect(result.lat).toBe(to.lat);
      expect(result.lng).toBe(to.lng);
    });
  });

  describe('bearingDeg / moveByBearing', () => {
    it('north bearing ≈ 0 ± 0.5', () => {
      const from = { lat: 42.87, lng: 74.57 };
      const to = { lat: 42.88, lng: 74.57 };
      const b = bearingDeg(from, to);
      const normalizedNorth = b > 359.5 ? b - 360 : b;
      expect(Math.abs(normalizedNorth)).toBeLessThan(0.5);
    });

    it('east bearing ≈ 90 ± 0.5', () => {
      const from = { lat: 42.87, lng: 74.57 };
      const to = { lat: 42.87, lng: 74.58 };
      const b = bearingDeg(from, to);
      expect(b).toBeGreaterThan(89.5);
      expect(b).toBeLessThan(90.5);
    });

    it('south bearing ≈ 180 ± 0.5', () => {
      const from = { lat: 42.88, lng: 74.57 };
      const to = { lat: 42.87, lng: 74.57 };
      const b = bearingDeg(from, to);
      expect(b).toBeGreaterThan(179.5);
      expect(b).toBeLessThan(180.5);
    });

    it('west bearing ≈ 270 ± 0.5', () => {
      const from = { lat: 42.87, lng: 74.58 };
      const to = { lat: 42.87, lng: 74.57 };
      const b = bearingDeg(from, to);
      expect(b).toBeGreaterThan(269.5);
      expect(b).toBeLessThan(270.5);
    });

    it('300 m at 45° and back → within 1 m of start', () => {
      const from = { lat: 42.8746, lng: 74.5698 };
      const step1 = moveByBearing(from, 300, 45);
      const backBearing = (bearingDeg(from, step1) + 180) % 360;
      const step2 = moveByBearing(step1, 300, backBearing);
      const dist = haversineM(from, step2);
      expect(dist).toBeLessThan(1);
    });

    it('move 300 m at bearing 90 → haversineM = 300 ± 1 m', () => {
      const from = { lat: 42.8746, lng: 74.5698 };
      const result = moveByBearing(from, 300, 90);
      const dist = haversineM(from, result);
      expect(dist).toBeGreaterThan(299);
      expect(dist).toBeLessThan(301);
    });

    it('move north increases latitude, longitude changes ≤ 1e-9', () => {
      const from = { lat: 42.8746, lng: 74.5698 };
      const result = moveByBearing(from, 300, 0);
      expect(result.lat).toBeGreaterThan(from.lat);
      expect(Math.abs(result.lng - from.lng)).toBeLessThan(1e-9);
    });
  });

  describe('haversineM properties', () => {
    it('haversineM(a, a) === 0', () => {
      const a = { lat: 42.8746, lng: 74.5698 };
      expect(haversineM(a, a)).toBe(0);
    });

    it('symmetry haversineM(a,b) === haversineM(b,a)', () => {
      const a = { lat: 42.8746, lng: 74.5698 };
      const b = { lat: 42.8846, lng: 74.5698 };
      expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 0);
    });
  });
});

// Helpers reused from zone.ts for the 1km test
function toLocalMeters(lat: number, lng: number, ref: { lat: number; lng: number }): { x: number; y: number } {
  const rad = Math.PI / 180;
  const refRadLat = ref.lat * rad;
  const refRadLng = ref.lng * rad;
  const latRad = lat * rad;
  const lngRad = lng * rad;
  const x = (lngRad - refRadLng) * Math.cos(refRadLat) * 6371008.8;
  const y = (latRad - refRadLat) * 6371008.8;
  return { x, y };
}

function fromLocalMeters(x: number, y: number, ref: { lat: number; lng: number }): { lat: number; lng: number } {
  const rad = Math.PI / 180;
  const refRadLat = ref.lat * rad;
  const lat = ref.lat + (y / 6371008.8) / rad;
  const lng = ref.lng + (x / (6371008.8 * Math.cos(refRadLat))) / rad;
  return { lat, lng };
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, y: ay + t * dy };
}
