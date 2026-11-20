/**
 * Pick (brief function 8, criterion 6): the object ids at a pixel, within a tolerance, topmost
 * first. Done in screen pixels over candidates the engine takes from its spatial index, so it
 * works the same for every projection and layer kind. "Topmost": the higher map layer first;
 * within a layer, the object drawn later first. Not necessarily complete (spike S2). An area (polygon,
 * circle, ellipse, square, rectangle) is hit only on its outline, filled or not, so what lies under it can be
 * picked through it (brief function 28, T-102; owner, 2026-10-30).
 */
import type { Pixel, Uuid } from '@emc2/plugin-sdk';

interface CandidateBase {
  readonly id: Uuid;
  /** The map layer's stacking index (higher is on top). */
  readonly stack: number;
  /** Drawing order within the layer (higher is drawn later, so on top). */
  readonly order: number;
}

export type PickCandidate =
  /** An image (symbol): its box in pixels, and `at`, the position it is drawn for. */
  | (CandidateBase & { readonly kind: 'box'; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly at: Pixel })
  /** A point drawn as a circle. */
  | (CandidateBase & { readonly kind: 'circle'; readonly center: Pixel; readonly radius: number })
  | (CandidateBase & { readonly kind: 'line'; readonly pixels: readonly Pixel[]; readonly width: number })
  | (CandidateBase & { readonly kind: 'polygon'; readonly rings: readonly (readonly Pixel[])[]; readonly width: number })
  /** A text object's box, turned with the text (brief function 45): hit anywhere inside, not only on its edge. `at` is the position it is drawn for. */
  | (CandidateBase & { readonly kind: 'quad'; readonly corners: readonly Pixel[]; readonly at: Pixel });

export const DEFAULT_TOLERANCE = 5;

export function pickAt(candidates: readonly PickCandidate[], pixel: Pixel, tolerance = DEFAULT_TOLERANCE): Uuid[] {
  const t = Math.max(0, tolerance);
  const ids = candidates
    .filter((c) => hits(c, pixel, t))
    .sort((a, b) => b.stack - a.stack || b.order - a.order)
    .map((c) => c.id);
  return [...new Set(ids)]; // a graphic is several lines: one id
}

function hits(c: PickCandidate, [x, y]: Pixel, t: number): boolean {
  switch (c.kind) {
    case 'box':
      return x >= c.left - t && x <= c.right + t && y >= c.top - t && y <= c.bottom + t;
    case 'circle':
      return Math.hypot(x - c.center[0], y - c.center[1]) <= c.radius + t;
    case 'line':
      return distanceToPath(c.pixels, [x, y]) <= c.width / 2 + t;
    case 'polygon':
      return c.rings.some((ring) => distanceToPath(ring, [x, y]) <= c.width / 2 + t);
    case 'quad':
      return insideQuad(c.corners, [x, y]) || distanceToPath([...c.corners, ...c.corners.slice(0, 1)], [x, y]) <= t;
  }
}

/** Whether a point is inside a convex polygon given by its corners in order, either way round. */
function insideQuad(corners: readonly Pixel[], [x, y]: Pixel): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Pixel;
    const b = corners[(i + 1) % corners.length] as Pixel;
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function distanceToPath(path: readonly Pixel[], p: Pixel): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a !== undefined && b !== undefined) best = Math.min(best, distanceToSegment(a, b, p));
  }
  const only = path[0];
  if (path.length === 1 && only !== undefined) best = Math.hypot(p[0] - only[0], p[1] - only[1]);
  return best;
}

export function distanceToSegment(a: Pixel, b: Pixel, p: Pixel): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const f = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + f * dx), p[1] - (a[1] + f * dy));
}

/** A box on the screen in pixels, from any corner to the opposite one. */
export interface PixelBox {
  readonly from: Pixel;
  readonly to: Pixel;
}

/**
 * The object ids in a selection box (brief function 14), topmost first as {@link pickAt}, each
 * once. An object is in the box when its drawn position (a symbol's, a point's) or its outline (a
 * line, the border of an area) reaches into it; a box wholly inside an area does not select the
 * area (owner, 2026-10-16).
 */
export function boxAt(candidates: readonly PickCandidate[], box: PixelBox): Uuid[] {
  const r = {
    left: Math.min(box.from[0], box.to[0]),
    right: Math.max(box.from[0], box.to[0]),
    top: Math.min(box.from[1], box.to[1]),
    bottom: Math.max(box.from[1], box.to[1]),
  };
  const ids = candidates
    .filter((c) => inBox(c, r))
    .sort((a, b) => b.stack - a.stack || b.order - a.order)
    .map((c) => c.id);
  return [...new Set(ids)];
}

interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function inBox(c: PickCandidate, r: Rect): boolean {
  switch (c.kind) {
    case 'box':
      return contains(r, c.at);
    case 'circle':
      return contains(r, c.center);
    case 'line':
      return pathReaches(c.pixels, r);
    case 'polygon':
      return c.rings.some((ring) => pathReaches(ring, r));
    case 'quad':
      return contains(r, c.at) || pathReaches([...c.corners, ...c.corners.slice(0, 1)], r) || insideQuad(c.corners, [r.left, r.top]);
  }
}

function contains(r: Rect, [x, y]: Pixel): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function pathReaches(path: readonly Pixel[], r: Rect): boolean {
  const first = path[0];
  if (first !== undefined && contains(r, first)) return true;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a !== undefined && b !== undefined && segmentReaches(a, b, r)) return true;
  }
  return false;
}

/** Liang-Barsky: true if any part of the segment from `a` to `b` lies in the rectangle. */
function segmentReaches(a: Pixel, b: Pixel, r: Rect): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a[0] - r.left],
    [dx, r.right - a[0]],
    [-dy, a[1] - r.top],
    [dy, r.bottom - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}
