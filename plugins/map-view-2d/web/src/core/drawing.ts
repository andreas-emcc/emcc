/**
 * The drawing service's geometry (brief function 17, ADR-0033 point 3): what the user drew, as the
 * engine reports it in map coordinates, turned into data model geometry in lon/lat. No OpenLayers.
 *
 * Owner, 2026-10-16: circles, ellipses, squares and rectangles are pressed and dragged; an ellipse
 * fits the dragged box with its axes along the screen; a square is upright, from corner to corner,
 * with the longer drag length as its side; a drag released where the projection cannot show a
 * point draws nothing.
 */
import type { DrawKind, DrawnGeometry, Geometry, Position } from '@emc2/plugin-sdk';
import { fillFaces } from './crossing.ts';
import { bearing, circleRing, densifyPath, destination, distance, ellipseRing } from './geodesic.ts';
import type { Projection } from './projections.ts';

/** A point in the map's own coordinates. */
export type XY = readonly [number, number];

/** What the engine reports when the user finishes drawing. */
export type DrawnShape =
  | { readonly kind: 'polygon' | 'line'; readonly points: readonly XY[] }
  | { readonly kind: 'circle'; readonly center: XY; readonly edge: XY }
  | { readonly kind: 'rectangle' | 'square' | 'ellipse'; readonly from: XY; readonly to: XY };

/** The kinds drawn by pressing and dragging; the others point by point (brief function 17). */
export const DRAGGED_KINDS: ReadonlySet<DrawKind> = new Set<DrawKind>(['circle', 'ellipse', 'square', 'rectangle']);

/** The square's far corner: its side the longer of the two drag lengths, so the sides are equal on screen. */
export function squareCorner(from: XY, to: XY): XY {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [from[0] + (dx < 0 ? -side : side), from[1] + (dy < 0 ? -side : side)];
}

/** The four corners of an upright box, counter-clockwise on screen. */
export function boxCorners(from: XY, to: XY): XY[] {
  const [x1, x2] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
  const [y1, y2] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

export type DrawResult = { readonly geometry: DrawnGeometry } | { readonly problem: string };

/** The drawn shape as data model geometry in lon/lat, or why there is none. */
export function drawnGeometry(shape: DrawnShape, projection: Projection): DrawResult {
  const toLonLat = (xys: readonly XY[]): Position[] | null => {
    const positions: Position[] = [];
    for (const xy of xys) {
      const p = projection.inverse(xy);
      if (p === null || !projection.isValid(p)) return null;
      positions.push(p);
    }
    return positions;
  };
  const outside = { problem: 'a point lies where this projection cannot show it' } as const;
  switch (shape.kind) {
    case 'polygon': {
      const points = distinct(shape.points);
      if (points.length > 1 && same(points[0], points[points.length - 1])) points.pop();
      if (points.length < 3 || !hasArea(points)) return { problem: 'the area has fewer than three distinct points, or no area' };
      const ring = toLonLat(points);
      return ring === null ? outside : { geometry: { type: 'Polygon', coordinates: [[...ring, ring[0] as Position]] } };
    }
    case 'line': {
      const points = distinct(shape.points);
      if (points.length < 2) return { problem: 'the line has fewer than two distinct points' };
      const line = toLonLat(points);
      return line === null ? outside : { geometry: { type: 'LineString', coordinates: line } };
    }
    case 'circle': {
      const ends = toLonLat([shape.center, shape.edge]);
      if (ends === null) return outside;
      const [center, edge] = ends as [Position, Position];
      const radius = distance(center, edge);
      return radius > 0 ? { geometry: { type: 'Circle', center, radius } } : { problem: 'the circle has no radius' };
    }
    case 'rectangle':
    case 'square': {
      const to = shape.kind === 'square' ? squareCorner(shape.from, shape.to) : shape.to;
      if (shape.from[0] === to[0] || shape.from[1] === to[1]) return { problem: 'the box has no area' };
      const ring = toLonLat(boxCorners(shape.from, to));
      return ring === null ? outside : { geometry: { type: 'Polygon', coordinates: [[...ring, ring[0] as Position]] } };
    }
    case 'ellipse': {
      const [x1, y1] = [Math.min(shape.from[0], shape.to[0]), Math.min(shape.from[1], shape.to[1])];
      const [x2, y2] = [Math.max(shape.from[0], shape.to[0]), Math.max(shape.from[1], shape.to[1])];
      if (x1 === x2 || y1 === y2) return { problem: 'the box has no area' };
      const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2];
      // The centre, the end of the horizontal axis (screen right) and of the vertical one (screen up).
      const points = toLonLat([[cx, cy], [x2, cy], [cx, y2], [x1, y1], [x2, y2]]);
      if (points === null) return outside;
      const [center, right, up] = points as [Position, Position, Position];
      const across = distance(center, right);
      const along = distance(center, up);
      if (across === 0 || along === 0) return { problem: 'the ellipse has no area' };
      const [major, minor, end] = across >= along ? [across, along, right] : [along, across, up];
      // The major axis as a bearing in [0, 180): an axis has two ends.
      const rotation = bearing(center, end) % 180;
      return { geometry: { type: 'Ellipse', center, semiMajorAxis: major, semiMinorAxis: minor, rotation } };
    }
  }
}

/**
 * A line continued (`MapView.append`, brief function 44): the line's own points, unchanged, followed by the added
 * ones in lon/lat, as drawing a line converts its points (a point twice in a row is one). Why not, when an added
 * point lies where the projection cannot show one, or none is added.
 */
export function appendedLine(own: readonly Position[], added: readonly XY[], projection: Projection): { readonly line: readonly Position[] } | { readonly problem: string } {
  const points = distinct(added);
  const last = own[own.length - 1];
  const lastXY = last === undefined ? null : projection.forward(last);
  // A first added point at the line's last point adds nothing.
  if (points.length > 0 && lastXY !== null && same(points[0], lastXY)) points.shift();
  if (points.length === 0) return { problem: 'no point was added' };
  const positions: Position[] = [];
  for (const xy of points) {
    const p = projection.inverse(xy);
    if (p === null || !projection.isValid(p)) return { problem: 'a point lies where this projection cannot show it' };
    positions.push(p);
  }
  return { line: [...own, ...positions] };
}

function same(a: XY | undefined, b: XY | undefined): boolean {
  return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}

/** The points without consecutive repeats (a double-click sets the last point twice). */
function distinct(points: readonly XY[]): XY[] {
  const result: XY[] = [];
  for (const p of points) if (!same(result[result.length - 1], p)) result.push(p);
  return result;
}

/**
 * Whether a ring encloses an area. A ring that crosses itself can have a signed area of nothing
 * and still enclose some: a bow tie with two equal lobes (T-111).
 */
function hasArea(points: readonly XY[]): boolean {
  return Math.abs(signedArea(points)) >= 1e-9 || fillFaces(points) !== null;
}

/** Twice the signed area of a ring in map coordinates (shoelace). */
function signedArea(points: readonly XY[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as XY;
    const b = points[(i + 1) % points.length] as XY;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/** The outline of a drawn area in lon/lat, as the map will draw it: for the preview while dragging. */
export function outlineOf(geometry: DrawnGeometry): Position[] {
  switch (geometry.type) {
    case 'Circle':
      return circleRing(geometry.center, geometry.radius);
    case 'Ellipse':
      return ellipseRing(geometry.center, geometry.semiMajorAxis, geometry.semiMinorAxis, geometry.rotation);
    case 'Polygon':
      return densifyPath(geometry.coordinates[0] ?? []);
    case 'LineString':
      return densifyPath(geometry.coordinates);
  }
}

/**
 * A shape being edited (brief function 17), in map coordinates: the points the user drags. A
 * polygon's rings and a line's points directly; a circle's centre and one point on it; an
 * ellipse's centre and the ends of its two axes; a point to move.
 */
export type EditShape =
  | { readonly kind: 'polygon'; readonly rings: readonly (readonly XY[])[] }
  | { readonly kind: 'line'; readonly points: readonly XY[] }
  | { readonly kind: 'point'; readonly at: XY }
  | { readonly kind: 'circle'; readonly center: XY; readonly edge: XY }
  | { readonly kind: 'ellipse'; readonly center: XY; readonly major: XY; readonly minor: XY };

/** The shape to edit for a geometry, in map coordinates; null for a geometry the service does not edit, or one with a point this projection cannot show. */
export function editShapeOf(geometry: Geometry, projection: Projection): EditShape | null {
  const xys = (positions: readonly Position[]): XY[] | null => {
    const result: XY[] = [];
    for (const p of positions) {
      // A point outside the projection's world extent cannot be dragged here (review finding 5, part C).
      const xy = projection.isValid(p) ? projection.forward(p) : null;
      if (xy === null) return null;
      result.push(xy);
    }
    return result;
  };
  switch (geometry.type) {
    case 'Polygon': {
      const rings = geometry.coordinates.map((ring) => xys(ring));
      return rings.some((ring) => ring === null) ? null : { kind: 'polygon', rings: rings as XY[][] };
    }
    case 'LineString': {
      const points = xys(geometry.coordinates);
      return points === null ? null : { kind: 'line', points };
    }
    case 'Point': {
      const at = xys([geometry.coordinates]);
      return at === null ? null : { kind: 'point', at: at[0] as XY };
    }
    case 'Circle': {
      const points = xys([geometry.center, destination(geometry.center, 90, geometry.radius)]);
      return points === null ? null : { kind: 'circle', center: points[0] as XY, edge: points[1] as XY };
    }
    case 'Ellipse': {
      const { center, semiMajorAxis, semiMinorAxis, rotation } = geometry;
      const points = xys([center, destination(center, rotation, semiMajorAxis), destination(center, rotation + 90, semiMinorAxis)]);
      return points === null ? null : { kind: 'ellipse', center: points[0] as XY, major: points[1] as XY, minor: points[2] as XY };
    }
    default:
      return null;
  }
}

/**
 * The shape to edit for the control points of a `core.multipoint` stored as a `MultiPoint` (SDK 1.4.0,
 * brief function 32): one point is a point to move, several are the points of a line, each with a handle.
 */
export function multiPointEditShape(positions: readonly Position[], projection: Projection): EditShape | null {
  const xys: XY[] = [];
  for (const p of positions) {
    const xy = projection.isValid(p) ? projection.forward(p) : null;
    if (xy === null) return null;
    xys.push(xy);
  }
  if (xys.length === 0) return null;
  return xys.length === 1 ? { kind: 'point', at: xys[0] as XY } : { kind: 'line', points: xys };
}

/** The `MultiPoint` an edited shape of {@link multiPointEditShape} stands for: the points kept as they are, in order. */
export function multiPointGeometry(shape: EditShape, projection: Projection): { readonly geometry: Geometry } | { readonly problem: string } {
  const xys = shape.kind === 'point' ? [shape.at] : shape.kind === 'line' ? shape.points : [];
  const positions: Position[] = [];
  for (const xy of xys) {
    const p = projection.inverse(xy);
    if (p === null || !projection.isValid(p)) return { problem: 'a point lies where this projection cannot show it' };
    positions.push(p);
  }
  return positions.length === 0 ? { problem: 'the graphic has no point' } : { geometry: { type: 'MultiPoint', coordinates: positions } };
}

/**
 * A circle's or ellipse's handles after a drag, kept consistent, with the outline to show (map
 * coordinates): an ellipse's minor end stays at right angles to the major axis, and the two swap
 * when the minor is dragged past the major (data model: semiMinorAxis <= semiMajorAxis).
 */
export function reshape(shape: EditShape, projection: Projection): { readonly shape: EditShape; readonly outline: XY[] } | null {
  if (shape.kind !== 'circle' && shape.kind !== 'ellipse') return null;
  const result = editedGeometry(shape, projection);
  if ('problem' in result) return null;
  const geometry = result.geometry;
  const outline = outlineOf(geometry as DrawnGeometry).map((p) => projection.forward(p)).filter((xy) => xy !== null);
  if (geometry.type === 'Ellipse') {
    const fixed = editShapeOf(geometry, projection);
    return fixed === null ? null : { shape: fixed, outline };
  }
  return { shape, outline };
}

/** The edited shape as data model geometry in lon/lat, or why there is none. */
export function editedGeometry(shape: EditShape, projection: Projection): { readonly geometry: Geometry } | { readonly problem: string } {
  const toLonLat = (xys: readonly XY[]): Position[] | null => {
    const positions: Position[] = [];
    for (const xy of xys) {
      const p = projection.inverse(xy);
      if (p === null || !projection.isValid(p)) return null;
      positions.push(p);
    }
    return positions;
  };
  const outside = { problem: 'a point lies where this projection cannot show it' } as const;
  switch (shape.kind) {
    case 'polygon': {
      const rings: Position[][] = [];
      for (const ring of shape.rings) {
        const points = distinct(ring);
        if (points.length > 1 && same(points[0], points[points.length - 1])) points.pop();
        if (points.length < 3 || !hasArea(points)) return { problem: 'a ring has fewer than three distinct points, or no area' };
        const positions = toLonLat(points);
        if (positions === null) return outside;
        rings.push([...positions, positions[0] as Position]);
      }
      return rings.length === 0 ? { problem: 'the area has no ring' } : { geometry: { type: 'Polygon', coordinates: rings } };
    }
    case 'line': {
      const points = distinct(shape.points);
      if (points.length < 2) return { problem: 'the line has fewer than two distinct points' };
      const positions = toLonLat(points);
      return positions === null ? outside : { geometry: { type: 'LineString', coordinates: positions } };
    }
    case 'point': {
      const at = toLonLat([shape.at]);
      return at === null ? outside : { geometry: { type: 'Point', coordinates: at[0] as Position } };
    }
    case 'circle': {
      const ends = toLonLat([shape.center, shape.edge]);
      if (ends === null) return outside;
      const radius = distance(ends[0] as Position, ends[1] as Position);
      return radius > 0 ? { geometry: { type: 'Circle', center: ends[0] as Position, radius } } : { problem: 'the circle has no radius' };
    }
    case 'ellipse': {
      const ends = toLonLat([shape.center, shape.major, shape.minor]);
      if (ends === null) return outside;
      const [center, majorEnd, minorEnd] = ends as [Position, Position, Position];
      const a = distance(center, majorEnd);
      const b = distance(center, minorEnd);
      if (a === 0 || b === 0) return { problem: 'the ellipse has no area' };
      // The longer axis is the major one: dragging the minor past it swaps them.
      const [major, minor, end] = a >= b ? [a, b, majorEnd] : [b, a, minorEnd];
      return { geometry: { type: 'Ellipse', center, semiMajorAxis: major, semiMinorAxis: minor, rotation: bearing(center, end) } };
    }
  }
}

/**
 * A circle or ellipse moved to a new centre (map coordinates), keeping its geodesic radius, axes
 * and rotation from before the move (review finding 1, part C): moving its handles by the same
 * map vector would change its size, since metres per map unit differ across the map (and in a
 * polar projection, where north points). Polygons and lines move as on screen. Null when the new
 * centre cannot be shown.
 */
export function moveRound(before: EditShape, center: XY, projection: Projection): EditShape | null {
  if (before.kind !== 'circle' && before.kind !== 'ellipse') return null;
  const result = editedGeometry(before, projection);
  const at = projection.inverse(center);
  if ('problem' in result || at === null || !projection.isValid(at)) return null;
  const geometry = result.geometry;
  return geometry.type === 'Circle' || geometry.type === 'Ellipse' ? editShapeOf({ ...geometry, center: at }, projection) : null;
}
