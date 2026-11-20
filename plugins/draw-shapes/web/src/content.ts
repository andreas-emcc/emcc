// Pure functions that build the content of change requests (ADR-0005, model README rule 5). An
// update replaces all core fields, so every edit starts from `coreOf(latestState)` and changes one
// thing. `extensions` is never part of it: the object store keeps all of them (rule 5), so this
// plugin's own `draw-shapes` extension (the kind) survives an update without being sent.
import { MANUAL_DATA_SOURCE } from '@emc2/plugin-sdk';
import type { Geometry, MapObject, MapObjectContent, Position, SecurityLabel, Style, Uuid } from '@emc2/plugin-sdk';
import { geometryLabel, geometryTypeOf, isShapeKind, KIND_LABELS } from './kinds.ts';
import type { ShapeKind } from './kinds.ts';

/** The schema limit of a name. */
export const MAX_NAME_LENGTH = 256;

/** This plugin's extension namespace: `{ "kind": "rectangle" }`. A documented key: other plugins may read it. */
export const EXTENSION_NAMESPACE = 'draw-shapes';

export function isShape(object: MapObject): boolean {
  return object.type === 'core.shape';
}

/**
 * All core fields of an object, which is what an update sends (model rule 5): `dataType` and
 * `dataSource` (the source unchanged, rule 14) and `time` included. No id, version, meta or extensions.
 */
export function coreOf(object: MapObjectContent): MapObjectContent {
  return {
    type: object.type,
    dataType: object.dataType,
    dataSource: object.dataSource,
    ...(object.time !== undefined ? { time: object.time } : {}),
    layerId: object.layerId,
    geometry: object.geometry,
    ...(object.symbol !== undefined ? { symbol: object.symbol } : {}),
    ...(object.style !== undefined ? { style: object.style } : {}),
    ...(object.properties !== undefined ? { properties: object.properties } : {}),
    label: object.label,
  };
}

/** The kind stored in our extension, if it is one of ours and fits the geometry (a shape reshaped by someone else may not). */
export function kindOf(object: MapObjectContent): ShapeKind | null {
  const kind = object.extensions?.[EXTENSION_NAMESPACE]?.['kind'];
  return isShapeKind(kind) && geometryTypeOf(kind) === object.geometry.type ? kind : null;
}

/** "Rectangle" for a drawn rectangle; the geometry's name for a shape without a kind of ours. */
export function kindLabelOf(object: MapObjectContent): string {
  const kind = kindOf(object);
  return kind === null ? geometryLabel(object.geometry) : KIND_LABELS[kind];
}

/** Trimmed text of at most `max` characters, or undefined for empty text ("empty means absent", rule 13). */
export function normalizeText(text: string, max: number): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const characters = Array.from(trimmed);
  return characters.length > max ? characters.slice(0, max).join('') : trimmed;
}

/** A copy of an object without one key. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}

/** The label of the shape, `properties.name`. Other properties (a description) are kept. */
export function withName(core: MapObjectContent, text: string): MapObjectContent {
  const name = normalizeText(text, MAX_NAME_LENGTH);
  const properties = { ...omit(core.properties ?? {}, 'name'), ...(name === undefined ? {} : { name }) };
  const without = omit(core, 'properties');
  return Object.keys(properties).length === 0 ? without : { ...without, properties };
}

export function withStyle(core: MapObjectContent, style: Style): MapObjectContent {
  return { ...core, style };
}

export function withLayer(core: MapObjectContent, layerId: Uuid): MapObjectContent {
  return { ...core, layerId };
}

export function withGeometry(core: MapObjectContent, geometry: Geometry): MapObjectContent {
  return { ...core, geometry };
}

/** Changes the data type; the data source stays as it is (it is fixed at creation, model rule 14). */
export function withDataType(core: MapObjectContent, dataType: string): MapObjectContent {
  return { ...core, dataType };
}

/**
 * The content of a new shape: `core.shape` in the active layer, of the chosen data type, drawn by
 * hand (`manual`), with the geometry as the drawing service returned it, the style, the name as
 * `properties.name`, and the kind as drawn in our own extension (brief, function 2).
 */
export function newShapeContent(args: {
  readonly kind: ShapeKind;
  readonly geometry: Geometry;
  readonly style: Style;
  readonly name: string;
  readonly layerId: Uuid;
  readonly dataType: string;
  readonly label: SecurityLabel;
}): MapObjectContent {
  const name = normalizeText(args.name, MAX_NAME_LENGTH);
  return {
    type: 'core.shape',
    dataType: args.dataType,
    dataSource: MANUAL_DATA_SOURCE,
    layerId: args.layerId,
    geometry: args.geometry,
    style: args.style,
    ...(name === undefined ? {} : { properties: { name } }),
    label: args.label,
    extensions: { [EXTENSION_NAMESPACE]: { kind: args.kind } },
  };
}

/** Deep equality of two JSON values (object key order does not matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

/**
 * A position the model accepts, in WGS84 longitude, latitude (ADR-0007), or null. A longitude
 * outside ±180 (a wrapped world) is brought back; a latitude outside ±90 is refused. An altitude is dropped:
 * a drawn shape is on the ground.
 */
export function validPosition(position: Position): Position | null {
  const [lon, lat] = position;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  const wrapped = Math.abs(lon) <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  return [wrapped, lat];
}

/** Longitude and latitude of every position checked with {@link validPosition}; null if one is not valid. */
function validPositions(positions: readonly Position[]): Position[] | null {
  const result: Position[] = [];
  for (const position of positions) {
    const valid = validPosition(position);
    if (valid === null) return null;
    result.push(valid);
  }
  return result;
}

/**
 * The geometry the map view returned, checked and in the form the model wants, or null if it
 * cannot be stored: positions inside the valid coordinates, rings closed, lines of at least two
 * points, lengths in metres above zero.
 */
export function cleanGeometry(geometry: Geometry): Geometry | null {
  switch (geometry.type) {
    case 'Circle': {
      const center = validPosition(geometry.center);
      return center !== null && Number.isFinite(geometry.radius) && geometry.radius > 0 ? { type: 'Circle', center, radius: geometry.radius } : null;
    }
    case 'Ellipse': {
      const center = validPosition(geometry.center);
      const ok = Number.isFinite(geometry.semiMajorAxis) && geometry.semiMajorAxis > 0 && Number.isFinite(geometry.semiMinorAxis) && geometry.semiMinorAxis > 0 && Number.isFinite(geometry.rotation);
      return center !== null && ok
        ? { type: 'Ellipse', center, semiMajorAxis: geometry.semiMajorAxis, semiMinorAxis: geometry.semiMinorAxis, rotation: ((geometry.rotation % 360) + 360) % 360 }
        : null;
    }
    case 'LineString': {
      const coordinates = validPositions(geometry.coordinates);
      return coordinates !== null && coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
    }
    case 'Polygon': {
      const rings: Position[][] = [];
      for (const ring of geometry.coordinates) {
        const valid = validPositions(ring);
        const first = valid?.[0];
        const last = valid?.[valid.length - 1];
        if (valid === null || first === undefined || last === undefined || valid.length < 4 || first[0] !== last[0] || first[1] !== last[1]) return null;
        rings.push(valid);
      }
      return rings.length > 0 ? { type: 'Polygon', coordinates: rings } : null;
    }
    default:
      return null;
  }
}
