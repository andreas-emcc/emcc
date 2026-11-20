// Pure functions that build the content of change requests (ADR-0005, model README rule 5). An
// update replaces all core fields, so every edit starts from `coreOf(latestState)` and changes one
// thing. `extensions` is never part of it: the object store keeps all of them (rule 5), so other
// plugins' namespaces survive an update without being sent. This plugin writes no extension of its own.
import { MANUAL_DATA_SOURCE } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry, Geometry, MapObjectContent, MilSymbol, Position, SecurityLabel, Uuid } from '@emc2/plugin-sdk';

/** The schema limit of a name. */
export const MAX_NAME_LENGTH = 256;

/** The object type of a tactical graphic. */
export const GRAPHIC_TYPE = 'core.multipoint';

export function isGraphicObject(object: MapObjectContent): boolean {
  return object.type === GRAPHIC_TYPE;
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

/** The name of the graphic, `properties.name`. Other properties (a description) are kept. */
export function withName(core: MapObjectContent, text: string): MapObjectContent {
  const name = normalizeText(text, MAX_NAME_LENGTH);
  const properties = { ...omit(core.properties ?? {}, 'name'), ...(name === undefined ? {} : { name }) };
  const without = omit(core, 'properties');
  return Object.keys(properties).length === 0 ? without : { ...without, properties };
}

export function withLayer(core: MapObjectContent, layerId: Uuid): MapObjectContent {
  return { ...core, layerId };
}

export function withGeometry(core: MapObjectContent, geometry: Geometry): MapObjectContent {
  return { ...core, geometry };
}

/** Replaces the symbol (the SIDC or the amplifiers); `modifiers` left out removes them. */
export function withSymbol(core: MapObjectContent, symbol: MilSymbol): MapObjectContent {
  return { ...core, symbol };
}

/** A symbol with new modifiers, or without any. */
export function symbolWith(symbol: MilSymbol, modifiers: MilSymbol['modifiers'] | undefined): MilSymbol {
  const bare = omit(symbol, 'modifiers');
  return modifiers === undefined || Object.keys(modifiers).length === 0 ? bare : { ...bare, modifiers };
}

/**
 * The content of a new graphic (brief, function 3): `core.multipoint` in the active layer, of the
 * given data type (the controller always passes `core.general`), drawn by hand (`manual`), with the symbol, the control points as the catalogue's
 * geometry type and the name as `properties.name`. No extension of its own is written.
 */
export function newGraphicContent(args: {
  readonly symbol: MilSymbol;
  readonly geometry: Geometry;
  readonly name: string;
  readonly layerId: Uuid;
  readonly dataType: string;
  readonly label: SecurityLabel;
}): MapObjectContent {
  const name = normalizeText(args.name, MAX_NAME_LENGTH);
  return {
    type: GRAPHIC_TYPE,
    dataType: args.dataType,
    dataSource: MANUAL_DATA_SOURCE,
    layerId: args.layerId,
    geometry: args.geometry,
    symbol: args.symbol,
    ...(name === undefined ? {} : { properties: { name } }),
    label: args.label,
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
 * outside ±180 (a wrapped world) is brought back; a latitude outside ±90 is refused. An altitude a
 * position has is kept.
 */
export function validPosition(position: Position): Position | null {
  const [lon, lat, altitude] = position;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  const wrapped = Math.abs(lon) <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  return altitude !== undefined && Number.isFinite(altitude) ? [wrapped, lat, altitude] : [wrapped, lat];
}

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
 * The control points of a graphic's geometry (brief, function 2): a `LineString`'s or a `MultiPoint`'s
 * positions, or a `Polygon`'s exterior ring without its closing position. Null for any other geometry.
 */
export function controlPointsOf(geometry: Geometry): Position[] | null {
  switch (geometry.type) {
    case 'LineString':
    case 'MultiPoint':
      return [...geometry.coordinates];
    case 'Polygon': {
      const ring = geometry.coordinates[0];
      const first = ring?.[0];
      const last = ring?.[ring.length - 1];
      if (ring === undefined || first === undefined || last === undefined) return null;
      const closed = ring.length > 1 && first[0] === last[0] && first[1] === last[1];
      return closed ? ring.slice(0, -1) : [...ring];
    }
    default:
      return null;
  }
}

/** The geometry a graphic stores for its control points, as the catalogue says (`geometry`); a `Polygon` is closed. */
export function geometryFor(entry: Pick<GraphicCatalogEntry, 'geometry'>, points: readonly Position[]): Geometry | null {
  const checked = validPositions(points);
  const first = checked?.[0];
  if (checked === null || first === undefined) return null;
  switch (entry.geometry) {
    case 'LineString':
      return { type: 'LineString', coordinates: checked };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: checked };
    case 'Polygon':
      return { type: 'Polygon', coordinates: [[...checked, first]] };
  }
}

/** The control points the map view returned, checked, or null if they cannot be stored (a position outside the valid coordinates). */
export function cleanControlPoints(geometry: Geometry): Position[] | null {
  const points = controlPointsOf(geometry);
  return points === null ? null : validPositions(points);
}

/**
 * The geometry an edited graphic is stored as: the same type it had, with the new control points. Null if the
 * edit gave another type or a position that cannot be stored.
 */
export function reshapedGeometry(before: Geometry, after: Geometry): Geometry | null {
  if (before.type !== after.type) return null;
  const points = cleanControlPoints(after);
  const first = points?.[0];
  if (points === null || first === undefined) return null;
  switch (before.type) {
    case 'LineString':
      return { type: 'LineString', coordinates: points };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: points };
    case 'Polygon':
      return { type: 'Polygon', coordinates: [[...points, first]] };
    default:
      return null;
  }
}

