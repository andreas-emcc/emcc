/**
 * Centre on and Zoom to (brief function 16, ADR-0032 point 6): the objects' extent in the map's own
 * coordinates, a quick approximation of their middle, and the view that shows them. No OpenLayers.
 */
import type { MapObject, Position, Uuid } from '@emc2/plugin-sdk';
import { toDrawItem, type DrawItem } from './drawData.ts';
import type { Projection } from './projections.ts';

/** Zoom to leaves this share of the view free on each side around the objects' extent (owner, 2026-10-17). */
export const ZOOM_TO_MARGIN = 0.1;

export interface MapExtent {
  /** [minX, minY, maxX, maxY] in map coordinates; where the map repeats sideways, x may lie beyond one world. */
  readonly extent: readonly [number, number, number, number];
  /** The ids the extent was made of, in the order given. */
  readonly shown: readonly Uuid[];
  /** The ids with no position inside the projection's world extent (left out). */
  readonly outside: readonly Uuid[];
}

function positionsOf(item: DrawItem): readonly Position[] {
  switch (item.kind) {
    case 'symbol':
    case 'point':
    case 'fallback':
    case 'text':
    case 'textobject':
      return [item.position];
    case 'line':
      return item.positions;
    case 'polygon':
      return item.rings.flat();
    case 'graphic':
      return item.points;
  }
}

/**
 * The extent of the objects' positions inside the projection's world extent (circles and ellipses
 * by their outlines), in map coordinates; null if no object has one. Where the map repeats
 * sideways, it is the narrowest that holds every point in some world copy: it starts after the
 * widest gap between the points' x, so objects on both sides of the antimeridian make a narrow
 * extent, not one around the world, whatever their order.
 */
export function mapExtent(objects: readonly MapObject[], projection: Projection): MapExtent | null {
  const [minX, , maxX] = projection.def.extent;
  const shown: Uuid[] = [];
  const outside: Uuid[] = [];
  const xs: number[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const object of objects) {
    const item = toDrawItem(object);
    const points = item === null ? [] : positionsOf(item).filter((p) => projection.isValid(p));
    let any = false;
    for (const p of points) {
      const xy = projection.forward(p);
      if (xy === null) continue;
      xs.push(xy[0]);
      minY = Math.min(minY, xy[1]);
      maxY = Math.max(maxY, xy[1]);
      any = true;
    }
    (any ? shown : outside).push(object.id);
  }
  if (xs.length === 0) return null;
  const [left, right] = projection.wrapsX ? narrowestAround(xs, minX, maxX - minX) : [Math.min(...xs), Math.max(...xs)];
  return { extent: [left, minY, right, maxY], shown, outside };
}

/** The narrowest span [left, right] (right may lie beyond one world) holding every x in some world copy. */
function narrowestAround(xs: readonly number[], minX: number, world: number): [number, number] {
  const sorted = xs.map((x) => minX + ((((x - minX) % world) + world) % world)).sort((a, b) => a - b);
  const first = sorted[0] ?? minX;
  const last = sorted[sorted.length - 1] ?? minX;
  // The widest gap, the one across the world's edge included; the span is everything else.
  let gap = first + world - last;
  let start = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0);
    if (g > gap) {
      gap = g;
      start = i;
    }
  }
  const left = sorted[start] ?? first;
  return [left, left + world - gap];
}

/** The middle of an extent; beyond one world where the map repeats sideways, its lon/lat is the same place. */
export function middleOf({ extent }: MapExtent): [number, number] {
  return [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
}

/** The projected resolution at which the extent fits a view of this size with the margin; 0 for a single point. */
export function fitResolution({ extent }: MapExtent, width: number, height: number): number {
  const free = 1 - 2 * ZOOM_TO_MARGIN;
  return Math.max((extent[2] - extent[0]) / (width * free), (extent[3] - extent[1]) / (height * free));
}
