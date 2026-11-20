/**
 * Arc bands and corridors as drawn areas (brief function 36; data model 1.0.0's `ArcBand` and
 * `Corridor`). Each becomes rings of positions with continuous longitudes, drawn as any polygon is,
 * so every projection, the antimeridian, the outline picking, the highlight and the fade apply
 * unchanged. The geodesics are great circles on the mean earth radius, as everywhere in the map view
 * (see `geodesic.ts`).
 *
 * Known limit: an area that encloses a pole is not drawn as an area enclosing it (it is the same
 * limit as a polygon's); a radius is cut just under half the earth's circumference.
 */
import type { ArcBand, Corridor, Position } from '@emc2/plugin-sdk';
import { bearing, densifyPath, destination, distance, EARTH_RADIUS, unwrapLongitude } from './geodesic.ts';

const RAD = Math.PI / 180;

/** The longest radius drawn: just under half the earth's circumference, as a circle's. */
const MAX_RADIUS = Math.PI * EARTH_RADIUS * 0.999;

/** How far an arc's chord may lie inside the arc, in metres: the most the drawn arc is off its circle. */
const ARC_TOLERANCE = 0.5;
const MIN_ARC_SEGMENTS = 4;
const MAX_ARC_SEGMENTS = 360;
/** The largest step of bearing between two points of an arc or a round join, in degrees. */
const MAX_ARC_STEP = 2;
/**
 * The most metres between two points of a side edge. An edge between two positions is a straight line in
 * longitude and latitude, which a geodesic along a bearing is not: it lies about 1 m off for 10 km, and
 * the more for longer (the square of the length). 4 km keeps it under 0.2 m.
 */
const SIDE_STEP = 4000;
const MAX_SIDE_POINTS = 720;

const finite = (...numbers: number[]): boolean => numbers.every((n) => Number.isFinite(n));

/** Longitudes made continuous along the ring (each at most 180° from the one before). */
function continuous(ring: readonly Position[]): Position[] {
  const result: Position[] = [];
  for (const [lon, lat] of ring) {
    const previous = result[result.length - 1];
    result.push([previous === undefined ? lon : unwrapLongitude(lon, previous[0]), lat]);
  }
  return result;
}

/** The points of the arc `radius` metres from `centre`, from bearing `from` for `span` degrees (clockwise when positive), ends included. */
function arcPoints(centre: Position, radius: number, from: number, span: number): Position[] {
  const byTolerance = radius > 0 ? (2 * Math.sqrt((2 * ARC_TOLERANCE) / radius)) / RAD : MAX_ARC_STEP;
  const step = Math.min(MAX_ARC_STEP, Math.max(byTolerance, Math.abs(span) / MAX_ARC_SEGMENTS));
  const segments = Math.max(MIN_ARC_SEGMENTS, Math.ceil(Math.abs(span) / step));
  const points: Position[] = [];
  for (let i = 0; i <= segments; i++) points.push(destination(centre, from + (span * i) / segments, radius));
  return points;
}

/** The points along a bearing from `centre` strictly between the radii `from` and `to` (a side edge's inner points). */
function sidePoints(centre: Position, bearingDegrees: number, from: number, to: number): Position[] {
  const n = Math.min(MAX_SIDE_POINTS, Math.ceil(Math.abs(to - from) / SIDE_STEP));
  const points: Position[] = [];
  for (let k = 1; k < n; k++) points.push(destination(centre, bearingDegrees, from + ((to - from) * k) / n));
  return points;
}

/** A closed ring round the centre, at the arcs' accuracy (a circle of `circleRing` has only 64 sides). */
function fullCircle(centre: Position, radius: number): Position[] {
  return closed(continuous(arcPoints(centre, radius, 0, 360)));
}

/** The ring with its first position as its last (the last, a full turn round, is replaced). */
function closed(ring: Position[]): Position[] {
  const first = ring[0];
  if (first !== undefined) ring[ring.length - 1] = [first[0], first[1]];
  return ring;
}

/**
 * The rings of an arc band: the area between `innerRadius` and `outerRadius` round `center`,
 * clockwise from `startBearing` to `endBearing`. The outer arc is a geodesic circle, so is the inner
 * one, and the side edges follow the bearings. An inner radius of 0 gives a sector from the centre;
 * a band across north (300° to 60°) goes across north; equal bearings give the whole ring (a ring
 * with a hole, or a disc when the inner radius is 0). Null for a band that has no area.
 */
export function arcBandRings(band: ArcBand): Position[][] | null {
  const { center, startBearing, endBearing } = band;
  if (!finite(center[0], center[1], band.innerRadius, band.outerRadius, startBearing, endBearing)) return null;
  const outer = Math.min(band.outerRadius, MAX_RADIUS);
  const inner = Math.max(0, Math.min(band.innerRadius, MAX_RADIUS));
  if (!(outer > inner)) return null;
  const span = (((endBearing - startBearing) % 360) + 360) % 360;
  if (span === 0) {
    // The whole ring: the outer circle, and the inner circle as a hole running the other way.
    const rings = [fullCircle(center, outer)];
    if (inner > 0) rings.push(fullCircle(center, inner).reverse());
    return rings;
  }
  const ring: Position[] = arcPoints(center, outer, startBearing, span);
  ring.push(...sidePoints(center, startBearing + span, outer, inner));
  if (inner > 0) ring.push(...arcPoints(center, inner, startBearing + span, -span));
  else ring.push([center[0], center[1]]);
  ring.push(...sidePoints(center, startBearing, inner, outer));
  const first = ring[0] as Position;
  ring.push([first[0], first[1]]); // the side at the start ends where the ring began
  return [continuous(ring)];
}

/** The signed difference of two bearings, in degrees, in (-180, 180]. */
function turn(from: number, to: number): number {
  const d = (((to - from) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** The bearing with which the geodesic from `a` to `b` arrives at `b`. */
function arrivingBearing(a: Position, b: Position): number {
  return (bearing(b, a) + 180) % 360;
}

/** A side of a segment: points `half` metres to one side of the segment's geodesic, from its start to its end. */
function sideOfSegment(a: Position, b: Position, half: number, right: boolean): Position[] {
  const length = distance(a, b);
  const start = bearing(a, b);
  const quarter = right ? 90 : -90;
  const n = Math.max(1, Math.min(MAX_SIDE_POINTS, Math.ceil(length / SIDE_STEP)));
  const side: Position[] = [];
  for (let k = 0; k <= n; k++) {
    const at = k === 0 ? a : k === n ? b : destination(a, start, (length * k) / n);
    const heading = k === 0 ? start : k === n ? arrivingBearing(a, b) : bearing(at, b);
    side.push(destination(at, heading + quarter, half));
  }
  return continuous(side);
}

/** Where two short segments cross, as a position near `near`; null if they do not cross (a planar test about `near`). */
function crossing(a1: Position, a2: Position, b1: Position, b2: Position, near: Position): Position | null {
  const k = Math.cos(near[1] * RAD);
  if (k < 1e-6) return null;
  const xy = (p: Position): [number, number] => [(unwrapLongitude(p[0], near[0]) - near[0]) * k, p[1] - near[1]];
  const [p, r] = [xy(a1), xy(a2)];
  const [q, s] = [xy(b1), xy(b2)];
  const dr: [number, number] = [r[0] - p[0], r[1] - p[1]];
  const ds: [number, number] = [s[0] - q[0], s[1] - q[1]];
  const denominator = dr[0] * ds[1] - dr[1] * ds[0];
  if (Math.abs(denominator) < 1e-18) return null;
  const t = ((q[0] - p[0]) * ds[1] - (q[1] - p[1]) * ds[0]) / denominator;
  const u = ((q[0] - p[0]) * dr[1] - (q[1] - p[1]) * dr[0]) / denominator;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [near[0] + (p[0] + t * dr[0]) / k, near[1] + p[1] + t * dr[1]];
}

/**
 * The ring of a corridor: the area within `width` / 2 of the centre line on either side, measured
 * geodesically, with flat ends square to the first and last segments and rounded joins at the inner
 * positions. Null for a corridor that has no area. A corridor of one position (all positions the
 * same) is a disc.
 *
 * The ring may cross itself where the line turns sharply within a width of the next position: it is
 * then filled as any self-crossing ring is (nonzero), and the outline shows the small loop.
 */
export function corridorRing(corridor: Corridor): Position[] | null {
  const half = corridor.width / 2;
  if (!(half > 0) || !finite(half)) return null;
  const line: Position[] = [];
  for (const p of corridor.coordinates) {
    if (!finite(p[0], p[1])) return null;
    const previous = line[line.length - 1];
    if (previous === undefined || distance(previous, p) > 1e-3) line.push([p[0], p[1]]);
  }
  const first = line[0];
  if (first === undefined) return null;
  if (line.length === 1) return fullCircle(first, Math.min(half, MAX_RADIUS));
  const sides = { left: [] as Position[], right: [] as Position[] };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Position;
    const b = line[i + 1] as Position;
    for (const right of [false, true]) {
      const side = sideOfSegment(a, b, half, right);
      const run = right ? sides.right : sides.left;
      if (i > 0) joinSides(run, side, a, line[i - 1] as Position, b, half, right);
      else run.push(...side);
    }
  }
  const left = sides.left;
  const right = sides.right.slice().reverse();
  const outline = continuous(densifyPath([...left, ...right]));
  const start = outline[0];
  if (start !== undefined) outline.push([start[0], start[1]]); // the flat start closes the ring
  return outline;
}

/**
 * Joins the side of the next segment to the run so far at the position `at`, where the line turns
 * from the segment that arrives from `before` to the one that goes on to `after`. On the outside of
 * the turn the join is a round arc of `half` about `at`; on the inside the two sides are cut at
 * their crossing, when they cross, and otherwise run on through both ends (a loop).
 */
function joinSides(run: Position[], next: Position[], at: Position, before: Position, after: Position, half: number, right: boolean): void {
  const arriving = arrivingBearing(before, at);
  const leaving = bearing(at, after);
  const delta = turn(arriving, leaving); // positive: a turn to the right
  const outside = right ? delta < 0 : delta > 0;
  const quarter = right ? 90 : -90;
  if (Math.abs(delta) < 1e-9) {
    run.push(...next.slice(1));
    return;
  }
  if (outside) {
    const from = arriving + quarter;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_ARC_STEP));
    for (let k = 0; k <= steps; k++) run.push(destination(at, from + (delta * k) / steps, half));
    run.push(...next.slice(1));
    return;
  }
  const last = run[run.length - 1];
  const beforeLast = run[run.length - 2];
  const second = next[1];
  const head = next[0];
  const cut = last === undefined || beforeLast === undefined || second === undefined || head === undefined ? null : crossing(beforeLast, last, head, second, at);
  if (cut === null) {
    run.push(...next);
    return;
  }
  run[run.length - 1] = cut;
  run.push(...next.slice(1));
}
