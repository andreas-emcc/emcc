/** The drawing service's geometry (brief function 17; criteria 32 and 34): map coordinates to lon/lat. */
import { describe, expect, it } from 'vitest';
import type { Geometry, Position } from '@emc2/plugin-sdk';
import { appendedLine, boxCorners, drawnGeometry, editedGeometry, editShapeOf, moveRound, squareCorner, type DrawnShape, type XY } from '../../src/core/drawing.ts';
import { bearing, destination, distance } from '../../src/core/geodesic.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
const mercator = projections[0] as Projection;
const polar = projections[1] as Projection;

const xy = (projection: Projection, p: Position): XY => {
  const result = projection.forward(p);
  if (result === null) throw new Error('not in this projection');
  return result;
};
const geometryOf = (shape: DrawnShape, projection = mercator) => {
  const result = drawnGeometry(shape, projection);
  if ('problem' in result) throw new Error(result.problem);
  return result.geometry;
};
const problemOf = (shape: DrawnShape, projection = mercator) => {
  const result = drawnGeometry(shape, projection);
  return 'problem' in result ? result.problem : null;
};
const expectPosition = (actual: Position | undefined, expected: Position, digits = 9) => {
  expect(actual?.[0]).toBeCloseTo(expected[0], digits);
  expect(actual?.[1]).toBeCloseTo(expected[1], digits);
};

describe('appendedLine (brief function 44)', () => {
  const projection = mercator;
  const own: Position[] = [[14, 60], [15.5, 60.5]];
  it('keeps the line\'s points exactly, adds the others in lon/lat and ignores a first point on the last one', () => {
    const at = (p: Position) => projection.forward(p) ?? [0, 0];
    const result = appendedLine(own, [at([15.5, 60.5]), at([17, 62])], projection);
    expect('line' in result ? result.line.length : 0).toBe(3);
    expect('line' in result ? result.line.slice(0, 2) : []).toEqual(own);
    expect('problem' in appendedLine(own, [at([15.5, 60.5])], projection)).toBe(true);
    expect('problem' in appendedLine(own, [], projection)).toBe(true);
  });
});

describe('the geodesic bearing', () => {
  it('gives back the bearing destination went along, also from a pole', () => {
    for (const start of [[15, 60], [-70, -45], [0, 90], [30, -90]] as Position[]) {
      for (const b of [10, 95, 200, 330]) expect(bearing(start, destination(start, b, 50_000))).toBeCloseTo(b, 6);
    }
  });
});

describe('drawn geometry (brief function 17; owner, 2026-10-16: the gestures)', () => {
  it('criterion 32: a circle drawn with a 5 km radius returns 5 000 m, centred where it was pressed', () => {
    const center: Position = [15, 60];
    const edge = destination(center, 70, 5_000);
    const geometry = geometryOf({ kind: 'circle', center: xy(mercator, center), edge: xy(mercator, edge) });
    expect(geometry.type).toBe('Circle');
    if (geometry.type !== 'Circle') return;
    expectPosition(geometry.center, center);
    expect(geometry.radius).toBeGreaterThan(5_000 * 0.99);
    expect(geometry.radius).toBeLessThan(5_000 * 1.01);
  });

  it('criterion 32: an ellipse fits the dragged box, the longer side its major axis, the rotation its bearing', () => {
    const c = xy(mercator, [15, 60]);
    // Wider than tall on screen: the major axis runs east-west (90°).
    const wide = geometryOf({ kind: 'ellipse', from: [c[0] - 20_000, c[1] - 8_000], to: [c[0] + 20_000, c[1] + 8_000] });
    expect(wide.type).toBe('Ellipse');
    if (wide.type !== 'Ellipse') return;
    expectPosition(wide.center, [15, 60], 6);
    expect(wide.semiMajorAxis).toBeGreaterThan(wide.semiMinorAxis);
    expect(wide.rotation).toBeCloseTo(90, 0);
    // In metres on the ground: 20 km of Web Mercator at 60° N is about 10 km.
    expect(wide.semiMajorAxis).toBeCloseTo(distance([15, 60], mercator.inverse([c[0] + 20_000, c[1]]) ?? [0, 0]), 3);
    // Taller than wide: north-south (0°).
    const tall = geometryOf({ kind: 'ellipse', from: [c[0] + 5_000, c[1] + 30_000], to: [c[0] - 5_000, c[1] - 30_000] });
    if (tall.type !== 'Ellipse') throw new Error('not an ellipse');
    expect(tall.rotation).toBeCloseTo(0, 0);
    expect(tall.semiMinorAxis).toBeLessThanOrEqual(tall.semiMajorAxis);
  });

  it('criterion 32: a square has equal sides on screen, upright, from corner to corner; a rectangle is a closed polygon', () => {
    expect(squareCorner([0, 0], [10, 4])).toEqual([10, 10]);
    expect(squareCorner([0, 0], [-3, 8])).toEqual([-8, 8]);
    const c = xy(mercator, [15, 60]);
    const square = geometryOf({ kind: 'square', from: c, to: [c[0] + 30_000, c[1] - 12_000] });
    if (square.type !== 'Polygon') throw new Error('not a polygon');
    const ring = square.coordinates[0] ?? [];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    const corners = ring.slice(0, 4).map((p) => xy(mercator, p));
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30_000, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(30_000, 3);
    const rectangle = geometryOf({ kind: 'rectangle', from: c, to: [c[0] + 30_000, c[1] - 12_000] });
    if (rectangle.type !== 'Polygon') throw new Error('not a polygon');
    const expected = boxCorners(c, [c[0] + 30_000, c[1] - 12_000]);
    const drawn = (rectangle.coordinates[0] ?? []).map((p) => xy(mercator, p));
    expect(drawn).toHaveLength(5);
    [...expected, expected[0] as XY].forEach(([x, y], i) => {
      expect(drawn[i]?.[0]).toBeCloseTo(x, 3);
      expect(drawn[i]?.[1]).toBeCloseTo(y, 3);
    });
  });

  it('criterion 34: a polygon drawn over the North Pole in EPSG:3413 returns the drawn points', () => {
    const points: Position[] = [[0, 80], [120, 82], [-120, 85]];
    const geometry = geometryOf({ kind: 'polygon', points: points.map((p) => xy(polar, p)) }, polar);
    if (geometry.type !== 'Polygon') throw new Error('not a polygon');
    points.forEach((p, i) => {
      expectPosition(geometry.coordinates[0]?.[i], p);
    });
    expect(geometry.coordinates[0]?.[3]).toEqual(geometry.coordinates[0]?.[0]);
  });

  it('criterion 34: a line drawn across the antimeridian in EPSG:3857 returns longitudes in [-180, 180]', () => {
    // East of 180° the map shows the world again: the drawn x runs past the extent.
    const a = xy(mercator, [179, 60]);
    const b: XY = [a[0] + 2 * 111_319.49, xy(mercator, [179, 61])[1]];
    const geometry = geometryOf({ kind: 'line', points: [a, b] });
    if (geometry.type !== 'LineString') throw new Error('not a line');
    expectPosition(geometry.coordinates[0], [179, 60], 6);
    expectPosition(geometry.coordinates[1], [-179, 61], 6);
  });

  it('draws nothing where the projection cannot show a point, also for a drag released there', () => {
    const inside = xy(polar, [15, 70]);
    const south = xy(polar, [15, 20]); // EPSG:3413 shows only the north
    expect(problemOf({ kind: 'circle', center: inside, edge: south }, polar)).toMatch(/cannot show/);
    expect(problemOf({ kind: 'rectangle', from: inside, to: south }, polar)).toMatch(/cannot show/);
    expect(problemOf({ kind: 'line', points: [inside, south] }, polar)).toMatch(/cannot show/);
  });

  it('drops repeated points, and refuses areas with fewer than three distinct points or none, lines with fewer than two', () => {
    const p = (lon: number, lat: number) => xy(mercator, [lon, lat]);
    const area = geometryOf({ kind: 'polygon', points: [p(15, 60), p(16, 60), p(16, 60), p(16, 61), p(16, 61)] });
    if (area.type !== 'Polygon') throw new Error('not a polygon');
    expect(area.coordinates[0]).toHaveLength(4);
    expect(problemOf({ kind: 'polygon', points: [p(15, 60), p(16, 60), p(16, 60)] })).toMatch(/three/);
    expect(problemOf({ kind: 'polygon', points: [p(15, 60), p(16, 60), p(17, 60)] })).toMatch(/no area/); // collinear
    // A bow tie with two equal lobes has a signed area of nothing, and still encloses two areas (T-111).
    const bow = geometryOf({ kind: 'polygon', points: [p(15, 60), p(17, 61), p(17, 60), p(15, 61)] });
    expect(bow.type).toBe('Polygon');
    expect(problemOf({ kind: 'line', points: [p(15, 60), p(15, 60)] })).toMatch(/two/);
    expect(problemOf({ kind: 'circle', center: p(15, 60), edge: p(15, 60) })).toMatch(/radius/);
    expect(problemOf({ kind: 'rectangle', from: p(15, 60), to: p(16, 60) })).toMatch(/no area/);
  });
});

describe('edited geometry (brief function 17; review finding 2, part C)', () => {
  const roundTrip = (geometry: Geometry, projection: Projection) => {
    const shape = editShapeOf(geometry, projection);
    if (shape === null) throw new Error('not editable here');
    const result = editedGeometry(shape, projection);
    if ('problem' in result) throw new Error(result.problem);
    return result.geometry;
  };
  const closeTo = (actual: unknown, expected: unknown) => {
    if (typeof expected === 'number') {
      expect(actual as number).toBeCloseTo(expected, 6);
      return;
    }
    if (Array.isArray(expected)) {
      expect(Array.isArray(actual)).toBe(true);
      expected.forEach((e, i) => {
        closeTo((actual as unknown[])[i], e);
      });
      return;
    }
    if (typeof expected === 'object' && expected !== null) {
      for (const [k, v] of Object.entries(expected)) closeTo((actual as Record<string, unknown>)[k], v);
      return;
    }
    expect(actual).toEqual(expected);
  };

  it('criterion 33: every editable geometry comes back unchanged when nothing was dragged, in EPSG:3857 and EPSG:3413', () => {
    const geometries: Geometry[] = [
      { type: 'Polygon', coordinates: [[[15, 60], [17, 60], [17, 62], [15, 62], [15, 60]], [[15.5, 60.5], [16, 60.5], [16, 61], [15.5, 60.5]]] },
      { type: 'LineString', coordinates: [[15, 60], [16, 61], [18, 61.5]] },
      { type: 'Point', coordinates: [15, 60] },
      { type: 'Circle', center: [15, 60], radius: 5_000 },
      { type: 'Ellipse', center: [16, 61], semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 30 },
    ];
    for (const projection of [mercator, polar]) {
      for (const geometry of geometries) closeTo(roundTrip(geometry, projection), geometry);
    }
  });

  it('gives no shape for a geometry it does not edit, or one with a point this projection cannot show', () => {
    expect(editShapeOf({ type: 'MultiPoint', coordinates: [[15, 60], [16, 61]] }, mercator)).toBeNull();
    expect(editShapeOf({ type: 'LineString', coordinates: [[15, 60], [15, -40]] }, polar)).toBeNull();
  });

  it('keeps the rotation in [0, 360) after the axes swap', () => {
    const shape = editShapeOf({ type: 'Ellipse', center: [16, 61], semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 350 }, mercator);
    if (shape?.kind !== 'ellipse') throw new Error('not an ellipse');
    const swapped = editedGeometry({ ...shape, minor: xy(mercator, destination([16, 61], 80, 12_000)) }, mercator);
    if ('problem' in swapped || swapped.geometry.type !== 'Ellipse') throw new Error('not an ellipse');
    expect(swapped.geometry.rotation).toBeGreaterThanOrEqual(0);
    expect(swapped.geometry.rotation).toBeLessThan(360);
    expect(swapped.geometry.rotation).toBeCloseTo(80, 0);
  });

  it('criterion 33 (review finding 1): a moved circle keeps its radius, a moved ellipse its axes and rotation, in EPSG:3857 and EPSG:3413', () => {
    const circle = editShapeOf({ type: 'Circle', center: [15, 60], radius: 5_000 }, mercator);
    if (circle === null) throw new Error('no circle');
    const movedCircle = moveRound(circle, xy(mercator, [15, 20]), mercator);
    const c = movedCircle === null ? null : editedGeometry(movedCircle, mercator);
    if (c === null || 'problem' in c || c.geometry.type !== 'Circle') throw new Error('not a circle');
    expectPosition(c.geometry.center, [15, 20], 6);
    expect(Math.abs(c.geometry.radius - 5_000)).toBeLessThan(0.01);
    for (const [projection, from, to] of [[mercator, [16, 61], [30, 45]], [polar, [16, 75], [-100, 80]]] as const) {
      const ellipse = editShapeOf({ type: 'Ellipse', center: from, semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 30 }, projection);
      if (ellipse === null) throw new Error('no ellipse');
      const moved = moveRound(ellipse, xy(projection, to), projection);
      const g = moved === null ? null : editedGeometry(moved, projection);
      if (g === null || 'problem' in g || g.geometry.type !== 'Ellipse') throw new Error('not an ellipse');
      expectPosition(g.geometry.center, to, 6);
      expect(g.geometry.semiMajorAxis).toBeCloseTo(8_000, 3);
      expect(g.geometry.semiMinorAxis).toBeCloseTo(3_000, 3);
      expect(g.geometry.rotation).toBeCloseTo(30, 6);
    }
    // Moved where the projection cannot show it: no shape.
    expect(moveRound(circle, xy(polar, [15, 20]), polar)).toBeNull();
  });
});
