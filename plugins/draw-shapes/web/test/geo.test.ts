// The geometry of the live subscription and of "not in view" (brief, function 7).
import { describe, expect, it } from 'vitest';
import type { Geometry, Position } from '@emc2/plugin-sdk';
import { areaRound, centroidOf, destination, distanceMetres, isInView, moveGeometry, RING_HALF_METRES, viewPointsOf, withinRing, wrapLongitude } from '../src/geo.ts';

const STOCKHOLM: Position = [18.0686, 59.3293];

describe('distances', () => {
  it('measures a degree of latitude and a degree of longitude differently (latitude and longitude differ)', () => {
    expect(distanceMetres([18, 59], [18, 60])).toBeCloseTo(111_195, -2);
    expect(distanceMetres([18, 59], [19, 59])).toBeCloseTo(57_270, -3);
  });

  it('goes the short way across the antimeridian', () => {
    expect(distanceMetres([179.5, 0], [-179.5, 0])).toBeCloseTo(111_195, -2);
  });

  it('destination is the inverse of the distance and the bearing', () => {
    const to = destination(STOCKHOLM, 90, 10_000);
    expect(distanceMetres(STOCKHOLM, to)).toBeCloseTo(10_000, 0);
    expect(to[1]).toBeCloseTo(STOCKHOLM[1], 3);
    expect(to[0]).toBeGreaterThan(STOCKHOLM[0]);
  });

  it('wraps a longitude', () => {
    expect([wrapLongitude(190), wrapLongitude(-190), wrapLongitude(541), wrapLongitude(18), wrapLongitude(180)]).toEqual([-170, 170, -179, 18, 180]);
  });
});

describe('the centroid the store takes a shape\'s bound round', () => {
  it('is the centre of a circle, an ellipse and an arc band, and the point of a point', () => {
    expect(centroidOf({ type: 'Circle', center: STOCKHOLM, radius: 100 })).toEqual([18.0686, 59.3293]);
    expect(centroidOf({ type: 'Ellipse', center: STOCKHOLM, semiMajorAxis: 100, semiMinorAxis: 50, rotation: 30 })).toEqual([18.0686, 59.3293]);
    expect(centroidOf({ type: 'ArcBand', center: STOCKHOLM, innerRadius: 0, outerRadius: 100, startBearing: 0, endBearing: 90 })).toEqual([18.0686, 59.3293]);
    expect(centroidOf({ type: 'Point', coordinates: [18.0686, 59.3293, 12] })).toEqual([18.0686, 59.3293]);
  });

  it('is the middle of the vertices of a line, longitude first and latitude second', () => {
    const [lon, lat] = centroidOf({ type: 'LineString', coordinates: [[16, 58], [18, 60]] });
    expect(lon).toBeCloseTo(17, 1);
    expect(lat).toBeCloseTo(59, 1);
  });

  it('is the middle of the exterior ring of a polygon', () => {
    const polygon: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
    const [lon, lat] = centroidOf(polygon);
    expect(lon).toBeCloseTo(18.12, 1);
    expect(lat).toBeCloseTo(59.34, 1);
  });

  it('works across the antimeridian and at a pole', () => {
    const [lon, lat] = centroidOf({ type: 'LineString', coordinates: [[179, 10], [-179, 10]] });
    expect(Math.abs(lon)).toBeCloseTo(180, 1);
    expect(lat).toBeCloseTo(10, 1);
    expect(centroidOf({ type: 'LineString', coordinates: [[0, 89], [180, 89]] })[1]).toBeCloseTo(90, 1);
  });
});

describe('the small area round a centroid', () => {
  it('is a closed ring of four corners with the centroid inside', () => {
    const area = areaRound(STOCKHOLM);
    expect(area.ring).toHaveLength(5);
    expect(area.ring[0]).toEqual(area.ring[4]);
    expect(area.inside).toEqual(STOCKHOLM);
    const lons = area.ring.map((p) => p[0]);
    const lats = area.ring.map((p) => p[1]);
    expect(Math.min(...lons)).toBeLessThan(STOCKHOLM[0]);
    expect(Math.max(...lons)).toBeGreaterThan(STOCKHOLM[0]);
    expect(Math.min(...lats)).toBeLessThan(STOCKHOLM[1]);
    expect(Math.max(...lats)).toBeGreaterThan(STOCKHOLM[1]);
  });

  it('is about 500 m to each side in metres, not in degrees (a degree of longitude is shorter than a degree of latitude)', () => {
    const area = areaRound(STOCKHOLM);
    const west = [Math.min(...area.ring.map((p) => p[0])), STOCKHOLM[1]] as Position;
    const north = [STOCKHOLM[0], Math.max(...area.ring.map((p) => p[1]))] as Position;
    expect(distanceMetres(STOCKHOLM, west)).toBeCloseTo(RING_HALF_METRES, -1);
    expect(distanceMetres(STOCKHOLM, north)).toBeCloseTo(RING_HALF_METRES, -1);
  });

  it('is the same small ring near a pole and across the antimeridian, round the centroid it was given', () => {
    const corner = RING_HALF_METRES * Math.SQRT2;
    for (const centroid of [[10, 89.99], [10, 90], [-45, -89.995], [179.9999, 10], [-179.9999, 10], [180, 0], [0, 0]] as Position[]) {
      const area = areaRound(centroid);
      expect(area.inside).toEqual(centroid);
      expect(area.ring).toHaveLength(5);
      expect(area.ring[0]).toEqual(area.ring[4]);
      for (const p of area.ring) {
        expect(Math.abs(p[0])).toBeLessThanOrEqual(180);
        expect(Math.abs(p[1])).toBeLessThanOrEqual(90);
        expect(distanceMetres(centroid, p)).toBeCloseTo(corner, -1);
      }
    }
    // Across the antimeridian a corner is wrapped to the other side.
    expect(areaRound([179.9999, 10]).ring.some((p) => p[0] < 0)).toBe(true);
  });

  it('keeps holding a shape while its centroid is inside the ring', () => {
    expect(withinRing(STOCKHOLM, destination(STOCKHOLM, 45, 400))).toBe(true);
    expect(withinRing(STOCKHOLM, destination(STOCKHOLM, 45, 800))).toBe(false);
  });
});

describe('the points that decide "in view"', () => {
  it('are the vertices of a line and a polygon, and points on the edge of a circle and an ellipse', () => {
    expect(viewPointsOf({ type: 'LineString', coordinates: [[16, 58], [18, 60]] })).toEqual([[16, 58], [18, 60]]);
    const circle = viewPointsOf({ type: 'Circle', center: STOCKHOLM, radius: 5000 });
    expect(circle).toHaveLength(10);
    expect(circle.slice(1).every((p) => Math.abs(distanceMetres(STOCKHOLM, p) - 5000) < 5)).toBe(true);
    const ellipse = viewPointsOf({ type: 'Ellipse', center: STOCKHOLM, semiMajorAxis: 8000, semiMinorAxis: 2000, rotation: 90 });
    const far = Math.max(...ellipse.map((p) => distanceMetres(STOCKHOLM, p)));
    const near = Math.min(...ellipse.slice(1).map((p) => distanceMetres(STOCKHOLM, p)));
    expect(far).toBeCloseTo(8000, -1);
    expect(near).toBeCloseTo(2000, -1);
  });
});

describe('"in view": a point of the shape inside the visible area', () => {
  const view = { centre: [15, 62] as Position, ring: [[-10, 50], [40, 50], [40, 72], [-10, 72], [-10, 50]] as Position[] };

  it('is true for a shape inside the view and false for one outside it (latitude and longitude differ)', () => {
    expect(isInView({ type: 'Circle', center: STOCKHOLM, radius: 2500 }, view)).toBe(true);
    expect(isInView({ type: 'Circle', center: [59.3293, 18.0686], radius: 2500 }, view)).toBe(false); // swapped: Sweden's numbers are not Sri Lanka's
    expect(isInView({ type: 'LineString', coordinates: [[100, -30], [101, -29]] }, view)).toBe(false);
  });

  it('is true when only one vertex is inside', () => {
    expect(isInView({ type: 'LineString', coordinates: [[16.5, 58.6], [60, 58.6]] }, view)).toBe(true);
  });

  it('is true for a polygon or a circle that covers the whole view though no point is inside', () => {
    const cover: Geometry = { type: 'Polygon', coordinates: [[[-60, 20], [80, 20], [80, 80], [-60, 80], [-60, 20]]] };
    expect(isInView(cover, view)).toBe(true);
    expect(isInView({ type: 'Circle', center: [15, 62], radius: 5_000_000 }, view)).toBe(true);
    expect(isInView({ type: 'Circle', center: [100, -30], radius: 5_000 }, view)).toBe(false);
    // A circle round the other side of the world covers the view, and none of its points is inside it.
    const huge: Geometry = { type: 'Circle', center: [100, -30], radius: 14_000_000 };
    expect(viewPointsOf(huge).some((p) => p[0] > -10 && p[0] < 40 && p[1] > 50 && p[1] < 72)).toBe(false);
    expect(isInView(huge, view)).toBe(true);
  });

  it('works for a view across the antimeridian', () => {
    const pacific = { centre: [180, 0] as Position, ring: [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]] as Position[] };
    expect(isInView({ type: 'Point', coordinates: [179, 5] }, pacific)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [-175, 5] }, pacific)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [150, 5] }, pacific)).toBe(false);
    expect(isInView({ type: 'Point', coordinates: [-150, 5] }, pacific)).toBe(false);
  });

  it('works for a view that holds a pole, and for the whole world between 13 S and 84 N', () => {
    const arctic = { centre: [0, 90] as Position, ring: Array.from({ length: 9 }, (_, i) => [-180 + i * 45, 70] as Position) };
    expect(isInView({ type: 'Point', coordinates: [30, 80] }, arctic)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [30, 60] }, arctic)).toBe(false);
    const world = { centre: [15, 62] as Position, ring: [[-165, 84], [-165, -13], [15, -13], [195, -13], [195, 84], [15, 84], [-165, 84]] as Position[] };
    expect(isInView({ type: 'Point', coordinates: [18, 59] }, world)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [18, -40] }, world)).toBe(false);
  });

  it('is exact for a view wider than the world: the band between the extent\u2019s latitudes, not a polar view (T-114)', () => {
    // The ring of a zoom-0 view as the map view builds it: the top edge, the meridian opposite the centre down, the bottom edge back, and up.
    const across = (from: number, to: number, lat: number): Position[] => {
      const step = to > from ? 10 : -10;
      const points: Position[] = [];
      for (let lon = from; step > 0 ? lon <= to : lon >= to; lon += step) points.push([lon, lat]);
      return points;
    };
    const down = (lon: number, from: number, to: number): Position[] => {
      const points: Position[] = [];
      for (let lat = from; lat >= to; lat -= 10) points.push([lon, lat]);
      return points;
    };
    const band: Position[] = [...across(-165, 195, 85), ...down(195, 75, -85), ...across(185, -165, -85), ...down(-165, 75, -75).reverse()];
    const world = { centre: [15, 62] as Position, ring: [...band, band[0] as Position] };
    expect(isInView({ type: 'Point', coordinates: [18, 59] }, world)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [-100, -60] }, world)).toBe(true);
    expect(isInView({ type: 'Point', coordinates: [18, 89] }, world)).toBe(false); // beyond the top edge: the polar guess said in view
    expect(isInView({ type: 'Point', coordinates: [-100, 89] }, world)).toBe(false);
    expect(isInView({ type: 'Point', coordinates: [18, -89] }, world)).toBe(false);
  });

  it('is exact for a view that holds a pole but is not round it: the ring\u2019s latitude at the point\u2019s own longitude decides (T-114)', () => {
    const lonLat = (lon: number, base: number, sign: number): Position => [lon, sign * (base + 10 * Math.cos((lon * Math.PI) / 180))];
    for (const sign of [1, -1]) {
      // The ring is at 85 at longitude 0 and at 65 at longitude 180, round the pole; the centre is at longitude 90.
      const ring = Array.from({ length: 25 }, (_, i) => lonLat(-180 + i * 15, 75, sign));
      const view = { centre: [90, sign * 89] as Position, ring };
      expect(isInView({ type: 'Point', coordinates: [180, sign * 70] }, view)).toBe(true);
      expect(isInView({ type: 'Point', coordinates: [0, sign * 89.9] }, view)).toBe(true);
      expect(isInView({ type: 'Point', coordinates: [0, sign * 80] }, view)).toBe(false); // the ring is at 85 here; the lowest latitude, 65, said in view
      expect(isInView({ type: 'Point', coordinates: [180, sign * 60] }, view)).toBe(false);
      expect(isInView({ type: 'Point', coordinates: [-90, sign * 70] }, view)).toBe(false); // the ring is at 75 there
      expect(isInView({ type: 'Point', coordinates: [-90, sign * 80] }, view)).toBe(true);
    }
  });

  it('is false for a view without a ring', () => {
    expect(isInView({ type: 'Point', coordinates: [18, 59] }, { centre: [15, 62], ring: [] })).toBe(false);
  });
});

describe('moveGeometry (brief, function 16; criteria 25 and 26)', () => {
  // The drop is the first position moved by +2 degrees of longitude and +1 of latitude: the two differ, so a swap would show.
  const by = (first: Position): Position => [first[0] + 2, first[1] + 1];
  const close = (a: readonly number[], b: readonly number[]) => {
    expect(a).toHaveLength(b.length);
    a.forEach((v, i) => {
      expect(v).toBeCloseTo(b[i] ?? Number.NaN, 9);
    });
  };

  it('moves every position of a polygon, the holes included, by the same difference', () => {
    const rings: Position[][] = [
      [[18, 59.3], [18.3, 59.3], [18.3, 59.4], [18, 59.4], [18, 59.3]],
      [[18.1, 59.32], [18.2, 59.32], [18.2, 59.35], [18.1, 59.32]],
    ];
    const moved = moveGeometry({ type: 'Polygon', coordinates: rings }, by([18, 59.3]));
    if (moved?.type !== 'Polygon') throw new Error('not a polygon');
    expect(moved.coordinates.map((r) => r.length)).toEqual([5, 4]);
    moved.coordinates.forEach((ring, i) => {
      ring.forEach((p, j) => {
        close(p, by(rings[i]?.[j] ?? [0, 0]));
      });
    });
    expect(moved.coordinates[0]?.[0]).toEqual(moved.coordinates[0]?.[4]); // the ring stays closed
  });

  it('moves a line, a set of points and a corridor, and keeps the corridor width', () => {
    const coordinates: Position[] = [[15.5, 60.25], [16.5, 60.75], [17, 59.1]];
    const line = moveGeometry({ type: 'LineString', coordinates }, by([15.5, 60.25]));
    if (line?.type !== 'LineString') throw new Error('not a line');
    line.coordinates.forEach((p, i) => {
      close(p, by(coordinates[i] ?? [0, 0]));
    });
    expect(moveGeometry({ type: 'MultiPoint', coordinates }, by([15.5, 60.25]))).toMatchObject({ type: 'MultiPoint' });
    const corridor = moveGeometry({ type: 'Corridor', coordinates, width: 800 }, by([15.5, 60.25]));
    expect(corridor).toMatchObject({ type: 'Corridor', width: 800 });
  });

  it('puts the centre of a circle, an ellipse and an arc band at the drop, with their other values unchanged', () => {
    const drop: Position = [20.5, 61.25];
    expect(moveGeometry({ type: 'Circle', center: [18.5, 60.25], radius: 2500 }, drop)).toEqual({ type: 'Circle', center: drop, radius: 2500 });
    expect(moveGeometry({ type: 'Ellipse', center: [18.5, 60.25], semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35 }, drop)).toEqual({
      type: 'Ellipse', center: drop, semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35,
    });
    expect(moveGeometry({ type: 'ArcBand', center: [18.5, 60.25], innerRadius: 100, outerRadius: 900, startBearing: 20, endBearing: 140 }, drop)).toEqual({
      type: 'ArcBand', center: drop, innerRadius: 100, outerRadius: 900, startBearing: 20, endBearing: 140,
    });
    expect(moveGeometry({ type: 'Point', coordinates: [18.5, 60.25] }, drop)).toEqual({ type: 'Point', coordinates: drop });
  });

  it('keeps an altitude, in a moved position and in a centre', () => {
    const line = moveGeometry({ type: 'LineString', coordinates: [[15, 60, 120], [16, 61]] }, [17, 62]);
    expect(line).toEqual({ type: 'LineString', coordinates: [[17, 62, 120], [18, 63]] });
    expect(moveGeometry({ type: 'Circle', center: [15, 60, 30], radius: 10 }, [17, 62])).toEqual({ type: 'Circle', center: [17, 62, 30], radius: 10 });
  });

  it('clamps a latitude at 90 and wraps a longitude across the antimeridian', () => {
    const north = moveGeometry({ type: 'LineString', coordinates: [[10, 88], [12, 89.5]] }, [10, 90]);
    expect(north).toEqual({ type: 'LineString', coordinates: [[10, 90], [12, 90]] });
    const south = moveGeometry({ type: 'LineString', coordinates: [[10, -88], [12, -89.5]] }, [10, -90]);
    expect(south).toEqual({ type: 'LineString', coordinates: [[10, -90], [12, -90]] });
    // A drop across the antimeridian: the map view's drop is within +-180, so the difference is near 360 degrees.
    const ring = moveGeometry({ type: 'LineString', coordinates: [[178, 10], [179.5, 11]] }, [-178, 10]);
    if (ring?.type !== 'LineString') throw new Error('not a line');
    expect(ring.coordinates.every((p) => Math.abs(p[0]) <= 180)).toBe(true);
    close(ring.coordinates[0] ?? [], [-178, 10]);
    close(ring.coordinates[1] ?? [], [-176.5, 11]); // each moved by the difference modulo 360
  });

  it('wraps a longitude that a large difference takes past 180, and puts a centre exactly at the drop', () => {
    // A shape across the antimeridian dragged east: the difference is -357 degrees, so -179 would become -536.
    const across = moveGeometry({ type: 'LineString', coordinates: [[179, 10], [-179, 11]] }, [-178, 10]);
    if (across?.type !== 'LineString') throw new Error('not a line');
    close(across.coordinates[0] ?? [], [-178, 10]);
    close(across.coordinates[1] ?? [], [-176, 11]);
    // 0.256 + (3.7852 - 0.256) is not 3.7852 in floating point: a centre is placed at the drop, not shifted to it.
    expect(moveGeometry({ type: 'Circle', center: [0.256, 10], radius: 5 }, [3.7852, 11])).toEqual({ type: 'Circle', center: [3.7852, 11], radius: 5 });
  });

  it('gives null for a drop that is not a position', () => {
    expect(moveGeometry({ type: 'Point', coordinates: [18, 59] }, [Number.NaN, 59])).toBeNull();
    expect(moveGeometry({ type: 'LineString', coordinates: [] }, [18, 59])).toBeNull();
  });
});
