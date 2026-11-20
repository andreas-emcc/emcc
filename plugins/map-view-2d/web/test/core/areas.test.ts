import { describe, expect, it } from 'vitest';
import type { Position } from '@emc2/plugin-sdk';
import { arcBandRings, corridorRing } from '../../src/core/areas.ts';
import { bearing, destination, distance, EARTH_RADIUS } from '../../src/core/geodesic.ts';
import { fillFaces } from '../../src/core/crossing.ts';
import { toDrawItem } from '../../src/core/drawData.ts';
import { layer, object } from '../fixtures.ts';

const RAD = Math.PI / 180;

/** The distance in metres from `p` to the nearest edge of the ring, in a flat plane about `p` (edges here are short). */
function distanceToRing(ring: readonly Position[], p: Position): number {
  const k = Math.cos(p[1] * RAD);
  const metres = (q: Position): [number, number] => [(q[0] - p[0]) * k * RAD * EARTH_RADIUS, (q[1] - p[1]) * RAD * EARTH_RADIUS];
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = metres(ring[i] as Position);
    const b = metres(ring[i + 1] as Position);
    const d: [number, number] = [b[0] - a[0], b[1] - a[1]];
    const length2 = d[0] * d[0] + d[1] * d[1];
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * d[0] + a[1] * d[1]) / length2));
    best = Math.min(best, Math.hypot(a[0] + t * d[0], a[1] + t * d[1]));
  }
  return best;
}

/** The cross-track distance in metres of `p` from the geodesic through `a` and `b` (signed: positive to the right). */
function crossTrack(a: Position, b: Position, p: Position): number {
  const angular = distance(a, p) / EARTH_RADIUS;
  return Math.asin(Math.sin(angular) * Math.sin((bearing(a, p) - bearing(a, b)) * RAD)) * EARTH_RADIUS;
}

/** Whether `p` is inside the ring, by winding in a plane about `p`. */
function inside(ring: readonly Position[], p: Position): boolean {
  const k = Math.cos(p[1] * RAD);
  let winding = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i] as Position;
    const b = ring[i + 1] as Position;
    const ax = (a[0] - p[0]) * k;
    const bx = (b[0] - p[0]) * k;
    const ay = a[1] - p[1];
    const by = b[1] - p[1];
    const cross = ax * by - bx * ay;
    if (ay <= 0 && by > 0 && cross > 0) winding++;
    else if (ay > 0 && by <= 0 && cross < 0) winding--;
  }
  return winding !== 0;
}

// Longitude and latitude differ everywhere, as gmti's criterion 4 and the brief's criteria 84 to 86.
const CENTRE: Position = [15.2, 58.41];
const band = (innerRadius: number, outerRadius: number, startBearing: number, endBearing: number, center: Position = CENTRE) => ({ type: 'ArcBand' as const, center, innerRadius, outerRadius, startBearing, endBearing });

describe('arc bands (brief function 36, criteria 84 and 85)', () => {
  it('criterion 84: has its outer arc 35 000 m and its inner arc 25 000 m from the centre, and its sides along 82.5° and 97.5°', () => {
    const rings = arcBandRings(band(25_000, 35_000, 82.5, 97.5));
    expect(rings).toHaveLength(1);
    const ring = rings?.[0] as Position[];
    expect(distanceToRing(ring, destination(CENTRE, 90, 35_000))).toBeLessThan(1);
    expect(distanceToRing(ring, destination(CENTRE, 90, 25_000))).toBeLessThan(1);
    // The sides: points along each bearing between the radii are on an edge.
    for (const side of [82.5, 97.5]) for (const metres of [26_000, 30_000, 34_000]) expect(distanceToRing(ring, destination(CENTRE, side, metres))).toBeLessThan(1);
    // The vertices are all on one of the two circles, or on a side.
    for (const p of ring) {
      const radius = distance(CENTRE, p);
      const b = bearing(CENTRE, p);
      const onArc = Math.abs(radius - 35_000) < 0.01 || Math.abs(radius - 25_000) < 0.01;
      const onSide = Math.abs(b - 82.5) < 1e-4 || Math.abs(b - 97.5) < 1e-4;
      expect(onArc || onSide).toBe(true);
    }
    // Inside the band, and not inside the hole or beyond it or off to the side.
    expect(inside(ring, destination(CENTRE, 90, 30_000))).toBe(true);
    expect(inside(ring, destination(CENTRE, 90, 20_000))).toBe(false);
    expect(inside(ring, destination(CENTRE, 90, 40_000))).toBe(false);
    expect(inside(ring, destination(CENTRE, 70, 30_000))).toBe(false);
  });

  it('criterion 85: a radius of 0 gives a wedge from the centre', () => {
    const ring = arcBandRings(band(0, 30_000, 60, 120))?.[0] as Position[];
    expect(ring.some((p) => distance(CENTRE, p) < 0.01)).toBe(true);
    expect(inside(ring, destination(CENTRE, 90, 15_000))).toBe(true);
    expect(inside(ring, destination(CENTRE, 90, 31_000))).toBe(false);
    expect(inside(ring, destination(CENTRE, 270, 15_000))).toBe(false);
    expect(distanceToRing(ring, destination(CENTRE, 90, 30_000))).toBeLessThan(1);
    expect(distanceToRing(ring, destination(CENTRE, 60, 15_000))).toBeLessThan(1); // the side, geodesic along the bearing
  });

  it('criterion 85: draws 300° to 60° across north, the 120° sector and not its complement', () => {
    const ring = arcBandRings(band(10_000, 30_000, 300, 60))?.[0] as Position[];
    expect(inside(ring, destination(CENTRE, 0, 20_000))).toBe(true);
    expect(inside(ring, destination(CENTRE, 330, 20_000))).toBe(true);
    expect(inside(ring, destination(CENTRE, 30, 20_000))).toBe(true);
    expect(inside(ring, destination(CENTRE, 180, 20_000))).toBe(false);
    expect(inside(ring, destination(CENTRE, 90, 20_000))).toBe(false);
    expect(inside(ring, destination(CENTRE, 270, 20_000))).toBe(false);
  });

  it('criterion 85: gives the whole ring for equal bearings (with a hole), and a disc when the radius is 0', () => {
    const rings = arcBandRings(band(10_000, 30_000, 45, 45)) as Position[][];
    expect(rings).toHaveLength(2);
    expect(rings.every((ring) => ring.length > 16)).toBe(true);
    const [outer, hole] = rings as [Position[], Position[]];
    expect(distanceToRing(outer, destination(CENTRE, 200, 30_000))).toBeLessThan(1);
    expect(distanceToRing(hole, destination(CENTRE, 200, 10_000))).toBeLessThan(1);
    expect(inside(outer, destination(CENTRE, 200, 20_000))).toBe(true);
    const disc = arcBandRings(band(0, 30_000, 10, 370)) as Position[][];
    expect(disc).toHaveLength(1);
  });

  it('draws the arc within a metre of its circle between its points, at the longest reach of a STANAG 4607 dwell (255.99 km)', () => {
    const ring = arcBandRings(band(200_000, 255_990, 20, 140))?.[0] as Position[];
    for (const b of [21, 47.3, 90.1, 139]) expect(distanceToRing(ring, destination(CENTRE, b, 255_990))).toBeLessThan(1.5);
    expect(ring.length).toBeLessThan(2000);
  });

  it('is continuous across the antimeridian, a point at a time', () => {
    const ring = arcBandRings(band(10_000, 60_000, 0, 180, [179.95, 10.2]))?.[0] as Position[];
    ring.forEach((p, i) => {
      const previous = ring[i - 1];
      if (previous !== undefined) expect(Math.abs(p[0] - previous[0])).toBeLessThan(1);
    });
    expect(Math.max(...ring.map((p) => p[0]))).toBeGreaterThan(180); // goes on into the next world
  });

  it('has no area for a band without width or with numbers that are not numbers', () => {
    expect(arcBandRings(band(30_000, 30_000, 0, 90))).toBeNull();
    expect(arcBandRings(band(40_000, 30_000, 0, 90))).toBeNull();
    expect(arcBandRings(band(0, 0, 0, 90))).toBeNull();
    expect(arcBandRings(band(0, Number.NaN, 0, 90))).toBeNull();
  });
});

describe('corridors (brief function 36, criterion 86)', () => {
  const A: Position = [15, 58];
  const B: Position = [16, 58.5];

  it('criterion 86: has its edges 1 000 m from the centre line (within 1 m), with flat ends', () => {
    const ring = corridorRing({ type: 'Corridor', coordinates: [A, B], width: 2000 }) as Position[];
    const distances = ring.map((p) => Math.abs(crossTrack(A, B, p)));
    expect(Math.min(...distances)).toBeGreaterThan(999);
    expect(Math.max(...distances)).toBeLessThan(1001);
    // The ends are flat: the four corners are at 1 000 m to each side, and no position lies beyond the ends along the line.
    const along = ring.map((p) => Math.asin(Math.max(-1, Math.min(1, Math.cos(Math.asin(crossTrack(A, B, p) / EARTH_RADIUS)) ** -1 * Math.sin(distance(A, p) / EARTH_RADIUS) * Math.cos((bearing(A, p) - bearing(A, B)) * RAD)))) * EARTH_RADIUS);
    expect(Math.min(...along)).toBeGreaterThan(-1);
    expect(Math.max(...along)).toBeLessThan(distance(A, B) + 1);
    // Inside the corridor, and not outside.
    expect(inside(ring, destination(A, bearing(A, B), 30_000))).toBe(true);
    expect(inside(ring, destination(destination(A, bearing(A, B), 30_000), bearing(A, B) + 90, 900))).toBe(true);
    expect(inside(ring, destination(destination(A, bearing(A, B), 30_000), bearing(A, B) + 90, 1100))).toBe(false);
    expect(inside(ring, destination(A, bearing(A, B) + 180, 200))).toBe(false); // behind the start: a flat end
    expect(inside(ring, destination(B, bearing(A, B), 200))).toBe(false);
  });

  it('rounds the join on the outside of a turn, and cuts the inside, without crossing itself', () => {
    const turnAt: Position = [15.5, 58.2];
    const coordinates: Position[] = [[15, 58], turnAt, [15.8, 58.7]]; // a turn to the left
    const ring = corridorRing({ type: 'Corridor', coordinates, width: 4000 }) as Position[];
    // Round: positions on the outside are 2 000 m from the turn's position (the right, for a left turn).
    const onArc = ring.filter((p) => Math.abs(distance(turnAt, p) - 2000) < 1);
    expect(onArc.length).toBeGreaterThan(3);
    // No position is nearer the line than 2 000 m (within a metre), none is farther than 2 000 m from it.
    const nearest = (p: Position) => Math.min(...[[coordinates[0], turnAt], [turnAt, coordinates[2]]].map(([a, b]) => Math.abs(crossTrack(a as Position, b as Position, p))));
    expect(Math.max(...ring.map((p) => Math.min(nearest(p), distance(turnAt, p))))).toBeLessThan(2001);
    // A gentle turn does not make the outline cross itself: it fills as one face.
    const xy = ring.map((p): [number, number] => [p[0] * Math.cos(58.3 * RAD), p[1]]);
    expect(fillFaces(xy)).toBeNull();
    expect(inside(ring, turnAt)).toBe(true);
  });

  it('is a disc for one position, and has no area for no width', () => {
    const disc = corridorRing({ type: 'Corridor', coordinates: [A, [A[0], A[1]]], width: 2000 }) as Position[];
    expect(Math.abs(distance(A, disc[3] as Position) - 1000)).toBeLessThan(1);
    expect(corridorRing({ type: 'Corridor', coordinates: [A, B], width: 0 })).toBeNull();
    expect(corridorRing({ type: 'Corridor', coordinates: [], width: 100 })).toBeNull();
    expect(corridorRing({ type: 'Corridor', coordinates: [A, [Number.NaN, 1]], width: 100 })).toBeNull();
  });

  it('is continuous across the antimeridian', () => {
    const ring = corridorRing({ type: 'Corridor', coordinates: [[179.5, 10.1], [-179.5, 10.6]], width: 5000 }) as Position[];
    ring.forEach((p, i) => {
      const previous = ring[i - 1];
      if (previous !== undefined) expect(Math.abs(p[0] - previous[0])).toBeLessThan(1);
    });
    expect(Math.max(...ring.map((p) => p[0]))).toBeGreaterThan(180);
  });

  it('follows a long segment as a geodesic does: 1 000 m from it along the whole line (2 500 km)', () => {
    const a: Position = [-20, 40];
    const b: Position = [20, 60];
    const ring = corridorRing({ type: 'Corridor', coordinates: [a, b], width: 2000 }) as Position[];
    const distances = ring.map((p) => Math.abs(crossTrack(a, b, p)));
    expect(Math.max(...distances)).toBeLessThan(1001);
    expect(Math.min(...distances)).toBeGreaterThan(999);
  });
});

describe('the draw items of arc bands and corridors (brief function 36)', () => {
  const L = layer(1, 10);

  it('are polygons with their style and their name, as a circle is; a degenerate one keeps the marker', () => {
    const style = { stroke: { color: '#ff0000', width: 2 }, fill: { color: '#00ff00', opacity: 0.4 } } as never;
    const named = object(1, L.id, 'core.shape', band(25_000, 35_000, 82.5, 97.5), { style, properties: { name: 'Sensor report' } });
    const item = toDrawItem(named);
    expect(item?.kind).toBe('polygon');
    expect(item).toMatchObject({ name: 'Sensor report', style });
    const corridor = toDrawItem(object(2, L.id, 'core.shape', { type: 'Corridor', coordinates: [[15, 58], [16, 58.5]], width: 2000 }, { style }));
    expect(corridor?.kind).toBe('polygon');
    const empty = toDrawItem(object(3, L.id, 'core.shape', band(0, 0, 0, 90), { style }));
    expect(empty?.kind).toBe('fallback');
    expect(empty).toMatchObject({ position: CENTRE });
  });
});
