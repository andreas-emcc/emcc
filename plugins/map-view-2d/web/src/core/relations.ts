/**
 * Relation lines (brief function 34; ADR-0051 point 6, ADR-0052): for an object with `relations` whose
 * kind a loaded plugin declares and the user has switched on, a geodesic line from the object's drawn
 * position to the other object's, in the kind's line style. Each is a line item with `aux` (drawn under
 * the symbols of its layer, never picked or labelled), in the carrying object's layer.
 */
import type { MapObject, Position, RelationKind, RelationLine } from '@emc2/plugin-sdk';
import { FADED_OPACITY } from './expiry.ts';
import { toDrawItem, type DrawItem } from './drawData.ts';
import { densifyPath, distance, unwrapLongitude } from './geodesic.ts';

/** Two ends closer than this (metres) are the same drawn position: no line (the ACA's R6 on CR-0031). */
const ZERO_LENGTH = 0.001;

/** The id of the line item of a relation: it is no object's id, and goes with the carrying object's relation. */
export function relationItemId(kind: string, carrier: string, target: string): string {
  return `rel:${kind}:${carrier}:${target}`;
}

/** The middle of a path along its length. */
function middleOf(path: readonly Position[]): Position | null {
  const first = path[0];
  if (first === undefined) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const length = distance(path[i - 1] as Position, path[i] as Position);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] as number;
    if (remaining > length) {
      remaining -= length;
      continue;
    }
    const a = path[i] as Position;
    const b = path[i + 1] as Position;
    const f = length === 0 ? 0 : remaining / length;
    return [a[0] + (unwrapLongitude(b[0], a[0]) - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  return [first[0], first[1]];
}

/**
 * A point inside an area, for its relation lines: the middle of the widest stretch inside the rings along
 * the line half way up their extent (OpenLayers' interior point, in longitude and latitude, as the labels
 * use it); the middle of the extent when the rings give none.
 */
function interiorOf(rings: readonly (readonly Position[])[]): Position | null {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }
  if (!Number.isFinite(minY)) return null;
  const y = (minY + maxY) / 2;
  const crossings: number[] = [];
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1] as Position;
      const [x2, y2] = ring[i] as Position;
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
  crossings.sort((a, b) => a - b);
  let best: Position | null = null;
  let width = -1;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const [from, to] = [crossings[i] as number, crossings[i + 1] as number];
    if (to - from > width) {
      width = to - from;
      best = [(from + to) / 2, y];
    }
  }
  return best ?? [(minX + maxX) / 2, y];
}

/**
 * Where an object is drawn, for the ends of its relation lines: a point object at its point, any other at
 * the place its label goes (an area's interior point, a line's middle); a tactical graphic at its first
 * control point, where its marker is. Null for an object that has no position.
 */
export function anchorOf(object: MapObject): Position | null {
  const item = toDrawItem(object);
  if (item === null) return null;
  switch (item.kind) {
    case 'symbol':
    case 'point':
    case 'fallback':
    case 'text':
    case 'textobject':
      return item.position;
    case 'graphic':
      return item.points[0] ?? null;
    case 'line':
      return middleOf(item.positions);
    case 'polygon':
      return interiorOf(item.rings);
  }
}

export interface RelationInput {
  /** The objects of the live picture. */
  readonly objects: ReadonlyMap<string, MapObject>;
  /** The kinds the loaded plugins declare (`ctx.relationKinds`). */
  readonly kinds: readonly RelationKind[];
  /**
   * Each kind's line as the shell resolved it (`ctx.relationLines`, brief function 43: the colour from the declaring
   * plugin's setting). A kind it does not list, or no list (an older shell), takes the manifest's line.
   */
  readonly lines?: Readonly<Record<string, RelationLine>>;
  /** Whether the user has the kind's lines on. */
  readonly on: (kindId: string) => boolean;
  /** Whether an object takes part: its layer is drawn. */
  readonly shown: (object: MapObject) => boolean;
  /** Whether an object is faded (expired, or on a fade list). */
  readonly faded: (id: string) => boolean;
  /**
   * The opacity of an object of a data type with a fade in steps (brief function 46; the lower of its step and a fade list's),
   * undefined for any other object, which `faded` tells about.
   */
  readonly opacity?: (id: string) => number | undefined;
  /**
   * The objects that relations name and the map does not hold, fetched for the lines' sake (brief function 41):
   * a line runs to one as to a held object. They are not carriers, and their fading is not known.
   */
  readonly farEnds?: ReadonlyMap<string, MapObject>;
}

/**
 * What the relations of the held objects name (brief function 41): `far` are the ids the map does not hold, the far
 * ends to fetch; `near` are the objects it holds, so that one that leaves the area can go on as a far end at once.
 * Only relations that would be drawn count: a kind that is declared and switched on, from a carrier that is shown.
 */
export function relationEnds(input: RelationInput): { readonly far: Set<string>; readonly near: Map<string, MapObject> } {
  const far = new Set<string>();
  const near = new Map<string, MapObject>();
  const active = new Set(input.kinds.filter((k) => input.on(k.id)).map((k) => k.id));
  if (active.size === 0) return { far, near };
  for (const carrier of input.objects.values()) {
    if (carrier.relations === undefined || carrier.relations.length === 0 || !input.shown(carrier)) continue;
    for (const relation of carrier.relations) {
      if (!active.has(relation.kind) || relation.objectId === carrier.id) continue;
      const held = input.objects.get(relation.objectId);
      if (held === undefined) far.add(relation.objectId);
      else near.set(held.id, held);
    }
  }
  return { far, near };
}

/**
 * The line items of the relations to draw, by item id. A line is skipped for a kind that is not declared or
 * not switched on, for an object the map does not hold or does not show, and when both ends are at one
 * position; two objects that relate to each other in one kind give one line, from the object with the
 * smaller id. A line takes the opacity of its carrying object, so it fades and goes with it, and the other end's
 * fading does not fade it (brief function 42; M7-S8); of a pair that carry the relation both ways it takes the higher
 * of the two, so it fades only when both do. The far end of a relation may be an object the map does not hold
 * (`farEnds`, brief function 41).
 */
export function relationLines(input: RelationInput): Map<string, DrawItem> {
  const lines = new Map<string, DrawItem>();
  const active = new Map(input.kinds.filter((k) => input.on(k.id)).map((k) => [k.id, k]));
  if (active.size === 0) return lines;
  const anchors = new Map<string, Position | null>();
  const anchor = (object: MapObject): Position | null => {
    if (!anchors.has(object.id)) anchors.set(object.id, anchorOf(object));
    return anchors.get(object.id) ?? null;
  };
  for (const carrier of input.objects.values()) {
    if (carrier.relations === undefined || carrier.relations.length === 0 || !input.shown(carrier)) continue;
    for (const relation of carrier.relations) {
      const kind = active.get(relation.kind);
      const held = input.objects.get(relation.objectId);
      const target = held ?? input.farEnds?.get(relation.objectId);
      if (kind === undefined || target === undefined || target.id === carrier.id || !input.shown(target)) continue;
      const mutual = target.relations?.some((r) => r.kind === relation.kind && r.objectId === carrier.id) === true;
      if (mutual && held !== undefined && carrier.id > target.id) continue; // once per pair (a far end is no carrier here: its line is drawn from this one)
      const from = anchor(carrier);
      const to = anchor(target);
      if (from === null || to === null || distance(from, to) < ZERO_LENGTH) continue;
      const id = relationItemId(kind.id, carrier.id, target.id);
      const line = input.lines?.[kind.id] ?? kind.line;
      const both = mutual && held !== undefined; // a pair that carry the relation both ways: the line is as bright as the brighter
      const ends = both ? [carrier, target] : [carrier];
      const opacity = Math.max(...ends.map((o) => input.opacity?.(o.id) ?? (input.faded(o.id) ? FADED_OPACITY : 1)));
      const stepped = ends.some((o) => input.opacity?.(o.id) !== undefined);
      lines.set(id, {
        id,
        layerId: carrier.layerId,
        kind: 'line',
        positions: densifyPath([from, [unwrapLongitude(to[0], from[0]), to[1]]]),
        style: { strokeColor: line.strokeColor, strokeWidth: line.strokeWidth, strokeDash: line.strokeDash, arrowhead: line.arrowhead },
        aux: true,
        ...(opacity >= 1 ? {} : stepped ? { opacity } : { faded: true }),
      });
    }
  }
  return lines;
}
