// The geometry the live subscription and the "not in view" mark need (brief, function 7).
//
// - The edited shape is followed with a small fixed area round its centroid. The object store
//   matches a shape when its bound, a cap round its vertex centroid (or the centre of a circle, an
//   ellipse or an arc band), reaches the ring, so a ring round the centroid always holds the shape,
//   however large it is.
// - "Not in view": none of the shape's points is inside the map's visible area, by a point-in-ring
//   test of our own (longitudes unwrapped round the view's centre, the poles handled).
//
// Everything is WGS84 longitude, latitude, on a sphere (the ring is 500 m, so the ellipsoid does not matter).
import type { Area, Geometry, Position } from '@emc2/plugin-sdk';

const EARTH_RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Half the side of the ring round the centroid, in metres: "a small ring". */
export const RING_HALF_METRES = 500;

type Vec = readonly [number, number, number];

function toVec([lon, lat]: Position): Vec {
  const φ = lat * RAD;
  const λ = lon * RAD;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function toPosition([x, y, z]: Vec): Position {
  return [Math.atan2(y, x) * DEG, Math.atan2(z, Math.hypot(x, y)) * DEG];
}

/** A longitude brought into -180 to 180. */
export function wrapLongitude(lon: number): number {
  return Math.abs(lon) <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The difference of two longitudes, -180 to 180. */
function lonDelta(lon: number, from: number): number {
  return wrapLongitude(lon - from);
}

/** The shortest distance between two positions in metres (haversine). */
export function distanceMetres(a: Position, b: Position): number {
  const dφ = (b[1] - a[1]) * RAD;
  const dλ = lonDelta(b[0], a[0]) * RAD;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The position `metres` away from `from` along `bearing` (degrees clockwise from north). */
export function destination(from: Position, bearing: number, metres: number): Position {
  const δ = metres / EARTH_RADIUS;
  const θ = bearing * RAD;
  const φ1 = from[1] * RAD;
  const λ1 = from[0] * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [wrapLongitude(λ2 * DEG), φ2 * DEG];
}

/** The centroid of a list of positions: the mean of their unit vectors, so the antimeridian and the poles are no special case. */
function vertexCentroid(positions: readonly Position[]): Position {
  const first = positions[0];
  if (first === undefined) return [0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const position of positions) {
    const [vx, vy, vz] = toVec(position);
    x += vx;
    y += vy;
    z += vz;
  }
  const length = Math.hypot(x, y, z);
  return length < 1e-9 ? [first[0], first[1]] : toPosition([x / length, y / length, z / length]);
}

/**
 * The centroid the object store takes a shape's bound round: the vertex centroid of a line, a
 * polygon's exterior ring, a corridor or a set of points; the centre of a point, a circle, an
 * ellipse or an arc band.
 */
export function centroidOf(geometry: Geometry): Position {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates[0], geometry.coordinates[1]];
    case 'Circle':
    case 'Ellipse':
    case 'ArcBand':
      return [geometry.center[0], geometry.center[1]];
    case 'MultiPoint':
    case 'LineString':
    case 'Corridor':
      return vertexCentroid(geometry.coordinates);
    case 'Polygon':
      return vertexCentroid(geometry.coordinates[0] ?? []);
  }
}

/** The small fixed area round a centroid: a ring of {@link RING_HALF_METRES} half side, closed, with `inside` at the centroid. */
export function areaRound(centroid: Position): Area {
  // The corners are found by bearing and distance from the centroid, so the ring is the same small
  // square at a pole and across the antimeridian, where steps in degrees of longitude would not be.
  const corner = (bearing: number): Position => destination(centroid, bearing, RING_HALF_METRES * Math.SQRT2);
  const ring = [corner(225), corner(135), corner(45), corner(315), corner(225)];
  return { ring, inside: [centroid[0], centroid[1]] };
}

/** True when the centroid is still inside the ring round `centre`: the area then still holds the shape. */
export function withinRing(centre: Position, centroid: Position): boolean {
  return distanceMetres(centre, centroid) <= RING_HALF_METRES;
}

/** Eight points round a centre at `metres`, from `from` to `to` degrees (a full circle when not given). */
function round(centre: Position, metres: number, from = 0, to = 360): Position[] {
  const steps = Math.max(1, Math.ceil((to - from) / 45));
  const points: Position[] = [];
  for (let i = 0; i <= steps; i++) points.push(destination(centre, from + ((to - from) * i) / steps, metres));
  return points;
}

/** A position at `lon`, `lat` (wrapped into -180 to 180, clamped at the poles), with the altitude of `like`. */
function placed(like: Position, lon: number, lat: number): Position {
  const at: [number, number] = [wrapLongitude(lon), Math.max(-90, Math.min(90, lat))];
  const altitude = like[2];
  return altitude === undefined ? at : [at[0], at[1], altitude];
}

/** A position moved by degrees. */
function shifted(position: Position, dLon: number, dLat: number): Position {
  return placed(position, position[0] + dLon, position[1] + dLat);
}

/** The first position of a geometry: the one the map view's drag preview moves to the drop, and the others by the same difference. */
function firstPositionOf(geometry: Geometry): Position | undefined {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'Circle':
    case 'Ellipse':
    case 'ArcBand':
      return geometry.center;
    case 'MultiPoint':
    case 'LineString':
    case 'Corridor':
      return geometry.coordinates[0];
    case 'Polygon':
      return geometry.coordinates[0]?.[0];
  }
}

/**
 * The shape moved so that its first position is at `drop` (brief, function 16): every position moves
 * by the same difference in longitude and latitude, as the map view's preview shows it. A point,
 * the centre of a circle, an ellipse or an arc band is at the drop, and their other values stay.
 * Latitudes clamp at ±90, longitudes wrap into -180 to 180, altitudes stay. Null if the drop is not a
 * position, or the geometry has no position.
 */
export function moveGeometry(geometry: Geometry, drop: Position): Geometry | null {
  const first = firstPositionOf(geometry);
  if (first === undefined || !Number.isFinite(drop[0]) || !Number.isFinite(drop[1])) return null;
  const dLon = drop[0] - first[0];
  const dLat = drop[1] - first[1];
  const move = (p: Position): Position => shifted(p, dLon, dLat);
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: placed(geometry.coordinates, drop[0], drop[1]) };
    case 'Circle':
    case 'Ellipse':
    case 'ArcBand':
      return { ...geometry, center: placed(geometry.center, drop[0], drop[1]) };
    case 'MultiPoint':
    case 'LineString':
    case 'Corridor':
      return { ...geometry, coordinates: geometry.coordinates.map(move) };
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map(move)) };
  }
}

/** The points of a shape that decide whether it is in view: its vertices, and a ring of points on a circle, an ellipse or an arc band. */
export function viewPointsOf(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case 'Point':
      return [[geometry.coordinates[0], geometry.coordinates[1]]];
    case 'MultiPoint':
    case 'LineString':
    case 'Corridor':
      return geometry.coordinates.map((p) => [p[0], p[1]]);
    case 'Polygon':
      return (geometry.coordinates[0] ?? []).map((p) => [p[0], p[1]]);
    case 'Circle':
      return [[geometry.center[0], geometry.center[1]], ...round(geometry.center, geometry.radius)];
    case 'Ellipse': {
      const { semiMajorAxis: a, semiMinorAxis: b, rotation } = geometry;
      const points: Position[] = [[geometry.center[0], geometry.center[1]]];
      for (let t = 0; t < 360; t += 45) {
        const along = a * Math.cos(t * RAD);
        const across = b * Math.sin(t * RAD);
        points.push(destination(geometry.center, rotation + Math.atan2(across, along) * DEG, Math.hypot(along, across)));
      }
      return points;
    }
    case 'ArcBand': {
      const end = geometry.endBearing >= geometry.startBearing ? geometry.endBearing : geometry.endBearing + 360;
      return [[geometry.center[0], geometry.center[1]], ...round(geometry.center, geometry.outerRadius, geometry.startBearing, end)];
    }
  }
}

/** Whether (x, y) is inside the closed path on a flat plane (even-odd rule). */
function inPlane(x: number, y: number, path: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i];
    const b = path[j];
    if (a === undefined || b === undefined) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** A ring and a point on the same flat map: longitudes counted from `centre`, so a ring across the antimeridian is one piece. */
function insideRing(point: Position, ring: readonly Position[], centre: Position): boolean {
  return inPlane(
    lonDelta(point[0], centre[0]),
    point[1],
    ring.map((p) => [lonDelta(p[0], centre[0]), p[1]]),
  );
}

/**
 * Whether any point of the shape is inside the map's visible area (a closed lon/lat ring), the
 * test of brief function 7. The ring is unrolled onto a flat plane, each longitude following the
 * one before it by the short way round. A ring that does not come back to where it began winds
 * once round a pole (a view that holds a pole): it is closed through that pole (the one on the
 * centre's side) and tested like any other polygon, so the ring's latitude at the point's own
 * longitude decides. Any other ring, a view wider than the world included, closes by itself. A
 * polygon or circle that covers the view's centre is in view too, although none of its points is.
 */
export function isInView(geometry: Geometry, view: { readonly centre: Position; readonly ring: readonly Position[] }): boolean {
  const { centre, ring } = view;
  const start = ring[0];
  if (start === undefined || ring.length < 4) return false;
  const path: [number, number][] = [];
  let x = lonDelta(start[0], centre[0]);
  let before = start[0];
  for (const p of ring) {
    x += lonDelta(p[0], before);
    before = p[0];
    path.push([x, p[1]]);
  }
  const first = path[0];
  const last = path[path.length - 1];
  if (first !== undefined && last !== undefined && Math.round((last[0] - first[0]) / 360) !== 0) {
    const pole = centre[1] >= 0 ? 90 : -90;
    path.push([last[0], pole], [first[0], pole]);
  }
  const inside = (p: Position): boolean => {
    const at = lonDelta(p[0], centre[0]);
    return [-2, -1, 0, 1, 2].some((k) => inPlane(at + 360 * k, p[1], path));
  };
  if (viewPointsOf(geometry).some(inside)) return true;
  if (geometry.type === 'Circle') return distanceMetres(centre, geometry.center) <= geometry.radius;
  if (geometry.type === 'Polygon') {
    const exterior = geometry.coordinates[0];
    return exterior !== undefined && insideRing(centre, exterior, centre);
  }
  return false;
}
