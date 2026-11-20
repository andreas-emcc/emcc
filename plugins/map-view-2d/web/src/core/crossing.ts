/**
 * The fill of a polygon whose outline crosses itself (T-111; owner, 2026-10-31: every area the
 * outline encloses is filled, the middle of a star too). The WebGL fill cuts a ring into triangles
 * as if it were simple, and a ring that crosses itself comes out wrong: one lobe of a bow tie left
 * empty, an area outside shaded. {@link fillFaces} cuts such a ring at its crossings into the
 * areas it divides the plane into and keeps those the ring winds round (the nonzero rule). Every
 * face is a simple polygon the fill handles, and the faces do not overlap, so a translucent fill
 * is as dark in one as in the other. Pure geometry, in the projection's own coordinates.
 */
export type XY = readonly [number, number];

/** A crossing of two edges: where, and how far along each edge (0 to 1, both exclusive). */
interface Crossing {
  readonly id: number;
  readonly point: XY;
  readonly edge: number;
  readonly along: number;
}

/**
 * The simple faces a ring that crosses itself encloses, or null if the ring does not cross itself
 * (most rings: nothing to do). Edges that only touch at a vertex, or overlap along a line, are not
 * crossings. The ring may be closed (its first point repeated at the end) or not.
 */
export function fillFaces(ring: readonly XY[]): XY[][] | null {
  const points = open(ring);
  if (points.length < 4 || isConvex(points)) return null; // a triangle and a convex ring cannot cross themselves
  const crossings = findCrossings(points);
  if (crossings.length === 0) return null;
  return facesOf(points, crossings).filter((face) => windingAt(points, interiorPoint(face)) !== 0);
}

/**
 * The same for a polygon with holes (M8): the faces its outer ring encloses, each as a polygon (the face, then the holes
 * that lie wholly inside it), or null if the outer ring does not cross itself. A hole is subtracted from the face that holds
 * it. A hole that lies across the boundary of a face (over a crossing of the outer ring, say) cannot be cut out of one face
 * without clipping: it is left out and that part is filled. A ring with fewer than three points is no hole.
 */
export function fillFacesWithHoles(outer: readonly XY[], holes: readonly (readonly XY[])[]): XY[][][] | null {
  const faces = fillFaces(outer);
  if (faces === null) return null;
  const polygons = faces.map((face): XY[][] => [face]);
  for (const hole of holes) {
    const ring = open(hole);
    if (ring.length < 3) continue;
    const middle = areaOf(ring) >= 0 ? interiorPoint(ring) : interiorPoint([...ring].reverse());
    const owner = faces.findIndex((face) => windingAt(face, middle) !== 0);
    const face = faces[owner];
    if (face === undefined || !ring.every((p) => insideOrOn(face, p))) continue;
    polygons[owner]?.push(ring);
  }
  return polygons;
}

/** Whether a point is inside a loop or on its edge (to a rounding error). */
function insideOrOn(loop: readonly XY[], point: XY): boolean {
  if (windingAt(loop, point) !== 0) return true;
  const scale = Math.max(1, ...loop.map((p) => Math.abs(p[0]) + Math.abs(p[1])));
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as XY;
    const b = loop[(i + 1) % loop.length] as XY;
    const [abx, aby] = [b[0] - a[0], b[1] - a[1]];
    const length2 = abx * abx + aby * aby;
    const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * abx + (point[1] - a[1]) * aby) / length2));
    if (Math.hypot(point[0] - (a[0] + t * abx), point[1] - (a[1] + t * aby)) <= 1e-9 * scale) return true;
  }
  return false;
}

/** The ring without its closing point. */
function open(ring: readonly XY[]): XY[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first !== undefined && last !== undefined && ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  return closed ? ring.slice(0, -1) : [...ring];
}

/**
 * A convex ring turns the same way at every vertex and goes round once: a star turns the same way
 * too, but twice round (a total turn of 720°).
 */
function isConvex(points: readonly XY[]): boolean {
  const n = points.length;
  let sign = 0;
  let turning = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i] as XY;
    const b = points[(i + 1) % n] as XY;
    const c = points[(i + 2) % n] as XY;
    const [abx, aby, bcx, bcy] = [b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]];
    const cross = abx * bcy - aby * bcx;
    if (cross !== 0) {
      if (sign !== 0 && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    turning += Math.atan2(cross, abx * bcx + aby * bcy);
  }
  return Math.abs(Math.abs(turning) - 2 * Math.PI) < 1e-6;
}

/** Every crossing of two edges that do not share a vertex, found by sweeping the edges' x ranges. */
function findCrossings(points: readonly XY[]): Crossing[] {
  const n = points.length;
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % n] as XY;
    return { i, a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]) };
  });
  const sorted = [...edges].sort((p, q) => p.minX - q.minX);
  const crossings: Crossing[] = [];
  let id = 0;
  for (let s = 0; s < sorted.length; s++) {
    const p = sorted[s] as (typeof edges)[number];
    for (let t = s + 1; t < sorted.length; t++) {
      const q = sorted[t] as (typeof edges)[number];
      if (q.minX > p.maxX) break;
      if ((p.i + 1) % n === q.i || (q.i + 1) % n === p.i) continue; // neighbours share a vertex
      const hit = intersection(p.a, p.b, q.a, q.b);
      if (hit === null) continue;
      crossings.push({ id, point: hit.point, edge: p.i, along: hit.t }, { id, point: hit.point, edge: q.i, along: hit.u });
      id++;
    }
  }
  return crossings;
}

/** Where two segments cross in their interiors, with how far along each; null if they do not (touching ends and overlaps do not count). */
function intersection(a: XY, b: XY, c: XY, d: XY): { point: XY; t: number; u: number } | null {
  const r: XY = [b[0] - a[0], b[1] - a[1]];
  const s: XY = [d[0] - c[0], d[1] - c[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (denominator === 0) return null; // parallel
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denominator;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denominator;
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return null;
  return { point: [a[0] + t * r[0], a[1] + t * r[1]], t, u };
}

/**
 * The bounded faces of the ring cut at its crossings, as simple loops. The ring is a planar graph:
 * its vertices and crossings are the nodes, the pieces of the ring between them the edges. Each
 * edge has two half-edges; at the end of one, the next of a face is the half-edge that leaves
 * next clockwise from the way back, which keeps the face on the left. A face traced that way goes
 * counter-clockwise if it is bounded; the one that goes clockwise is the outside.
 */
function facesOf(points: readonly XY[], crossings: readonly Crossing[]): XY[][] {
  const n = points.length;
  const nodes: XY[] = [...points];
  const ids = new Map<number, number>();
  for (const crossing of crossings) {
    if (!ids.has(crossing.id)) {
      ids.set(crossing.id, nodes.length);
      nodes.push(crossing.point);
    }
  }
  const byEdge = new Map<number, Crossing[]>();
  for (const crossing of crossings) byEdge.set(crossing.edge, [...(byEdge.get(crossing.edge) ?? []), crossing]);
  // The walk round the ring, as node numbers.
  const walk: number[] = [];
  for (let i = 0; i < n; i++) {
    walk.push(i);
    for (const crossing of (byEdge.get(i) ?? []).sort((p, q) => p.along - q.along)) walk.push(ids.get(crossing.id) as number);
  }
  const m = walk.length;
  // Half-edge 2k runs along the walk from walk[k], half-edge 2k + 1 back.
  const origin = (h: number) => walk[h % 2 === 0 ? h / 2 : ((h - 1) / 2 + 1) % m] as number;
  const target = (h: number) => origin(h ^ 1);
  const angle = (h: number) => {
    const a = nodes[origin(h)] as XY;
    const b = nodes[target(h)] as XY;
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const leaving = new Map<number, number[]>();
  for (let h = 0; h < 2 * m; h++) leaving.set(origin(h), [...(leaving.get(origin(h)) ?? []), h]);
  for (const list of leaving.values()) list.sort((p, q) => angle(p) - angle(q));
  const next = (h: number) => {
    const list = leaving.get(target(h)) as number[];
    return list[(list.indexOf(h ^ 1) - 1 + list.length) % list.length] as number;
  };
  const faces: XY[][] = [];
  const done = new Set<number>();
  for (let start = 0; start < 2 * m; start++) {
    if (done.has(start)) continue;
    const face: XY[] = [];
    let h = start;
    while (!done.has(h)) {
      done.add(h);
      face.push(nodes[origin(h)] as XY);
      h = next(h);
    }
    if (face.length >= 3 && areaOf(face) > 0) faces.push(face);
  }
  return faces;
}

/** The signed area of a loop (shoelace; positive counter-clockwise in a y-up system). */
export function areaOf(loop: readonly XY[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as XY;
    const b = loop[(i + 1) % loop.length] as XY;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** A point strictly inside a simple counter-clockwise loop: the middle of an ear that holds no other vertex. */
function interiorPoint(loop: readonly XY[]): XY {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i + n - 1) % n] as XY;
    const b = loop[i] as XY;
    const c = loop[(i + 1) % n] as XY;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) continue; // not a convex corner
    if (loop.some((p) => p !== a && p !== b && p !== c && inTriangle(p, a, b, c))) continue;
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  }
  const sum = loop.reduce<XY>((s, p): XY => [s[0] + p[0], s[1] + p[1]], [0, 0]);
  return [sum[0] / n, sum[1] / n];
}

function inTriangle(p: XY, a: XY, b: XY, c: XY): boolean {
  const side = (u: XY, v: XY) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const [s1, s2, s3] = [side(a, b), side(b, c), side(c, a)];
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/** How many times the ring winds round a point, counter-clockwise positive. */
function windingAt(ring: readonly XY[], [x, y]: XY): number {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XY;
    const b = ring[(i + 1) % ring.length] as XY;
    const side = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
    if (a[1] <= y) {
      if (b[1] > y && side > 0) winding++;
    } else if (b[1] <= y && side < 0) winding--;
  }
  return winding;
}
