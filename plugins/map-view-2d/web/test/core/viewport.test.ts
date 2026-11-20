import { describe, expect, it } from 'vitest';
import type { Position } from '@emc2/plugin-sdk';
import { angularDistance, unwrapLongitude } from '../../src/core/geodesic.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { groundResolution, mapToPixel, MAX_EDGE_DEGREES, pixelToMap, resolutionForGround, sameView, viewIn, visibleArea, type ViewState } from '../../src/core/viewport.ts';
import { textbook } from '../fixtures.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
const mercator = projections[0] as Projection;
const polar = projections[1] as Projection;
const south = projections[2] as Projection;

function view(projection: Projection, center: Position, resolution: number, width = 800, height = 600): ViewState {
  const xy = projection.forward(center);
  if (xy === null) throw new Error('centre not projected');
  return { width, height, center: xy, resolution };
}

/**
 * Planar point-in-ring test with the ring's longitudes made continuous and the point's longitude
 * moved to the middle of the ring's (fine for rings not enclosing a pole, up to one world wide).
 */
function contains(ring: readonly Position[], [pointLon, lat]: Position): boolean {
  const unwrapped: (readonly [number, number])[] = [];
  for (const [x, y] of ring) {
    const previous = unwrapped[unwrapped.length - 1];
    unwrapped.push([previous === undefined ? x : unwrapLongitude(x, previous[0]), y]);
  }
  const lons = unwrapped.map(([x]) => x);
  const lon = unwrapLongitude(pointLon, (Math.min(...lons) + Math.max(...lons)) / 2);
  let inside = false;
  for (let i = 0, j = unwrapped.length - 1; i < unwrapped.length; j = i++) {
    const a = unwrapped[i];
    const b = unwrapped[j];
    if (a === undefined || b === undefined) continue;
    if (a[1] > lat !== b[1] > lat && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** How far the ring turns around the pole, in degrees of longitude (±360 if it encloses it, 0 if not). */
function turnAroundPole(ring: readonly Position[]): number {
  let turn = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]?.[0] ?? 0;
    const b = ring[i]?.[0] ?? 0;
    turn += unwrapLongitude(b, a) - a;
  }
  return turn;
}

/**
 * Planar point-in-ring test on an azimuthal picture of the North Pole (distance from the pole in
 * degrees, longitude as the angle). Independent of EPSG:3413's maths; fine for any ring that stays
 * away from the South Pole, including one that encloses the North Pole.
 */
function containsAroundNorthPole(ring: readonly Position[], point: Position): boolean {
  const flat = ([lon, lat]: Position): [number, number] => [(90 - lat) * Math.cos((lon * Math.PI) / 180), (90 - lat) * Math.sin((lon * Math.PI) / 180)];
  const [px, py] = flat(point);
  const points = ring.map(flat);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a === undefined || b === undefined) continue;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** The longest edge of a ring on the ground, in degrees of arc. */
function longestEdge(ring: readonly Position[]): number {
  let longest = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    if (a !== undefined && b !== undefined) longest = Math.max(longest, (angularDistance(a, b) * 180) / Math.PI);
  }
  return longest;
}

describe('viewport', () => {
  it('converts between pixels and map coordinates both ways', () => {
    const v = view(mercator, [15, 60], 100);
    expect(pixelToMap(v, [400, 300])).toEqual([...v.center]);
    const pixel = mapToPixel(v, pixelToMap(v, [123, 456]));
    expect(pixel[0]).toBeCloseTo(123, 9);
    expect(pixel[1]).toBeCloseTo(456, 9);
    // Up on the screen is north: a smaller y pixel is a larger y map coordinate.
    expect(pixelToMap(v, [400, 0])[1]).toBeGreaterThan(v.center[1]);
  });

  it('gives the ground resolution at the centre: in EPSG:3857 at 60° N, half the projected one', () => {
    const v = view(mercator, [15, 60], 1000);
    // cos 60° = 0.5; the sphere radius differs slightly from the Mercator one.
    expect(groundResolution(mercator, v.center, 1000)).toBeCloseTo(500 * (6_371_008.8 / 6_378_137), 0);
  });

  it('turns metres per pixel back into the projected resolution', () => {
    const v = view(polar, [15, 75], 2000);
    const ground = groundResolution(polar, v.center, 2000);
    expect(resolutionForGround(polar, v.center, ground)).toBeCloseTo(2000, 3);
  });

  it('gives the visible area as a closed ring whose inside contains the centre', () => {
    const center: Position = [15, 60];
    const ring = visibleArea(view(mercator, center, 2000), mercator);
    expect(ring.length).toBeGreaterThan(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(contains(ring, center)).toBe(true);
    expect(contains(ring, [60, 15])).toBe(false);
  });

  it('gives the visible area across the antimeridian without a jump around the world', () => {
    const center: Position = [180, 60];
    const ring = visibleArea(view(mercator, center, 2000), mercator);
    for (const [lon] of ring) expect(Math.abs(lon)).toBeGreaterThan(170);
    expect(contains(ring, center)).toBe(true);
    expect(contains(ring, [0, 60])).toBe(false);
    expect(turnAroundPole(ring)).toBeCloseTo(0, 6);
  });

  it('gives the visible area around the North Pole as a ring that encloses the pole', () => {
    const ring = visibleArea(view(polar, [0, 90], 2000), polar);
    expect(Math.abs(turnAroundPole(ring))).toBeCloseTo(360, 6);
    for (const [, lat] of ring) expect(lat).toBeGreaterThan(80);
  });

  it('gives the visible area around the South Pole in EPSG:3031 as a ring that encloses the pole', () => {
    const ring = visibleArea(view(south, [0, -90], 2000), south);
    expect(Math.abs(turnAroundPole(ring))).toBeCloseTo(360, 6);
    for (const [, lat] of ring) expect(lat).toBeLessThan(-80);
  });

  it('gives the visible area of a view next to the pole that does not contain it', () => {
    const center: Position = [15, 75];
    const ring = visibleArea(view(polar, center, 500), polar);
    expect(turnAroundPole(ring)).toBeCloseTo(0, 6);
    expect(contains(ring, center)).toBe(true);
  });

  it('clamps the visible area to the projection extent when zoomed out beyond the world', () => {
    const ring = visibleArea(view(mercator, [0, 0], 200_000, 1000, 1000), mercator);
    for (const [lon, lat] of ring) {
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(85.06);
    }
  });

  it('gives the visible area of a view with the North Pole off-centre as a ring that encloses the pole and the centre (review remark N3)', () => {
    // 1600 km by 1200 km around 85° N 0° E: the pole is about 560 km from the centre, on the screen.
    const center: Position = [0, 85];
    const ring = visibleArea(view(polar, center, 2000), polar);
    expect(Math.abs(turnAroundPole(ring))).toBeCloseTo(360, 6);
    expect(containsAroundNorthPole(ring, center)).toBe(true);
    expect(containsAroundNorthPole(ring, [0, 90])).toBe(true);
    expect(containsAroundNorthPole(ring, [0, 70])).toBe(false); // about 1670 km from the centre
    expect(containsAroundNorthPole(ring, [180, 75])).toBe(false); // behind the pole, about 2200 km away
    expect(longestEdge(ring)).toBeLessThanOrEqual(MAX_EDGE_DEGREES);
  });

  it('gives the visible area of a view wider than the world as the band of the extent, with short edges (review remark N3)', () => {
    // EPSG:3857's world is 200 pixels wide at 200 km per pixel; the view is 1000 pixels wide.
    for (const center of [[0, 0], [100, 20]] as Position[]) {
      const ring = visibleArea(view(mercator, center, 200_000, 1000, 1000), mercator);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(longestEdge(ring)).toBeLessThanOrEqual(MAX_EDGE_DEGREES);
      expect(contains(ring, center)).toBe(true);
      expect(contains(ring, [center[0] + 170, -40])).toBe(true); // every longitude is on the screen
      expect(contains(ring, [center[0] - 170, 40])).toBe(true);
      expect(contains(ring, [center[0], 88])).toBe(false); // beyond the extent
      expect(contains(ring, [center[0], -88])).toBe(false);
      expect(turnAroundPole(ring)).toBeCloseTo(0, 6);
    }
  });

  it('keeps an ordinary view at its border samples: no extra points where the edges are short already', () => {
    expect(visibleArea(view(mercator, [15, 60], 2000), mercator)).toHaveLength(33);
  });
});

describe('viewIn: a centre beyond what the projection can show (MCA, 2026-10-12)', () => {
  const E = 4_194_304; // the polar projections' extent, in metres

  it('31° N 18° E in EPSG:3413 lies beyond the extent: the nearest point inside it, checked against the textbook formula', () => {
    const [ex, ey] = textbook.polarStereographic3413(18, 31);
    expect(Math.abs(ex)).toBeGreaterThan(E); // beyond the extent on x, inside on y
    expect(Math.abs(ey)).toBeLessThan(E);
    const { center, resolution } = viewIn(polar, [18, 31], 100);
    expect(center[0]).toBeCloseTo(E, 6);
    expect(center[1]).toBeCloseTo(ey, 2);
    expect(resolution).toBeGreaterThan(0);
    const shown = polar.inverse(center);
    expect(shown?.[1]).toBeGreaterThan(40); // further north than asked: the map cannot go further
  });

  it('a centre the projection can show stays where it is: 61° N 15° E in EPSG:3413', () => {
    const [ex, ey] = textbook.polarStereographic3413(15, 61);
    const { center } = viewIn(polar, [15, 61], 100);
    expect(center[0]).toBeCloseTo(ex, 2);
    expect(center[1]).toBeCloseTo(ey, 2);
  });

  it('beyond the world extent: 89° N 20° E in EPSG:3857 goes to the top edge at 20° E', () => {
    const [ex] = textbook.webMercator(20, 60);
    const { center } = viewIn(mercator, [20, 89], 100);
    expect(center[0]).toBeCloseTo(ex, 2);
    expect(center[1]).toBeCloseTo(mercator.def.extent[3], 2);
  });

  it('a northern point in EPSG:3031 goes to 30° S (its world extent), then into the extent: checked against the textbook formula', () => {
    const [ex, ey] = textbook.polarStereographic3031(60, -30);
    expect(Math.abs(ex)).toBeGreaterThan(E); // 30° S 60° E is beyond the extent on x, inside on y
    expect(Math.abs(ey)).toBeLessThan(E);
    const { center } = viewIn(south, [60, 10], 100);
    expect(center[0]).toBeCloseTo(E, 6);
    expect(center[1]).toBeCloseTo(ey, 2);
  });
});

describe("sameView: the same view up to the engine's rounding (ITA, 2026-10-19)", () => {
  const view = { center: [1_700_000, 8_500_000] as const, resolution: 2_000 };

  it('allows a millionth of a pixel in the centre and a billionth in the resolution', () => {
    expect(sameView(view, { center: [1_700_000 + 0.0014, 8_500_000 - 0.0014], resolution: 2_000 * (1 + 0.9e-9) })).toBe(true);
  });

  it('a move of more is another view', () => {
    expect(sameView(view, { center: [1_700_000 + 0.0021, 8_500_000], resolution: 2_000 })).toBe(false);
    expect(sameView(view, { center: [1_700_000, 8_500_000 + 0.0021], resolution: 2_000 })).toBe(false);
    expect(sameView(view, { center: view.center, resolution: 2_000 * (1 + 1.1e-9) })).toBe(false);
    expect(sameView(view, { center: view.center, resolution: 2_000 * (1 - 1.1e-9) })).toBe(false);
  });
});
