/**
 * Following the map view's viewport for `area: 'viewport'` subscriptions (SDK v1; spike S3,
 * recommendation 11): the shell asks for the visible ring grown by half the screen's half diagonal,
 * and asks again only when the view leaves the area it holds, or shrinks below a quarter of it.
 *
 * Everything is on the sphere, with unit vectors, so the poles and the antimeridian are no special
 * cases: the same inside test as the server's (ECore `GeoArea`: crossings of the arc from the
 * inside point, a ring vertex on the arc counting on its positive side).
 */
import { viewportArea, type Area, type Position, type Viewport } from '@emc2/plugin-sdk';

/** The margin: a share of the greatest distance from the centre to the visible ring (S3: half). */
export const MARGIN_SHARE = 0.5;
/** Points per ring edge that are tested. */
const SAMPLES = 4;
/** The most positions the server takes in an area's ring (server/live-picture-protocol.md). */
export const MAX_RING = 256;

/**
 * A ring of at most {@link MAX_RING} positions: every k-th position of a longer one, closed again. A
 * zoomed-out map view splits long edges into many positions; the margin covers the difference.
 */
export function thinRing(ring: readonly Position[], max = MAX_RING): readonly Position[] {
  if (ring.length <= max) return ring;
  const step = Math.ceil((ring.length - 1) / (max - 1));
  const thin: Position[] = [];
  for (let i = 0; i < ring.length - 1; i += step) thin.push(ring[i] as Position);
  thin.push(ring[ring.length - 1] as Position);
  return thin;
}

type Vector = readonly [number, number, number];

function vector(p: Position): Vector {
  const lon = (p[0] * Math.PI) / 180;
  const lat = (p[1] * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: Vector, b: Vector): number => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
const sign = (d: number): number => (d > 0 ? 1 : d < 0 ? -1 : 0);
const halfOpen = (d: number): number => (d >= 0 ? 1 : -1);

/** Points along each edge of a ring: its vertices and {@link SAMPLES} - 1 points between them. */
function samples(ring: readonly Position[]): Vector[] {
  const out: Vector[] = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = vector(ring[i] as Position);
    const b = vector(ring[i + 1] as Position);
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES;
      const x = a[0] + t * (b[0] - a[0]);
      const y = a[1] + t * (b[1] - a[1]);
      const z = a[2] + t * (b[2] - a[2]);
      const n = Math.hypot(x, y, z) || 1;
      out.push([x / n, y / n, z / n]);
    }
  }
  return out;
}

/** A closed ring with geodesic edges and the side that holds {@code inside}. */
export class SphericalRing {
  private readonly vertices: Vector[];
  private readonly normals: Vector[];
  private readonly insideSide: number[];
  private readonly inside: Vector;

  constructor(ring: readonly Position[], inside: Position) {
    this.vertices = ring.map(vector);
    this.inside = vector(inside);
    this.normals = [];
    this.insideSide = [];
    for (let i = 0; i + 1 < this.vertices.length; i++) {
      const n = cross(this.vertices[i] as Vector, this.vertices[i + 1] as Vector);
      this.normals.push(n);
      this.insideSide.push(sign(dot(n, this.inside)));
    }
  }

  contains(p: Vector): boolean {
    const m = cross(this.inside, p);
    let inside = true;
    let prev = halfOpen(dot(m, this.vertices[0] as Vector));
    for (let i = 0; i < this.normals.length; i++) {
      const next = halfOpen(dot(m, this.vertices[i + 1] as Vector));
      const acb = -(this.insideSide[i] as number);
      if (acb !== 0 && acb === sign(dot(this.normals[i] as Vector, p)) && acb === -next && acb === prev) inside = !inside;
      prev = next;
    }
    return inside;
  }

  /** The least angle from p to the ring's edges, radians. */
  distance(p: Vector): number {
    let least = Math.PI;
    for (let i = 0; i < this.normals.length; i++) {
      const a = this.vertices[i] as Vector;
      const b = this.vertices[i + 1] as Vector;
      const n = this.normals[i] as Vector;
      const len = Math.hypot(...n);
      if (len > 0 && dot(cross(n, a), p) >= 0 && dot(cross(b, n), p) >= 0) {
        least = Math.min(least, Math.asin(Math.min(1, Math.abs(dot(n, p)) / len)));
      } else {
        least = Math.min(least, angle(p, a), angle(p, b));
      }
    }
    return least;
  }
}

/** The greatest angle from the centre to the visible ring, radians. */
function greatestReach(viewport: Viewport): number {
  const c = vector(viewport.center);
  let greatest = 0;
  for (const p of samples(viewport.visibleArea)) greatest = Math.max(greatest, angle(c, p));
  return greatest;
}

/**
 * True if the view's visible ring is a closed ring of at least four positions. A map view that has
 * no size yet (its first viewport) reports none: such a view is not known yet.
 */
export function hasArea(viewport: Viewport): boolean {
  const ring = viewport.visibleArea;
  const first = ring[0];
  const last = ring.at(-1);
  return ring.length >= 4 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}

/** The area a subscription holds, and what is needed to judge later views against it. */
export interface HeldArea {
  readonly area: Area;
  readonly resolution: number;
  readonly ring: SphericalRing;
  /** The margin, radians. */
  readonly margin: number;
  /** The greatest angle from the centre to the visible ring it was made from. */
  readonly greatest: number;
}

export function hold(viewport: Viewport): HeldArea {
  const greatest = greatestReach(viewport);
  const area = viewportArea(viewport, MARGIN_SHARE);
  return {
    area: { ...area, ring: thinRing(area.ring) },
    resolution: viewport.resolution,
    ring: new SphericalRing(viewport.visibleArea, viewport.center),
    margin: MARGIN_SHARE * greatest,
    greatest,
  };
}

/**
 * True if the server must be asked again: a part of the view lies outside the held area, or the
 * view is less than a quarter of the held area (which is about 1.5² times the view it came from).
 */
export function mustMove(held: HeldArea, viewport: Viewport): boolean {
  for (const p of samples(viewport.visibleArea)) {
    if (!held.ring.contains(p) && held.ring.distance(p) > held.margin) return true;
  }
  return greatestReach(viewport) < 0.75 * held.greatest;
}
