/**
 * Vector backgrounds (brief function 11, criteria 17 and 19): clipping, densifying, projecting and
 * the seams at ±180° and the poles, checked against the textbook projection formulas (independent
 * of proj4, as criterion 3).
 */
import { describe, expect, it } from 'vitest';
import type { Position, VectorFeature, VectorLayer } from '@emc2/plugin-sdk';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { clipLine, clipRing, closedRing, densify, prepareVector, withoutPoleCut, type XY } from '../../src/core/vectorBackground.ts';
import { textbook } from '../fixtures.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
const byCode = (code: string) => projections.find((p) => p.def.code === code) as Projection;
const mercator = byCode('EPSG:3857');
const arctic = byCode('EPSG:3413');
const antarctic = byCode('EPSG:3031');

const LAYERS: readonly VectorLayer[] = [
  { id: 'land', style: { fillColor: '#efeadf' } },
  { id: 'coastline', style: { strokeColor: '#7c8c99', strokeWidth: 1 } },
];
const SOURCE = { background: '#c9dbe8', layers: LAYERS };

const polygon = (ring: Position[]): VectorFeature => ({ layer: 'land', geometry: { type: 'Polygon', coordinates: [ring] } });
const line = (points: Position[]): VectorFeature => ({ layer: 'coastline', geometry: { type: 'LineString', coordinates: points } });

/** Antarctica as Natural Earth draws it: the coast at 70° S from 180° westwards to −180°, down to the pole, along it, and up again. */
const ANTARCTICA: Position[] = [
  [180, -70], [90, -70], [0, -70], [-90, -70], [-180, -70], [-180, -90], [180, -90], [180, -70],
];

/** Distance from the projection's centre (the pole), in metres. */
const fromPole = ([x, y]: XY) => Math.hypot(x, y);

function layer(prepared: ReturnType<typeof prepareVector>, id: string) {
  const found = prepared.layers.find((l) => l.id === id);
  if (found === undefined) throw new Error(`no layer ${id}`);
  return found;
}

describe('vector backgrounds: preparing for a projection (brief function 11)', () => {
  it('keeps the layers in the source order, with their looks; a fill-only layer covers its seams', () => {
    const prepared = prepareVector(SOURCE, [], mercator);
    expect(prepared.projection).toBe('EPSG:3857');
    expect(prepared.background).toEqual([201, 219, 232, 1]);
    expect(prepared.layers.map((l) => l.id)).toEqual(['land', 'coastline']);
    expect(layer(prepared, 'land')).toMatchObject({ fill: [239, 234, 223, 1], stroke: null, seamCover: true });
    expect(layer(prepared, 'coastline')).toMatchObject({ fill: null, stroke: [124, 140, 153, 1], strokeWidth: 1, seamCover: false });
    const translucent = prepareVector({ layers: [{ id: 'land', style: { fillColor: '#efeadf', fillOpacity: 0.5 } }] }, [], mercator);
    expect(layer(translucent, 'land').seamCover).toBe(false); // an outline would darken the edge
  });

  it('criterion 19: a line along 49° N over 30° of longitude is an arc along that parallel in EPSG:3413, not a chord', () => {
    const prepared = prepareVector(SOURCE, [line([[-60, 49], [-30, 49]])], arctic);
    const [points] = layer(prepared, 'coastline').lines;
    expect(points?.length).toBeGreaterThanOrEqual(31);
    const rho = fromPole(textbook.polarStereographic3413(-45, 49));
    for (const point of points ?? []) expect(fromPole(point)).toBeCloseTo(rho, 0);
    // A chord between the ends would pass about 3.4 % closer to the pole in its middle.
    const middle = points?.[Math.floor((points.length - 1) / 2)];
    expect(middle?.[0]).toBeCloseTo(textbook.polarStereographic3413(-45, 49)[0], 0);
  });

  it('criterion 17: Antarctica in EPSG:3031 is one closed ring along its coast, in place, with no slit to the pole along 180°', () => {
    const prepared = prepareVector(SOURCE, [polygon(ANTARCTICA)], antarctic);
    const polygons = layer(prepared, 'land').polygons;
    expect(polygons).toHaveLength(1);
    const [ring] = polygons[0] ?? [];
    if (ring === undefined) throw new Error('no ring');
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const rho = fromPole(textbook.polarStereographic3031(0, -70));
    for (const point of ring) expect(fromPole(point)).toBeCloseTo(rho, 0); // nothing runs to the pole
    const [ex, ey] = textbook.polarStereographic3031(90, -70);
    expect(ring.some(([x, y]) => Math.abs(x - ex) < 1 && Math.abs(y - ey) < 1)).toBe(true);
  });

  it('criterion 17: Antarctica as Natural Earth really draws it (pole edge at −89.9989°, the two sides of the cut with different points) has no slit to the pole in EPSG:3031', () => {
    // From ne_50m_land 5.1.2: +180° jumps from the coast to the pole edge; −180° comes back up through its own points.
    const real: Position[] = [
      [179.6203, -84.2684], [180, -84.3516], [180, -89.9989], [90, -89.9989], [0, -89.9989], [-90, -89.9989], [-180, -89.9989],
      [-180, -89.5829], [-180, -89.293], [-180, -88.587], [-180, -84.3516], [-179, -84.2], [-90, -75], [0, -70], [90, -72], [179.6203, -84.2684],
    ];
    const [ring] = layer(prepareVector(SOURCE, [polygon(real)], antarctic), 'land').polygons[0] ?? [];
    if (ring === undefined) throw new Error('no ring');
    const nearest = Math.min(...ring.map(fromPole));
    expect(nearest).toBeGreaterThan(0.9 * fromPole(textbook.polarStereographic3031(180, -84.3516)));
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('criterion 17: Antarctica in EPSG:3857 is clipped at the world extent and spans the map once; in EPSG:3413 it is gone', () => {
    const [mercatorPolygon] = layer(prepareVector(SOURCE, [polygon(ANTARCTICA)], mercator), 'land').polygons;
    const [ring] = mercatorPolygon ?? [];
    const xs = (ring ?? []).map(([x]) => x);
    const ys = (ring ?? []).map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(-20037508.34, 0);
    expect(Math.max(...xs)).toBeCloseTo(20037508.34, 0);
    expect(Math.min(...ys)).toBeCloseTo(-20037508.34, -2); // 85.05° S, the bottom of the map
    expect(Math.max(...ys)).toBeCloseTo(textbook.webMercator(0, -70)[1], 0);
    expect(layer(prepareVector(SOURCE, [polygon(ANTARCTICA)], arctic), 'land').polygons).toEqual([]);
  });

  it('criterion 17: a polygon cut at ±180° (Chukotka) meets its other piece exactly in EPSG:3413, where they are drawn without a seam', () => {
    const east: Position[] = [[170, 65], [180, 65], [180, 70], [170, 70], [170, 65]];
    const west: Position[] = [[-180, 65], [-170, 65], [-170, 70], [-180, 70], [-180, 65]];
    const land = layer(prepareVector(SOURCE, [polygon(east), polygon(west)], arctic), 'land');
    expect(land.polygons).toHaveLength(2);
    const onCut = (ring: readonly XY[] | undefined, lonOfCut: number) =>
      (ring ?? []).filter(([x, y]) => {
        const [cx, cy] = textbook.polarStereographic3413(lonOfCut, 67.5);
        return Math.abs(Math.atan2(x, -y) - Math.atan2(cx, -cy)) < 1e-9;
      });
    const eastCut = onCut(land.polygons[0]?.[0], 180);
    const westCut = onCut(land.polygons[1]?.[0], -180);
    expect(eastCut.length).toBeGreaterThanOrEqual(6); // 65° to 70°, every degree
    for (const point of eastCut) expect(westCut.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) < 1e-3)).toBe(true);
    expect(land.seamCover).toBe(true);
  });

  it('criterion 17: an Arctic coast in EPSG:3413 is closed and in place, checked against the textbook formula', () => {
    const greenland: Position[] = [[-55, 60], [-20, 60], [-20, 83], [-55, 83], [-55, 60]];
    const [ring] = layer(prepareVector(SOURCE, [polygon(greenland)], arctic), 'land').polygons[0] ?? [];
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    const [ex, ey] = textbook.polarStereographic3413(-20, 83);
    expect(ring?.some(([x, y]) => Math.abs(x - ex) < 1 && Math.abs(y - ey) < 1)).toBe(true);
  });

  it('draws MultiPolygons and MultiLineStrings, holes included, and ignores features of unknown layers', () => {
    const outer: Position[] = [[0, 50], [10, 50], [10, 60], [0, 60], [0, 50]];
    const hole: Position[] = [[2, 52], [4, 52], [4, 54], [2, 52]];
    const prepared = prepareVector(SOURCE, [
      { layer: 'land', geometry: { type: 'MultiPolygon', coordinates: [[outer, hole], [outer]] } },
      { layer: 'coastline', geometry: { type: 'MultiLineString', coordinates: [[[0, 50], [10, 50]], [[0, 60], [10, 60]]] } },
      { layer: 'rivers', geometry: { type: 'LineString', coordinates: [[0, 50], [1, 51]] } },
    ], mercator);
    expect(layer(prepared, 'land').polygons.map((p) => p.length)).toEqual([2, 1]);
    expect(layer(prepared, 'coastline').lines).toHaveLength(2);
  });
});

describe('vector backgrounds: clipping in lon/lat', () => {
  const extent = [-180, 30, 180, 90] as const;

  it('cuts a ring at the extent and closes it', () => {
    expect(clipRing([[0, 20], [10, 20], [10, 40], [0, 40], [0, 20]], extent)).toEqual([[0, 30], [10, 30], [10, 40], [0, 40], [0, 30]]);
    expect(clipRing([[0, 0], [10, 0], [10, 10], [0, 0]], extent)).toEqual([]);
  });

  it('cuts a line into the pieces inside the extent', () => {
    expect(clipLine([[0, 40], [0, 20], [10, 20], [10, 40]], extent)).toEqual([[[0, 40], [0, 30]], [[10, 30], [10, 40]]]);
    expect(clipLine([[0, 40], [5, 50], [10, 60]], extent)).toEqual([[[0, 40], [5, 50], [10, 60]]]);
    expect(clipLine([[0, 0], [10, 10]], extent)).toEqual([]);
  });

  it('densifies straight in lon/lat, at most one degree a step', () => {
    expect(densify([[0, 49], [3, 49]])).toEqual([[0, 49], [1, 49], [2, 49], [3, 49]]);
    expect(densify([[0, 0], [0.5, 0.5]])).toEqual([[0, 0], [0.5, 0.5]]);
    expect(densify([[-180, -80], [180, -80]])).toHaveLength(361); // e.g. the bottom edge of a clipped Antarctica in EPSG:3857
  });

  it('cuts the run down ±180° to the pole and back out of a lon/lat ring, south and north, also across its start', () => {
    const run: [number, number][] = [[180, -80], [180, -89.9989], [0, -89.9989], [-180, -89.9989], [-180, -85], [-180, -80]];
    const coast: [number, number][] = [[-90, -70], [0, -65], [90, -70]];
    expect(withoutPoleCut([...run, ...coast, run[0] as [number, number]])).toEqual([[-180, -80], ...coast, [180, -80]]);
    const rotated = [...coast.slice(1), ...run, coast[0] as [number, number]];
    expect(withoutPoleCut([...rotated, rotated[0] as [number, number]])).toEqual([[-180, -80], [-90, -70], [0, -65], [90, -70], [180, -80]]);
    const north: [number, number][] = [[180, 80], [180, 89.9989], [0, 89.9989], [-180, 89.9989], [-180, 80], [-90, 70], [0, 65], [90, 70], [180, 80]];
    expect(withoutPoleCut(north)).toEqual([[-180, 80], [-90, 70], [0, 65], [90, 70], [180, 80]]);
  });

  it('cuts nothing from a ring without a pole run: no pole point, a point near the pole only, or all of it on the cut', () => {
    expect(withoutPoleCut([[170, 65], [180, 65], [180, 70], [170, 70], [170, 65]])).toBeNull();
    expect(withoutPoleCut([[10, -89.995], [20, -80], [30, -80], [10, -89.995]])).toBeNull();
    expect(withoutPoleCut([[-180, -90], [180, -90], [180, -70], [-180, -70], [-180, -90]])).toBeNull();
  });

  it('keeps 360° parallel edges in a polar projection when nothing is cut: a 4-corner band is a disc, a band ring an annulus (review R1)', () => {
    const disc = layer(prepareVector(SOURCE, [polygon([[-180, -90], [180, -90], [180, -70], [-180, -70], [-180, -90]])], antarctic), 'land').polygons;
    expect(disc).toHaveLength(1);
    const discRing = disc[0]?.[0] ?? [];
    expect(Math.max(...discRing.map(fromPole))).toBeCloseTo(fromPole(textbook.polarStereographic3031(0, -70)), 0);
    expect(discRing.length).toBeGreaterThan(300); // the parallel at 70° S, every degree
    const band = layer(prepareVector(SOURCE, [polygon([[-180, -80], [-180, -70], [-90, -70], [0, -70], [90, -70], [180, -70], [180, -80], [-180, -80]])], antarctic), 'land').polygons;
    const bandRing = band[0]?.[0] ?? [];
    const radii = bandRing.map(fromPole);
    const inner = fromPole(textbook.polarStereographic3031(0, -80));
    expect(radii.filter((r) => Math.abs(r - inner) < 1).length).toBeGreaterThan(300); // the inner edge along 80° S is there too
    expect(Math.min(...radii)).toBeCloseTo(inner, 0);
  });

  it('a hole keeps its shape when its outer ring is cut', () => {
    const outer: Position[] = [[180, -80], [180, -89.9989], [-180, -89.9989], [-180, -80], [-90, -70], [0, -65], [90, -70], [180, -80]];
    const hole: Position[] = [[10, -75], [20, -75], [20, -72], [10, -72], [10, -75]];
    const [prepared] = layer(prepareVector(SOURCE, [{ layer: 'land', geometry: { type: 'Polygon', coordinates: [outer, hole] } }], antarctic), 'land').polygons;
    expect(prepared).toHaveLength(2);
    const [hx, hy] = textbook.polarStereographic3031(20, -72);
    expect(prepared?.[1]?.some(([x, y]) => Math.abs(x - hx) < 1 && Math.abs(y - hy) < 1)).toBe(true);
  });

  it('removes zero-width slits from a projected ring, also across its start', () => {
    const square: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(closedRing([...square, [0, 0]])).toEqual([...square, [0, 0]]);
    // A slit from (10, 10) out to (20, 20) and back, as a cut to the pole leaves it.
    expect(closedRing([[0, 0], [10, 0], [10, 10], [15, 15], [20, 20], [15, 15], [10, 10], [0, 10], [0, 0]])).toEqual([...square, [0, 0]]);
    expect(closedRing([[5, 5], [0, 0], [10, 0], [10, 10], [0, 10], [0, 0], [5, 5]])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
    expect(closedRing([[0, 0], [10, 0], [0, 0]])).toEqual([]);
  });
});
