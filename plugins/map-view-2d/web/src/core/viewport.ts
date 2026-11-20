/**
 * The viewport as the SDK defines it (`Viewport`): centre, resolution in metres per CSS pixel at
 * the centre, projection code, and the visible area as a closed lon/lat ring whose inside is the
 * side that contains the centre. Plain functions over a view state, without OpenLayers. The map is
 * never rotated.
 */
import type { Pixel, Position } from '@emc2/plugin-sdk';
import { angularDistance, distance } from './geodesic.ts';
import type { Projection } from './projections.ts';
import type { Extent } from './settings.ts';

/** The view in projected units, as the engine knows it. */
export interface ViewState {
  /** Map size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Projected x/y of the centre. */
  readonly center: readonly [number, number];
  /** Projected units per CSS pixel. */
  readonly resolution: number;
}

/** Longest edge of the visible area on the ground, in degrees of arc (about 220 km). */
export const MAX_EDGE_DEGREES = 2;

/** How often one border segment is halved at most (2^10 pieces). */
const MAX_EDGE_SPLITS = 10;

const RAD = Math.PI / 180;

export function pixelToMap(view: ViewState, [px, py]: Pixel): [number, number] {
  return [view.center[0] + (px - view.width / 2) * view.resolution, view.center[1] - (py - view.height / 2) * view.resolution];
}

export function mapToPixel(view: ViewState, [x, y]: readonly [number, number]): Pixel {
  return [(x - view.center[0]) / view.resolution + view.width / 2, (view.center[1] - y) / view.resolution + view.height / 2];
}

/**
 * Metres on the ground per CSS pixel at the centre: the mean of the great-circle lengths of one
 * pixel across and one pixel down (as OpenLayers' `getPointResolution` does). Falls back to the
 * projected resolution where the centre cannot be converted.
 */
export function groundResolution(projection: Projection, center: readonly [number, number], resolution: number): number {
  const half = resolution / 2;
  const [x, y] = center;
  const w = projection.inverse([x - half, y]);
  const e = projection.inverse([x + half, y]);
  const s = projection.inverse([x, y - half]);
  const n = projection.inverse([x, y + half]);
  if (w === null || e === null || s === null || n === null) return resolution;
  const ground = (distance(w, e) + distance(s, n)) / 2;
  return ground > 0 ? ground : resolution;
}

/** A view in projected units, without the map's size. */
export interface ProjectedView {
  readonly center: readonly [number, number];
  readonly resolution: number;
}

/**
 * Whether a view is still `reference` up to the engine's own rounding: the centre within a millionth
 * of a pixel, the resolution within a billionth.
 */
export function sameView(view: ProjectedView, reference: ProjectedView): boolean {
  const pixel = reference.resolution;
  return Math.hypot(view.center[0] - reference.center[0], view.center[1] - reference.center[1]) <= pixel * 1e-6 && Math.abs(view.resolution - pixel) <= pixel * 1e-9;
}

/** The projected resolution that gives `metresPerPixel` on the ground at `center` (linear locally). */
export function resolutionForGround(projection: Projection, center: readonly [number, number], metresPerPixel: number): number {
  // Ground metres per projected unit at the centre.
  return metresPerPixel / groundResolution(projection, center, 1);
}

/**
 * The visible area: the screen border walked clockwise from the top left corner, `samplesPerEdge`
 * points per edge, clamped to the part of the map that exists and converted to lon/lat (longitude
 * in [-180, 180]), then closed. Vertically that is the projection's extent; sideways too, unless
 * the map repeats sideways (`wrapsX`), where it is one world's width around the centre. Where two
 * consecutive points are more than `MAX_EDGE_DEGREES` apart on the ground (a view zoomed out far,
 * or wider than the world), the border between them is split on the screen until they are not, so
 * reading the edges as geodesics (model rule 10) matches the screen closely at every zoom. Around a
 * pole, centred or not, the ring encloses the pole; across the antimeridian its edges are the short
 * ones over it. A view wider than the world gives the band between the extent's latitudes, with the
 * meridian opposite the centre walked down and up again. Points that cannot be converted are left
 * out; with fewer than three points left the result is empty.
 */
export function visibleArea(view: ViewState, projection: Projection, samplesPerEdge = 8): Position[] {
  const { width: w, height: h } = view;
  const border: Pixel[] = [];
  for (let i = 0; i < samplesPerEdge; i++) border.push([(w * i) / samplesPerEdge, 0]);
  for (let i = 0; i < samplesPerEdge; i++) border.push([w, (h * i) / samplesPerEdge]);
  for (let i = 0; i < samplesPerEdge; i++) border.push([w - (w * i) / samplesPerEdge, h]);
  for (let i = 0; i < samplesPerEdge; i++) border.push([0, h - (h * i) / samplesPerEdge]);

  const [minX, minY, maxX, maxY] = projection.def.extent;
  const half = (maxX - minX) / 2;
  const limits: Extent = projection.wrapsX ? [view.center[0] - half, minY, view.center[0] + half, maxY] : projection.def.extent;
  const toLonLat = (pixel: Pixel): Position | null => projection.inverse(clamp(pixelToMap(view, pixel), limits));
  const ring: Position[] = [];
  const add = (lonLat: Position | null): void => {
    if (lonLat === null) return;
    const previous = ring[ring.length - 1];
    if (previous !== undefined && samePosition(previous, lonLat)) return;
    ring.push(lonLat);
  };
  // Adds the points after `a` up to and including `b`, splitting the screen segment where it is long on the ground.
  const walk = (a: Pixel, la: Position | null, b: Pixel, lb: Position | null, splits: number): void => {
    if (la !== null && lb !== null && splits < MAX_EDGE_SPLITS && angularDistance(la, lb) > MAX_EDGE_DEGREES * RAD) {
      const middle: Pixel = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const lm = toLonLat(middle);
      walk(a, la, middle, lm, splits + 1);
      walk(middle, lm, b, lb, splits + 1);
      return;
    }
    add(lb);
  };
  const lonLats = border.map(toLonLat);
  add(lonLats[0] ?? null);
  for (let i = 0; i < border.length; i++) {
    const next = (i + 1) % border.length;
    const a = border[i];
    const b = border[next];
    if (a !== undefined && b !== undefined) walk(a, lonLats[i] ?? null, b, lonLats[next] ?? null, 0);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first !== undefined && last !== undefined && samePosition(first, last)) ring.pop();
  if (ring.length < 3 || first === undefined) return [];
  ring.push(first);
  return ring;
}

function clamp([x, y]: readonly [number, number], extent: Extent): [number, number] {
  return [Math.min(Math.max(x, extent[0]), extent[2]), Math.min(Math.max(y, extent[1]), extent[3])];
}

function samePosition(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/** The projected resolution of a zoom level, as OpenLayers counts them: zoom 0 shows the extent's width on 256 pixels. */
export function resolutionForZoom(projection: Projection, zoom: number): number {
  const [minX, , maxX] = projection.def.extent;
  return (maxX - minX) / 256 / 2 ** zoom;
}

/**
 * Where a view goes for a centre in lon/lat (brief function 2, `goTo`): that centre where possible,
 * otherwise the nearest point the projection can show, and the same metres per pixel there. The
 * centre is clamped into the world extent in lon/lat, then into the extent in projected units: in
 * a projection that does not repeat sideways the map's centre stays inside the extent (EPSG:3413
 * reaches about 50° N on its axes, 39° N at the corners, although its world extent goes to 30° N).
 */
export function viewIn(projection: Projection, center: Position, metresPerPixel: number): { center: [number, number]; resolution: number } {
  const [minLon, minLat, maxLon, maxLat] = projection.def.worldExtent;
  const clamped: Position = [Math.min(Math.max(center[0], minLon), maxLon), Math.min(Math.max(center[1], minLat), maxLat)];
  const projected = projection.forward(clamped) ?? projection.forward([(minLon + maxLon) / 2, (minLat + maxLat) / 2]) ?? [0, 0];
  const [minX, minY, maxX, maxY] = projection.def.extent;
  const x = projection.wrapsX ? projected[0] : Math.min(Math.max(projected[0], minX), maxX);
  const xy: [number, number] = [x, Math.min(Math.max(projected[1], minY), maxY)];
  const resolution = resolutionForGround(projection, xy, metresPerPixel);
  return { center: xy, resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : resolutionForZoom(projection, 3) };
}
