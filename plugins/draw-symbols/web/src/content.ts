// Pure functions that build the content of change requests (ADR-0005, model README rule 5). An
// update replaces all core fields, so every edit starts from `coreOf(latestState)` and changes one
// thing. `extensions` is never part of it: the object store keeps all of them (rule 5).
import { canonicalSidc, MANUAL_DATA_SOURCE } from '@emc2/plugin-sdk';
import type {
  Geometry, MapObject, MapObjectContent, MilSymbol, Modifiers, Point, Position, SecurityLabel, TextModifierName, Uuid,
} from '@emc2/plugin-sdk';

/** The schema limits: modifier text 1 to 128 characters, name up to 256. */
export const MAX_TEXT_LENGTH = 128;
export const MAX_NAME_LENGTH = 256;

/** The text modifiers the properties panel edits (brief, function 4). */
export const EDITABLE_MODIFIERS = ['uniqueDesignation', 'higherFormation', 'additionalInformation'] as const satisfies readonly TextModifierName[];
export type EditableModifier = (typeof EDITABLE_MODIFIERS)[number];

/** A single-point symbol this plugin can edit and move. */
export interface EditableSymbol extends MapObject {
  readonly symbol: MilSymbol;
  readonly geometry: Point;
}

export function isEditableSymbol(object: MapObject): object is EditableSymbol {
  return object.type === 'core.symbol' && object.symbol !== undefined && object.geometry.type === 'Point';
}

/**
 * All core fields of an object, which is what an update sends (model rule 5): `dataType` and
 * `dataSource` (the source unchanged, rule 14) and `time` included, and, as they came, `relations` (an update replaces the
 * whole list, so leaving it out would empty it; brief, function 29) and `fieldSets` (SDK 1.4.0: kept anyway, sent back so that
 * the request says what the object has). No id, version, meta or extensions.
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
    ...(object.relations !== undefined ? { relations: object.relations } : {}),
    ...(object.fieldSets !== undefined ? { fieldSets: object.fieldSets } : {}),
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

export function withName(core: MapObjectContent, text: string): MapObjectContent {
  const name = normalizeText(text, MAX_NAME_LENGTH);
  const properties = { ...omit(core.properties ?? {}, 'name'), ...(name === undefined ? {} : { name }) };
  const without = omit(core, 'properties');
  return Object.keys(properties).length === 0 ? without : { ...without, properties };
}

export function withModifier(core: MapObjectContent, name: EditableModifier, text: string): MapObjectContent {
  if (core.symbol === undefined) return core;
  const value = normalizeText(text, MAX_TEXT_LENGTH);
  const modifiers: Modifiers = { ...omit(core.symbol.modifiers ?? {}, name), ...(value === undefined ? {} : { [name]: value }) };
  const bare = omit(core.symbol, 'modifiers');
  const symbol: MilSymbol = Object.keys(modifiers).length === 0 ? bare : { ...bare, modifiers };
  return { ...omit(core, 'symbol'), symbol };
}

/** Sets the machine modifier `direction` (degrees from true north) or `speed` (m/s); null removes it. Other modifiers stay. */
function withMotion(core: MapObjectContent, name: 'direction' | 'speed', value: number | null): MapObjectContent {
  if (core.symbol === undefined) return core;
  const modifiers: Modifiers = { ...omit(core.symbol.modifiers ?? {}, name), ...(value === null ? {} : { [name]: value }) };
  const bare = omit(core.symbol, 'modifiers');
  const symbol: MilSymbol = Object.keys(modifiers).length === 0 ? bare : { ...bare, modifiers };
  return { ...omit(core, 'symbol'), symbol };
}

/** The heading in degrees from true north (modifier `direction`; 0 to under 360), or null if the symbol has none. */
export const withDirection = (core: MapObjectContent, degrees: number | null): MapObjectContent => withMotion(core, 'direction', degrees);

/** The speed in m/s (modifier `speed`, 0 or more), or null if the symbol has none. */
export const withSpeed = (core: MapObjectContent, mps: number | null): MapObjectContent => withMotion(core, 'speed', mps);

/** The altitude of a point in metres above the WGS84 ellipsoid (the third coordinate), or null if it has none. */
export function altitudeOf(geometry: Geometry): number | null {
  return geometry.type === 'Point' ? (geometry.coordinates[2] ?? null) : null;
}

/** Sets the altitude of a point (metres, HAE) and keeps its longitude and latitude; null removes it. */
export function withAltitude(core: MapObjectContent, metres: number | null): MapObjectContent {
  if (core.geometry.type !== 'Point') return core;
  const [lon, lat] = core.geometry.coordinates;
  const coordinates: Position = metres === null ? [lon, lat] : [lon, lat, metres];
  return { ...core, geometry: { type: 'Point', coordinates } };
}

/** Replaces the SIDC, written in its canonical form. */
export function withSidc(core: MapObjectContent, sidc: string): MapObjectContent {
  if (core.symbol === undefined) return core;
  return { ...core, symbol: { ...core.symbol, sidc: canonicalSidc(core.symbol.standard, sidc) } };
}

export function withLayer(core: MapObjectContent, layerId: Uuid): MapObjectContent {
  return { ...core, layerId };
}

/** Moves a point. Longitude and latitude are replaced; an altitude the object had is kept. */
export function withPosition(core: MapObjectContent, position: Position): MapObjectContent {
  if (core.geometry.type !== 'Point') return core;
  const altitude = core.geometry.coordinates[2];
  const coordinates: Position = altitude === undefined ? [position[0], position[1]] : [position[0], position[1], altitude];
  return { ...core, geometry: { type: 'Point', coordinates } };
}

/** The point of an object, or null if its geometry is not a point. */
export function pointOf(geometry: Geometry): Position | null {
  return geometry.type === 'Point' ? geometry.coordinates : null;
}

/**
 * Whether `position` (lon, lat) is inside the map view's visible ring. A ring that cannot be tested in lon/lat
 * (it crosses the antimeridian or encloses a pole: an edge spans more than 180 degrees of longitude) counts
 * as showing everything, so that no one is told "not in view" wrongly.
 */
export function isInsideRing(position: Position, ring: readonly Position[]): boolean {
  if (ring.length < 4) return true;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i] as Position;
    const b = ring[i + 1] as Position;
    if (Math.abs(a[0] - b[0]) > 180) return true;
  }
  const [x, y] = position;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A position the model accepts, in WGS84 longitude, latitude (ADR-0007), or null. A longitude
 * outside ±180 (a wrapped world) is brought back; a latitude outside ±90 is refused.
 */
export function validPosition(position: Position): Position | null {
  const [lon, lat] = position;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  const wrapped = Math.abs(lon) <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
  const altitude = position[2];
  return altitude === undefined ? [wrapped, lat] : [wrapped, lat, altitude];
}

/** Changes the data type; the data source stays as it is (it is fixed at creation, model rule 14). */
export function withDataType(core: MapObjectContent, dataType: string): MapObjectContent {
  return { ...core, dataType };
}

/** The content of a new symbol: the point of a click, without altitude, of the chosen data type, drawn by hand (`manual`). */
export function newSymbolContent(args: {
  readonly layerId: Uuid;
  readonly position: Position;
  readonly symbol: MilSymbol;
  readonly label: SecurityLabel;
  readonly dataType: string;
}): MapObjectContent {
  return {
    type: 'core.symbol',
    dataType: args.dataType,
    dataSource: MANUAL_DATA_SOURCE,
    layerId: args.layerId,
    geometry: { type: 'Point', coordinates: [args.position[0], args.position[1]] },
    symbol: { standard: args.symbol.standard, sidc: canonicalSidc(args.symbol.standard, args.symbol.sidc) },
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
