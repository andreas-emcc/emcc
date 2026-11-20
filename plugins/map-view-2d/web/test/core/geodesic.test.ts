import { describe, expect, it } from 'vitest';
import type { Position } from '@emc2/plugin-sdk';
import { angularDistance, circleRing, densifyPath, destination, distance, ellipseRing, unwrapLongitude } from '../../src/core/geodesic.ts';

const RAD = Math.PI / 180;

describe('geodesic densifying (model rule 10)', () => {
  it('keeps a short edge as it is', () => {
    expect(densifyPath([[15, 60], [15.5, 60.2]])).toEqual([[15, 60], [15.5, 60.2]]);
  });

  it('adds points along the great circle of a long edge, at most one degree apart', () => {
    const a: Position = [10, 60];
    const b: Position = [40, 65];
    const path = densifyPath([a, b]);
    expect(path.length).toBeGreaterThan(10);
    const total = angularDistance(a, b);
    let sum = 0;
    for (let i = 1; i < path.length; i++) {
      const step = angularDistance(path[i - 1] ?? a, path[i] ?? b);
      expect(step).toBeLessThanOrEqual(1 * RAD + 1e-9);
      sum += step;
    }
    // On the great circle, the pieces add up to the whole edge.
    expect(sum).toBeCloseTo(total, 9);
    // A great circle between two northern points bulges towards the pole: the middle is north of both ends' mean.
    const middle = path[Math.floor(path.length / 2)];
    expect(middle?.[1]).toBeGreaterThan(62.5);
  });

  it('keeps an edge across the antimeridian as one edge with continuous longitudes', () => {
    const path = densifyPath([[170, 60], [-170, 62]]);
    expect(path.length).toBeGreaterThan(2);
    for (const [lon] of path) expect(lon).toBeGreaterThanOrEqual(170 - 1e-9);
    expect(path[path.length - 1]?.[0]).toBeCloseTo(190, 9);
    expect(path[path.length - 1]?.[1]).toBeCloseTo(62, 9);
  });

  it('does not densify an edge between antipodes (no shorter geodesic)', () => {
    expect(densifyPath([[0, 10], [180, -10]])).toHaveLength(2);
  });

  it('unwraps a longitude next to a reference', () => {
    expect(unwrapLongitude(-179, 179)).toBe(181);
    expect(unwrapLongitude(179, -179)).toBe(-181);
    expect(unwrapLongitude(20, 15)).toBe(20);
  });

  it('finds the destination along a bearing (north: only the latitude changes)', () => {
    const [lon, lat] = destination([15, 60], 0, 111_195);
    expect(lon).toBeCloseTo(15, 9);
    expect(lat).toBeCloseTo(61, 3);
  });

  it('draws a circle as a closed ring of points at the radius', () => {
    const center: Position = [15, 60];
    const ring = circleRing(center, 50_000);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const p of ring) expect(distance(center, p)).toBeCloseTo(50_000, 3);
  });

  it('draws a circle around a pole as a ring around it, with continuous longitudes', () => {
    const ring = circleRing([0, 89], 500_000);
    const lons = ring.map(([lon]) => lon);
    // The ring goes once around the pole: its longitude grows by a full turn.
    expect(Math.abs((lons[lons.length - 1] ?? 0) - (lons[0] ?? 0))).toBeCloseTo(360, 6);
  });

  it('draws a circle centred on a pole as a real ring around it', () => {
    for (const pole of [[0, 90], [30, -90]] as const) {
      const ring = circleRing(pole, 300_000);
      for (const p of ring) expect(distance(pole, p)).toBeCloseTo(300_000, 3);
      const lons = ring.map(([lon]) => lon);
      // All the way round, not collapsed onto two meridians.
      expect(Math.abs((lons[lons.length - 1] ?? 0) - (lons[0] ?? 0))).toBeCloseTo(360, 6);
      expect(new Set(lons.map((lon) => Math.round(lon))).size).toBeGreaterThan(60);
    }
  });
});

describe('geodesic ellipses (brief function 18, data model Ellipse)', () => {
  // Independent of the module's vector maths: haversine distance and the initial bearing on a sphere.
  const R = 6_371_008.8;
  const haversine = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
    const h = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const bearing = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
    const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
    const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
    return ((Math.atan2(y, x) / RAD) + 360) % 360;
  };

  it('criterion 35: reaches the semi-major axis along the rotation and the semi-minor axis at right angles', () => {
    const center: Position = [15, 60];
    const ring = ellipseRing(center, 20_000, 8_000, 30, 72);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const at = (deg: number) => ring.find((p) => p !== center && Math.abs(bearing(center, p) - deg) < 1e-6) ?? null;
    for (const deg of [30, 210]) expect(haversine(center, at(deg) ?? center)).toBeCloseTo(20_000, 0);
    for (const deg of [120, 300]) expect(haversine(center, at(deg) ?? center)).toBeCloseTo(8_000, 0);
    // Everywhere between the two semi-axes.
    for (const p of ring) {
      const d = haversine(center, p);
      expect(d).toBeGreaterThan(8_000 - 1);
      expect(d).toBeLessThan(20_000 + 1);
    }
  });

  it('is a circle when both axes are equal, and a point when one is 0', () => {
    const center: Position = [-70, 45];
    for (const p of ellipseRing(center, 5_000, 5_000, 75)) expect(haversine(center, p)).toBeCloseTo(5_000, 0);
    for (const p of ellipseRing(center, 5_000, 0, 75)) expect(haversine(center, p)).toBeCloseTo(0, 6);
  });

  it('goes once around a pole it encloses, with continuous longitudes', () => {
    const ring = ellipseRing([0, 89], 600_000, 300_000, 45);
    const lons = ring.map(([lon]) => lon);
    expect(Math.abs((lons[lons.length - 1] ?? 0) - (lons[0] ?? 0))).toBeCloseTo(360, 6);
  });
});
