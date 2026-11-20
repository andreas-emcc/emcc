/**
 * Geodesic edges for drawing (model rule 10, design pattern FAQ): an edge between two positions is
 * the shorter geodesic, so a renderer densifies it and the shape looks the same in every
 * projection. An edge may cross the antimeridian and is never split there: longitudes of a
 * densified path are continuous (they may leave [-180, 180]).
 *
 * Known limit (owner, 2026-10-09): the geodesics are great circles on a sphere of the mean earth
 * radius, not exact WGS84 ellipsoid geodesics. The difference is far below a symbol's size at any
 * scale the map shows whole edges.
 */
import type { Position } from '@emc2/plugin-sdk';

/** Mean earth radius in metres (IUGG). */
export const EARTH_RADIUS = 6_371_008.8;

/** Largest angle between two densified points, in degrees (about 111 km). */
export const DEFAULT_STEP_DEGREES = 1;

const RAD = Math.PI / 180;

type Vector = readonly [number, number, number];

function toVector([lon, lat]: Position): Vector {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function toPosition([x, y, z]: Vector): Position {
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/** The angle between two positions seen from the earth's centre, in radians. */
export function angularDistance(a: Position, b: Position): number {
  const dPhi = (b[1] - a[1]) * RAD;
  const dLambda = (b[0] - a[0]) * RAD;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLambda / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in metres. */
export function distance(a: Position, b: Position): number {
  return angularDistance(a, b) * EARTH_RADIUS;
}

/** The longitude equal to `lon` that is closest to `reference` (at most 180° away). */
export function unwrapLongitude(lon: number, reference: number): number {
  let delta = (lon - reference) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return reference + delta;
}

/**
 * The positions of a path with extra points along each edge, so that no two consecutive points are
 * more than `stepDegrees` apart. Short edges are kept as they are. Altitudes are dropped (2D).
 * Longitudes are made continuous along the path, so an edge across the antimeridian stays one edge.
 * An edge between antipodes has no shorter geodesic and is not densified.
 */
export function densifyPath(path: readonly Position[], stepDegrees = DEFAULT_STEP_DEGREES): Position[] {
  const first = path[0];
  if (first === undefined) return [];
  const result: Position[] = [[first[0], first[1]]];
  const step = stepDegrees * RAD;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined) continue;
    const angle = angularDistance(a, b);
    const n = Math.ceil(angle / step);
    if (n > 1 && Math.sin(angle) > 1e-6) {
      const va = toVector(a);
      const vb = toVector(b);
      for (let k = 1; k < n; k++) result.push(continuous(result, toPosition(slerp(va, vb, angle, k / n))));
    }
    result.push(continuous(result, [b[0], b[1]]));
  }
  return result;
}

function continuous(path: readonly Position[], position: Position): Position {
  const previous = path[path.length - 1];
  return previous === undefined ? position : [unwrapLongitude(position[0], previous[0]), position[1]];
}

function slerp(a: Vector, b: Vector, angle: number, f: number): Vector {
  const s = Math.sin(angle);
  const wa = Math.sin((1 - f) * angle) / s;
  const wb = Math.sin(f * angle) / s;
  return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
}

/**
 * The initial bearing from `a` to `b`, degrees clockwise from true north in [0, 360). From a pole
 * it follows `destination`'s convention, so `bearing(p, destination(p, θ, d))` gives θ back.
 */
export function bearing(a: Position, b: Position): number {
  if (Math.abs(a[1]) > 90 - 1e-9) {
    const raw = a[1] > 0 ? a[0] + 180 - b[0] : b[0] - a[0];
    return ((raw % 360) + 360) % 360;
  }
  const phi1 = a[1] * RAD;
  const phi2 = b[1] * RAD;
  const dLambda = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

/** The position `metres` away from `start` along the initial bearing (degrees clockwise from north). */
export function destination(start: Position, bearingDegrees: number, metres: number): Position {
  const delta = metres / EARTH_RADIUS;
  // At a pole every direction is south (north): the bearing picks the meridian, measured from the
  // start's longitude as if the pole were approached along it.
  if (Math.abs(start[1]) > 90 - 1e-9) {
    const north = start[1] > 0;
    const lat = north ? 90 - delta / RAD : -90 + delta / RAD;
    const lon = north ? start[0] + 180 - bearingDegrees : start[0] + bearingDegrees;
    return [lon, Math.max(-90, Math.min(90, lat))];
  }
  const theta = bearingDegrees * RAD;
  const phi1 = start[1] * RAD;
  const lambda1 = start[0] * RAD;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * sinPhi2);
  return [lambda2 / RAD, phi2 / RAD];
}

/**
 * A closed ring approximating a geodesic circle (all points `radius` metres from the centre), with
 * continuous longitudes. The radius is limited to just under half the earth's circumference.
 */
export function circleRing(center: Position, radius: number, segments = 64): Position[] {
  const r = Math.max(0, Math.min(radius, Math.PI * EARTH_RADIUS * 0.999));
  const ring: Position[] = [];
  for (let i = 0; i <= segments; i++) {
    const p = destination(center, (360 * (i % segments)) / segments, r);
    ring.push(continuous(ring, p));
  }
  return ring;
}

/**
 * A closed ring approximating a geodesic ellipse (data model `Ellipse`, brief function 18), drawn
 * as `circleRing` draws a circle: at each bearing from the centre, the point at the ellipse's
 * radius in that direction. The major axis lies along `rotation` (degrees clockwise from true
 * north), so the ring reaches `semiMajor` metres at that bearing and `semiMinor` at right angles.
 */
export function ellipseRing(center: Position, semiMajor: number, semiMinor: number, rotation: number, segments = 64): Position[] {
  const limit = (length: number) => Math.max(0, Math.min(length, Math.PI * EARTH_RADIUS * 0.999));
  const a = limit(semiMajor);
  const b = limit(semiMinor);
  const ring: Position[] = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (360 * (i % segments)) / segments;
    const phi = (bearing - rotation) * RAD;
    const r = a === 0 || b === 0 ? 0 : (a * b) / Math.hypot(b * Math.cos(phi), a * Math.sin(phi));
    ring.push(continuous(ring, destination(center, bearing, r)));
  }
  return ring;
}
