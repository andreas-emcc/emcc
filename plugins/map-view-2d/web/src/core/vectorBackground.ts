/**
 * Vector background maps (brief function 11, ADR-0025): a provider's lon/lat features, prepared
 * once per projection as plain projected coordinates, without OpenLayers.
 *
 * - **Edges are straight in lon/lat** (a parallel stays a parallel), unlike objects' geodesic
 *   edges. So clipping is done in lon/lat, where it is exact, and long edges are densified in
 *   lon/lat before projecting, so they bend correctly in polar projections.
 * - **Clipping** to the projection's `worldExtent` keeps every point where the projection is
 *   defined (Antarctica in EPSG:3857 and EPSG:3413).
 * - **Antimeridian and poles:** data is cut at ±180°, and a polygon around a pole runs along
 *   latitude ±90° (Natural Earth: −89.9989°, a circle of about 120 m). In a projection where the
 *   pole is a point and ±180° is one line (one that does not repeat sideways and whose world extent
 *   reaches a pole: a polar one, or a regional one reaching ±90°), the run from the coast down
 *   ±180° to the pole and back up is a slit; it is cut out in lon/lat before projecting, keeping
 *   its two coast ends (the two sides need not share points: Natural Earth's do not), and the edge
 *   joining those ends is not densified. Zero-width slits left after projecting are removed too.
 *   Pieces cut at ±180° (e.g. Chukotka) stay separate polygons that meet exactly; a fill-only
 *   layer gets an outline in its own fill colour (`seamCover`), so the line where they meet does
 *   not show.
 */
import type { Position, Style, VectorFeature, VectorGeometry, VectorLayer } from '@emc2/plugin-sdk';
import { rgba, type Dash, type Rgba } from './appearance.ts';
import type { Projection } from './projections.ts';
import type { Extent } from './settings.ts';

/** Largest step between two points of a vector background before projecting, in degrees of longitude or latitude. */
export const VECTOR_STEP_DEGREES = 1;

/** Projected x/y. */
export type XY = readonly [number, number];

/** A polygon as projected rings, each closed (first point equal to the last); the first is the outer one. */
export type PreparedPolygon = readonly (readonly XY[])[];

export interface PreparedVectorLayer {
  readonly id: string;
  /** Null: not filled. */
  readonly fill: Rgba | null;
  /** Null: no outline (a polygon layer that is only filled). */
  readonly stroke: Rgba | null;
  readonly strokeWidth: number;
  readonly dash: Dash;
  /** Fill-only polygons, opaque: drawn with a thin outline in the fill colour, so the cuts at ±180° do not show. */
  readonly seamCover: boolean;
  readonly polygons: readonly PreparedPolygon[];
  readonly lines: readonly (readonly XY[])[];
}

/** A vector background ready for one projection. */
export interface PreparedVector {
  readonly projection: string;
  /** The colour under all layers (e.g. water), or null. */
  readonly background: Rgba | null;
  readonly layers: readonly PreparedVectorLayer[];
}

const DEFAULT_LINE_WIDTH = 1;
/** Latitudes at least this far north or south count as the pole (Natural Earth runs at ±89.9989°). */
const POLE_LATITUDE = 89.99;
/** Projected points closer than this (in metres) are the same point. */
const SAME = 1e-3;

/** Prepares a vector source's features for a projection, layer by layer in the source's order (the first at the bottom). */
export function prepareVector(
  source: { readonly background?: string; readonly layers: readonly VectorLayer[] },
  features: readonly VectorFeature[],
  projection: Projection,
): PreparedVector {
  const byLayer = new Map<string, VectorFeature[]>();
  for (const feature of features) {
    const list = byLayer.get(feature.layer);
    if (list === undefined) byLayer.set(feature.layer, [feature]);
    else list.push(feature);
  }
  const extent = projection.def.worldExtent;
  const layers = source.layers.map((layer) => {
    const polygons: PreparedPolygon[] = [];
    const lines: XY[][] = [];
    for (const { geometry } of byLayer.get(layer.id) ?? []) {
      for (const polygon of polygonsOf(geometry)) {
        const prepared = preparePolygon(polygon, extent, projection);
        if (prepared !== null) polygons.push(prepared);
      }
      for (const line of linesOf(geometry)) lines.push(...prepareLine(line, extent, projection));
    }
    return { id: layer.id, ...look(layer.style), polygons, lines };
  });
  return { projection: projection.def.code, background: source.background === undefined ? null : rgba(source.background, 1), layers };
}

function look(style: Style): Omit<PreparedVectorLayer, 'id' | 'polygons' | 'lines'> {
  const fill = style.fillColor === undefined ? null : rgba(style.fillColor, style.fillOpacity ?? 1);
  const stroke = style.strokeColor === undefined ? null : rgba(style.strokeColor, style.strokeOpacity);
  const width = style.strokeWidth !== undefined && Number.isFinite(style.strokeWidth) ? Math.min(20, Math.max(0, style.strokeWidth)) : DEFAULT_LINE_WIDTH;
  const dash: Dash = style.strokeDash === 'dash' ? 1 : style.strokeDash === 'dot' ? 2 : 0;
  return { fill, stroke, strokeWidth: width, dash, seamCover: fill !== null && stroke === null && fill[3] === 1 };
}

function polygonsOf(geometry: VectorGeometry): readonly (readonly (readonly Position[])[])[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function linesOf(geometry: VectorGeometry): readonly (readonly Position[])[] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function preparePolygon(rings: readonly (readonly Position[])[], extent: Extent, projection: Projection): PreparedPolygon | null {
  const result: XY[][] = [];
  const polar = isPolar(projection);
  for (const [index, ring] of rings.entries()) {
    const clipped = clipRing(ring, extent);
    const cut = polar && clipped.length > 0 ? withoutPoleCut(clipped) : null;
    // A cut ring's closing edge joins its two ends on ±180°, one line here: not densified once
    // around the parallel. Every other edge is densified (conformance review R1).
    const path = cut === null ? densify(clipped) : cut.length < 3 ? [] : [...densify(cut), cut[0] ?? [0, 0]];
    const projected = path.length === 0 ? [] : closedRing(project(path, projection));
    if (projected.length > 0) result.push(projected);
    else if (index === 0) return null; // without its outer ring the polygon is gone, holes and all
  }
  return result.length === 0 ? null : result;
}

/** True if the projection shows a pole as a point, with ±180° as one line: not repeating sideways, a pole inside its world extent. */
function isPolar(projection: Projection): boolean {
  const [, minLat, , maxLat] = projection.def.worldExtent;
  return !projection.wrapsX && (maxLat >= POLE_LATITUDE || minLat <= -POLE_LATITUDE);
}

/**
 * A closed lon/lat ring without the run that goes from the coast down ±180° to the pole, around
 * it and back up (a polygon around a pole, as data cut at ±180° draws it), as an open path from
 * the run's last point around the coast to its first point; the caller joins those two, which lie
 * on ±180°. Null if there is no such run: the ring does not reach the pole, reaches it without a
 * point on ±180°, or lies entirely on the cut.
 */
export function withoutPoleCut(ring: readonly LonLat[]): LonLat[] | null {
  const points = open([...ring]);
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n] ?? [0, 0];
  const onCut = ([lon, lat]: LonLat) => Math.abs(lat) >= POLE_LATITUDE || Math.abs(lon) === 180;
  const pole = points.findIndex(([, lat]) => Math.abs(lat) >= POLE_LATITUDE);
  if (pole < 0) return null;
  let start = pole;
  let end = pole;
  for (let steps = 0; steps < n && onCut(at(start - 1)); steps++) start--;
  for (let steps = 0; steps < n && onCut(at(end + 1)); steps++) end++;
  if (end - start + 1 >= n) return null; // all of it is on the cut: nothing to keep
  if (Math.abs(at(start)[0]) !== 180 || Math.abs(at(end)[0]) !== 180) return null; // a point near the pole, not a cut
  // From the run's last point around the coast to its first point; the run between them goes.
  const kept: LonLat[] = [];
  for (let i = end; i <= start + n; i++) kept.push(at(i));
  return kept;
}

function prepareLine(line: readonly Position[], extent: Extent, projection: Projection): XY[][] {
  return clipLine(line, extent)
    .map((piece) => dedupe(project(densify(piece), projection)))
    .filter((piece) => piece.length >= 2);
}

// ---- Clipping in lon/lat (exact: the edges are straight there) ----

type LonLat = readonly [number, number];

/**
 * A ring clipped to the extent (Sutherland–Hodgman, one side at a time), closed; empty if nothing
 * is left. Parts outside become edges along the extent's border, which is right for a fill.
 */
export function clipRing(ring: readonly Position[], [minLon, minLat, maxLon, maxLat]: Extent): LonLat[] {
  let points: LonLat[] = open(ring.map(([lon, lat]) => [lon, lat] as const));
  const sides: { inside: (p: LonLat) => boolean; cut: (a: LonLat, b: LonLat) => LonLat }[] = [
    { inside: (p) => p[0] >= minLon, cut: (a, b) => atLon(a, b, minLon) },
    { inside: (p) => p[0] <= maxLon, cut: (a, b) => atLon(a, b, maxLon) },
    { inside: (p) => p[1] >= minLat, cut: (a, b) => atLat(a, b, minLat) },
    { inside: (p) => p[1] <= maxLat, cut: (a, b) => atLat(a, b, maxLat) },
  ];
  for (const { inside, cut } of sides) {
    if (points.length === 0) break;
    const next: LonLat[] = [];
    points.forEach((current, i) => {
      const previous = points[(i + points.length - 1) % points.length] ?? current;
      if (inside(current)) {
        if (!inside(previous)) next.push(cut(previous, current));
        next.push(current);
      } else if (inside(previous)) {
        next.push(cut(previous, current));
      }
    });
    points = next;
  }
  return points.length < 3 ? [] : [...points, points[0] ?? [0, 0]];
}

/** The parts of a line inside the extent (Liang–Barsky per edge). */
export function clipLine(line: readonly Position[], [minLon, minLat, maxLon, maxLat]: Extent): LonLat[][] {
  const pieces: LonLat[][] = [];
  let piece: LonLat[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = a;
    const dx = b[0] - ax;
    const dy = b[1] - ay;
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    for (const [p, q] of [[-dx, ax - minLon], [dx, maxLon - ax], [-dy, ay - minLat], [dy, maxLat - ay]] as const) {
      if (p === 0) {
        if (q < 0) visible = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!visible || t0 > t1) {
      if (piece.length > 0) pieces.push(piece);
      piece = [];
      continue;
    }
    const start: LonLat = [ax + t0 * dx, ay + t0 * dy];
    const end: LonLat = [ax + t1 * dx, ay + t1 * dy];
    if (piece.length === 0 || t0 > 0) {
      if (piece.length > 0) pieces.push(piece);
      piece = [start];
    }
    piece.push(end);
    if (t1 < 1) {
      pieces.push(piece);
      piece = [];
    }
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces.filter((p) => p.length >= 2);
}

function atLon(a: LonLat, b: LonLat, lon: number): LonLat {
  const t = (lon - a[0]) / (b[0] - a[0]);
  return [lon, a[1] + t * (b[1] - a[1])];
}

function atLat(a: LonLat, b: LonLat, lat: number): LonLat {
  const t = (lat - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), lat];
}

/** A closed ring without its closing point. */
function open(ring: LonLat[]): LonLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first !== undefined && last !== undefined && ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

// ---- Densifying in lon/lat, projecting ----

/** Extra points along each edge, straight in lon/lat, so no step exceeds {@link VECTOR_STEP_DEGREES}. */
export function densify(path: readonly LonLat[], step = VECTOR_STEP_DEGREES): LonLat[] {
  const result: LonLat[] = [];
  path.forEach((point, i) => {
    const previous = path[i - 1];
    if (previous !== undefined) {
      const n = Math.ceil(Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1])) / step);
      for (let k = 1; k < n; k++) result.push([previous[0] + ((point[0] - previous[0]) * k) / n, previous[1] + ((point[1] - previous[1]) * k) / n]);
    }
    result.push(point);
  });
  return result;
}

function project(path: readonly LonLat[], projection: Projection): XY[] {
  const result: XY[] = [];
  for (const point of path) {
    const xy = projection.forward(point);
    if (xy !== null) result.push(xy);
  }
  return result;
}

function same(a: XY | undefined, b: XY | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME;
}

function dedupe(path: readonly XY[]): XY[] {
  const result: XY[] = [];
  for (const point of path) if (!same(result[result.length - 1], point)) result.push(point);
  return result;
}

/**
 * A projected ring without zero-width slits, closed; empty if less than a triangle is left. A slit
 * is a run that goes out and comes back along the same points: the two sides of a cut at ±180°
 * and the pole edge of a polygon around a pole, in a polar projection.
 */
export function closedRing(ring: readonly XY[]): XY[] {
  const points: XY[] = [];
  for (const point of ring) {
    if (same(points[points.length - 1], point)) continue;
    if (same(points[points.length - 2], point)) {
      points.pop();
      continue;
    }
    points.push(point);
  }
  // The ring is cyclic: a slit can run across its start.
  for (;;) {
    if (points.length < 3) return [];
    if (same(points[0], points[points.length - 1])) points.pop();
    else if (same(points[points.length - 2], points[0])) points.pop();
    else if (same(points[points.length - 1], points[1])) points.shift();
    else break;
  }
  return [...points, points[0] ?? [0, 0]];
}
