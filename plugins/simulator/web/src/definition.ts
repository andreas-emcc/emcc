// The route's extension as the route editor changes it (brief functions 4 to 6, 9 and 13; the
// plugin's README, "The route's extension"). It keeps only what users type, in m/s and metres. The
// editor changes it at the JSON level, so that every field it does not know stays as it was.
import type { JsonValue, LineString, MapObject, Position } from '@emc2/plugin-sdk';
import { PLUGIN_ID } from './picture.ts';
import type { SpeedUnit } from './units.ts';

export type Json = { readonly [key: string]: JsonValue };
export type Kind = 'instant' | 'ramp';
export type From = 'previous' | 'start';

/** The server part's limits (the owner's open question 17), whatever unit is shown. */
export const MAX_POINTS = 1000;
export const MAX_SPEED = 2000;
export const MIN_ALTITUDE = -1000;
export const MAX_ALTITUDE = 30_000;
export const MAX_SECONDS = 7 * 24 * 3600;
export const MIN_POINTS = 2;
/** A new route's speed at every point: 30 km/h (open question 10). */
export const NEW_ROUTE_SPEED = 30 / 3.6;

export interface TypedTime {
  readonly seconds: number;
  readonly from: From;
  readonly unit: SpeedUnit;
}

/** One point's values, as the editor shows them. */
export interface PointValues {
  readonly speedKind: Kind;
  readonly speed: number | null;
  readonly time: TypedTime | null;
  readonly altitudeKind: Kind;
  readonly altitude: number | null;
  readonly events: readonly Json[];
}

export function isJson(value: JsonValue | undefined): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The simulator's extension of a route, or an empty one. */
export function extensionOf(route: MapObject): Json {
  return route.extensions?.[PLUGIN_ID] ?? {};
}

/** The route's line, or null for another geometry. */
export function lineOf(route: MapObject): LineString | null {
  return route.geometry.type === 'LineString' ? route.geometry : null;
}

function finite(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function kind(value: JsonValue | undefined): Kind {
  return value === 'ramp' ? 'ramp' : 'instant';
}

function speedUnit(value: JsonValue | undefined): SpeedUnit {
  return value === 'kmh' || value === 'kn' || value === 'mph' ? value : 'mps';
}

/** The entries of `points`, as many as the line has points: missing ones read as empty. */
export function pointEntries(ext: Json, count: number): Json[] {
  const raw = Array.isArray(ext['points']) ? (ext['points'] as readonly JsonValue[]) : [];
  return Array.from({ length: count }, (_, i) => {
    const entry = raw[i];
    return isJson(entry) ? entry : {};
  });
}

export function pointValues(entry: Json): PointValues {
  const t = entry['time'];
  const seconds = isJson(t) ? finite(t['seconds']) : null;
  return {
    speedKind: kind(entry['speedKind']),
    speed: finite(entry['speed']),
    time: isJson(t) && seconds !== null ? { seconds, from: t['from'] === 'start' ? 'start' : 'previous', unit: speedUnit(t['unit']) } : null,
    altitudeKind: kind(entry['altitudeKind']),
    altitude: finite(entry['altitude']),
    events: Array.isArray(entry['events']) ? (entry['events'] as readonly JsonValue[]).filter(isJson) : [],
  };
}

/** The extension with point `i`'s entry replaced; the entries stay one per point of a line of `count` points. */
export function withPoint(ext: Json, count: number, i: number, change: (entry: Json) => Json): Json {
  const entries = pointEntries(ext, count);
  entries[i] = change(entries[i] ?? {});
  return { ...ext, points: entries };
}

/** An entry without `key`. */
export function without(entry: Json, key: string): Json {
  return Object.fromEntries(Object.entries(entry).filter(([k]) => k !== key));
}

/**
 * A new point's entry: the previous point's speed, time kind and altitude, with their kinds (open
 * question 10), without its time and events, which belong to that point.
 */
export function copiedEntry(previous: Json | undefined, computedSpeed: number | null = null): Json {
  if (previous === undefined) return { speedKind: 'instant', speed: NEW_ROUTE_SPEED, altitudeKind: 'instant' };
  const v = pointValues(previous);
  // A point with only a typed time has no speed of its own: the computed one, when known.
  const speed = v.speed ?? computedSpeed;
  return {
    speedKind: v.speedKind,
    ...(speed === null ? {} : { speed }),
    altitudeKind: v.altitudeKind,
    ...(v.altitude === null ? {} : { altitude: v.altitude }),
  };
}

/** A new route's extension (A36): every point a step to 30 km/h, the altitude empty; it stops at its end. */
export function newRouteExtension(count: number): Json {
  return { points: Array.from({ length: count }, () => copiedEntry(undefined)), end: 'stop' };
}

/** The line and extension with a point inserted after point `i` (Q13), the new entry copied from point `i`. */
export function insertPoint(line: LineString, ext: Json, i: number, at: Position, computedSpeed: number | null = null): { readonly line: LineString; readonly ext: Json } {
  const count = line.coordinates.length;
  const entries = pointEntries(ext, count);
  entries.splice(i + 1, 0, copiedEntry(entries[i], computedSpeed));
  const coordinates = [...line.coordinates];
  coordinates.splice(i + 1, 0, at);
  return { line: { type: 'LineString', coordinates }, ext: { ...ext, points: entries } };
}

/**
 * The line and extension with `added` after the last point (function 49, "Append"): each new point
 * copies the last point's entry, as "Insert point after" does (`copiedEntry`).
 */
export function appendPoints(line: LineString, ext: Json, added: readonly Position[], computedSpeed: number | null = null): { readonly line: LineString; readonly ext: Json } {
  const entries = pointEntries(ext, line.coordinates.length);
  const last = entries.at(-1);
  for (let i = 0; i < added.length; i++) entries.push(copiedEntry(last, computedSpeed));
  return { line: { type: 'LineString', coordinates: [...line.coordinates, ...added] }, ext: { ...ext, points: entries } };
}

/**
 * The line and extension without point `i` and its events (A41). A new first point loses its typed
 * time: the route's start has none (the review of C2).
 */
export function deletePoint(line: LineString, ext: Json, i: number): { readonly line: LineString; readonly ext: Json } {
  const entries = pointEntries(ext, line.coordinates.length);
  entries.splice(i, 1);
  const first = entries[0];
  if (i === 0 && first !== undefined) entries[0] = without(first, 'time');
  return { line: { type: 'LineString', coordinates: line.coordinates.filter((_, j) => j !== i) }, ext: { ...ext, points: entries } };
}

/** The extension with the move-or-disconnect choice of a new line edit (function 9, A40): the number is one above any seen. */
export function withEditChoice(ext: Json, objects: 'move' | 'disconnect'): Json {
  const edit = ext['edit'];
  const last = isJson(edit) ? (finite(edit['number']) ?? 0) : 0;
  return { ...ext, edit: { number: Math.floor(last) + 1, objects } };
}

/** The ids on a route's list, in list order, with their group kind. */
export function listedObjects(ext: Json): { readonly id: string; readonly kind: string }[] {
  const groups = Array.isArray(ext['groups']) ? (ext['groups'] as readonly JsonValue[]) : [];
  const out: { id: string; kind: string }[] = [];
  for (const g of groups) {
    if (!isJson(g) || !Array.isArray(g['objects'])) continue;
    const groupKind = typeof g['kind'] === 'string' ? g['kind'] : 'single';
    for (const o of g['objects'] as readonly JsonValue[]) {
      if (isJson(o) && typeof o['id'] === 'string') out.push({ id: o['id'].toLowerCase(), kind: groupKind });
    }
  }
  return out;
}

/**
 * A typed time: `h:mm:ss`, `m:ss` or seconds, with a point or a comma for decimals; null for empty
 * text, NaN for text that is none of these.
 */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d*)?$|^\.\d+$/.test(p))) return Number.NaN;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((n) => n >= 60)) return Number.NaN;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}

/** Seconds as `h:mm:ss`, with tenths when it has them. */
export function formatTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const fraction = tenths % 10 === 0 ? '' : `.${String(tenths % 10)}`;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${fraction}`;
}
