/**
 * The plugin's settings (plugin.json), checked where they are read (design pattern section 7). A
 * bad value is replaced by its default and reported as a problem, so the map still starts.
 */
import type { JsonValue, Position, RenderingMode } from '@emc2/plugin-sdk';

/** `[minX, minY, maxX, maxY]`. */
export type Extent = readonly [number, number, number, number];

/** A map projection from the settings (overview 4.7, spike S2: polar projections need both extents). */
export interface ProjectionDef {
  readonly code: string;
  readonly proj4: string;
  /** In projected units. */
  readonly extent: Extent;
  /** In lon/lat degrees. */
  readonly worldExtent: Extent;
}

export interface MapSettings {
  readonly projections: readonly ProjectionDef[];
  readonly initialProjection: string;
  readonly initialCenter: Position;
  readonly initialZoom: number;
  readonly textThreshold: number;
  readonly updateCadenceMs: number;
  /** Background provider names in order of preference, for choosing after a projection switch (brief function 3). */
  readonly preferredBackgrounds: readonly string[];
  /** The most objects drawn one by one without a GPU (brief functions 9 and 12, ADR-0017). */
  readonly softwareBudget: number;
  /** The most objects drawn one by one with a GPU (brief function 12, spike S3 recommendation 6). */
  readonly hardwareBudget: number;
  /** The highest dim level of the background map, in percent (brief function 19). */
  readonly highestDim: number;
  /** How wide Zoom to shows one object, and the closest it goes for several, in metres (brief function 16). */
  readonly zoomToWidthMetres: number;
}

/** The manifest's defaults (a test keeps the two equal). */
export const DEFAULT_SETTINGS: MapSettings = {
  projections: [
    {
      code: 'EPSG:3857',
      proj4: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
      extent: [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244],
      worldExtent: [-180, -85.0511287798066, 180, 85.0511287798066],
    },
    {
      code: 'EPSG:3413',
      proj4: '+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
      extent: [-4194304, -4194304, 4194304, 4194304],
      worldExtent: [-180, 30, 180, 90],
    },
    {
      code: 'EPSG:3031',
      proj4: '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
      extent: [-4194304, -4194304, 4194304, 4194304],
      worldExtent: [-180, -90, 180, -30],
    },
  ],
  initialProjection: 'EPSG:3857',
  initialCenter: [15, 62],
  initialZoom: 5,
  textThreshold: 2000,
  updateCadenceMs: 1000,
  preferredBackgrounds: ['OpenStreetMap', 'Natural Earth'],
  softwareBudget: 10000,
  hardwareBudget: 100000,
  highestDim: 90,
  zoomToWidthMetres: 10_000,
};

/**
 * The object budget for a rendering mode (brief function 12): with a GPU the hardware budget,
 * otherwise the software one (without WebGL nothing is drawn, so the smaller one is enough).
 */
export function objectBudget(settings: MapSettings, mode: RenderingMode): number {
  return mode === 'hardware' ? settings.hardwareBudget : settings.softwareBudget;
}

const MAX_CODE_LENGTH = 64;
const MAX_PROJ4_LENGTH = 2000;
const MAX_PROJECTIONS = 50;
const MAX_BACKGROUND_NAMES = 50;
const MAX_NAME_LENGTH = 200;

export interface SettingsResult {
  readonly settings: MapSettings;
  /** One English sentence per bad value; empty when all are fine. */
  readonly problems: readonly string[];
}

/** Reads the settings the shell passes (v0: the manifest defaults). Missing values take their default silently. */
export function readSettings(raw: { readonly [name: string]: JsonValue }): SettingsResult {
  const problems: string[] = [];

  const integer = (name: keyof MapSettings, min: number, max: number, fallback: number): number => {
    const value = raw[name];
    if (value === undefined) return fallback;
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value;
    problems.push(`setting ${name} must be an integer from ${String(min)} to ${String(max)}; using ${String(fallback)}`);
    return fallback;
  };

  const projections = readProjections(raw['projections'], problems);
  const initialProjection = readInitialProjection(raw['initialProjection'], projections, problems);
  const initialCenter = readCenter(raw['initialCenter'], problems);

  let initialZoom = DEFAULT_SETTINGS.initialZoom;
  const zoom = raw['initialZoom'];
  if (zoom !== undefined) {
    if (typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 0 && zoom <= 28) initialZoom = zoom;
    else problems.push(`setting initialZoom must be a number from 0 to 28; using ${String(initialZoom)}`);
  }

  return {
    settings: {
      projections,
      initialProjection,
      initialCenter,
      initialZoom,
      textThreshold: integer('textThreshold', 0, 100_000, DEFAULT_SETTINGS.textThreshold),
      // Never so fast that it blocks the main thread (brief function 5, spike S2).
      updateCadenceMs: integer('updateCadenceMs', 250, 60_000, DEFAULT_SETTINGS.updateCadenceMs),
      preferredBackgrounds: readNames(raw['preferredBackgrounds'], problems),
      softwareBudget: integer('softwareBudget', 1, 10_000_000, DEFAULT_SETTINGS.softwareBudget),
      hardwareBudget: integer('hardwareBudget', 1, 10_000_000, DEFAULT_SETTINGS.hardwareBudget),
      highestDim: integer('highestDim', 0, 90, DEFAULT_SETTINGS.highestDim),
      zoomToWidthMetres: integer('zoomToWidthMetres', 100, 1_000_000, DEFAULT_SETTINGS.zoomToWidthMetres),
    },
    problems,
  };
}

function readProjections(value: JsonValue | undefined, problems: string[]): readonly ProjectionDef[] {
  if (value === undefined) return DEFAULT_SETTINGS.projections;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROJECTIONS) {
    problems.push(`setting projections must be a list of 1 to ${String(MAX_PROJECTIONS)} projections; using the defaults`);
    return DEFAULT_SETTINGS.projections;
  }
  const result: ProjectionDef[] = [];
  value.forEach((entry: JsonValue, index) => {
    const problem = projectionProblem(entry);
    if (problem !== null) {
      problems.push(`setting projections[${String(index)}] is ignored: ${problem}`);
      return;
    }
    const def = entry as unknown as ProjectionDef;
    if (result.some((p) => p.code === def.code)) {
      problems.push(`setting projections[${String(index)}] is ignored: ${def.code} is configured twice`);
      return;
    }
    result.push({ code: def.code, proj4: def.proj4, extent: [...def.extent] as Extent, worldExtent: [...def.worldExtent] as Extent });
  });
  if (result.length === 0) {
    problems.push('no usable projection in setting projections; using the defaults');
    return DEFAULT_SETTINGS.projections;
  }
  return result;
}

function projectionProblem(entry: JsonValue): string | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'not an object';
  const object = entry as { readonly [key: string]: JsonValue };
  const code = object['code'];
  const text = object['proj4'];
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) return 'code must be a non-empty text';
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PROJ4_LENGTH) return 'proj4 must be a non-empty text';
  if (!isExtent(object['extent'])) return 'extent must be [minX, minY, maxX, maxY] with min < max';
  const world = object['worldExtent'];
  if (!isExtent(world)) return 'worldExtent must be [minLon, minLat, maxLon, maxLat] with min < max';
  const [minLon, minLat, maxLon, maxLat] = world;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return 'worldExtent must lie within ±180° longitude and ±90° latitude';
  return null;
}

function isExtent(value: JsonValue | undefined): value is Extent {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [minX, minY, maxX, maxY] = value as readonly JsonValue[];
  return isFiniteNumber(minX) && isFiniteNumber(minY) && isFiniteNumber(maxX) && isFiniteNumber(maxY) && minX < maxX && minY < maxY;
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readInitialProjection(value: JsonValue | undefined, projections: readonly ProjectionDef[], problems: string[]): string {
  const first = projections[0]?.code ?? DEFAULT_SETTINGS.initialProjection;
  const wanted = value ?? DEFAULT_SETTINGS.initialProjection;
  if (typeof wanted === 'string' && projections.some((p) => p.code === wanted)) return wanted;
  problems.push(`setting initialProjection must be one of the configured projections; using ${first}`);
  return first;
}

function readNames(value: JsonValue | undefined, problems: string[]): readonly string[] {
  if (value === undefined) return DEFAULT_SETTINGS.preferredBackgrounds;
  if (Array.isArray(value) && value.length <= MAX_BACKGROUND_NAMES) {
    const names = value.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH);
    if (names.length === value.length) return names;
  }
  problems.push(`setting preferredBackgrounds must be a list of up to ${String(MAX_BACKGROUND_NAMES)} provider names; using the default`);
  return DEFAULT_SETTINGS.preferredBackgrounds;
}

function readCenter(value: JsonValue | undefined, problems: string[]): Position {
  if (value === undefined) return DEFAULT_SETTINGS.initialCenter;
  if (Array.isArray(value) && value.length === 2) {
    const [lon, lat] = value as readonly JsonValue[];
    if (typeof lon === 'number' && typeof lat === 'number' && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) return [lon, lat];
  }
  problems.push('setting initialCenter must be [longitude, latitude] in degrees; using the default');
  return DEFAULT_SETTINGS.initialCenter;
}
