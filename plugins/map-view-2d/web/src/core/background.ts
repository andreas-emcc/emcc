/**
 * Background maps (brief function 3): the providers registered by background map plugins, only
 * those that support the current projection, and the one shown. Without one, the map shows a
 * neutral background and a graticule. Tiles must come from the emc2 server (CSP `'self'`,
 * ADR-0014), so a provider whose URL points elsewhere is refused. A vector source (SDK v1,
 * ADR-0025) supports any projection; the map view draws it itself. A WMS source (SDK 1.3.0, ADR-0035)
 * is drawn only in the projections it lists.
 */
import type { BackgroundMapProvider, JsonValue, WmsSource } from '@emc2/plugin-sdk';
import { wmsSourceProblem } from './wms.ts';

const MAX_VECTOR_LAYERS = 100;

/** Why a provider cannot be used, or null. `origin`: the page's origin, e.g. `http://127.0.0.1:8080`. */
export function providerProblem(provider: BackgroundMapProvider, origin: string): string | null {
  const { source } = provider;
  // Checked at runtime: the provider is another plugin's data.
  const type: string = source.type;
  if (source.type === 'vector') return vectorProblem(provider);
  if (source.type === 'wms') return wmsProblem(provider, source, origin);
  if (type !== 'xyz') return `source type ${type} is not supported`;
  if (!['{z}', '{x}', '{y}'].every((p) => source.url.includes(p))) return 'the tile URL needs {z}, {x} and {y}';
  if (!isSameOrigin(source.url, origin)) return 'the tile URL must point to the emc2 server';
  const { minZoom, maxZoom, tileSize } = source;
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || maxZoom > 30 || minZoom > maxZoom) {
    return 'minZoom and maxZoom must be whole numbers with 0 ≤ minZoom ≤ maxZoom ≤ 30';
  }
  if (!Number.isInteger(tileSize) || tileSize < 64 || tileSize > 1024) return 'tileSize must be a whole number from 64 to 1024';
  if (provider.projections === 'any') return 'tiles need a list of projections, not any';
  if (provider.projections.length === 0) return 'it supports no projection';
  return null;
}

/** A WMS source (SDK 1.3.0, ADR-0035) is checked like a tile source: on the emc2 server, and for a list of projections. */
function wmsProblem(provider: BackgroundMapProvider, source: WmsSource, origin: string): string | null {
  if (typeof source.url !== 'string' || !isSameOrigin(source.url, origin)) return 'the wms URL must point to the emc2 server';
  const problem = wmsSourceProblem(source);
  if (problem !== null) return problem;
  const projections: unknown = provider.projections;
  if (projections === 'any') return 'a wms source needs a list of projections, not any';
  if (!Array.isArray(projections) || projections.length === 0 || projections.some((code) => typeof code !== 'string')) return 'it supports no projection';
  return null;
}

function vectorProblem(provider: BackgroundMapProvider): string | null {
  const { source } = provider;
  if (source.type !== 'vector') return null;
  if (typeof source.load !== 'function') return 'a vector source needs load()';
  if (source.background !== undefined && !/^#[0-9a-fA-F]{6}$/.test(source.background)) return 'background must be a colour #rrggbb';
  const layers: unknown = source.layers;
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > MAX_VECTOR_LAYERS) return `a vector source needs 1 to ${String(MAX_VECTOR_LAYERS)} layers`;
  const ids = new Set<string>();
  for (const layer of layers as readonly { readonly id?: unknown; readonly style?: unknown }[]) {
    if (typeof layer.id !== 'string' || layer.id.length === 0 || ids.has(layer.id)) return 'every vector layer needs its own id';
    if (typeof layer.style !== 'object' || layer.style === null) return `vector layer ${layer.id} needs a style`;
    ids.add(layer.id);
  }
  if (provider.projections !== 'any' && provider.projections.length === 0) return 'it supports no projection';
  return null;
}

function isSameOrigin(url: string, origin: string): boolean {
  // The browser's URL parser drops tabs and line breaks and reads a backslash as a slash, so a
  // tile URL that looks local could end up on another host: refuse such characters outright,
  // then let the parser confirm the origin.
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return false; // whitespace, control characters, backslash
  }
  if (!url.startsWith('/') && !url.startsWith(`${origin}/`)) return false;
  try {
    return new URL(url, `${origin}/`).origin === origin;
  } catch {
    return false;
  }
}

/** Whether a provider supports a projection: it lists the code, or supports any (a vector source, ADR-0025). */
export function supportsProjection(provider: BackgroundMapProvider, projection: string): boolean {
  return provider.projections === 'any' || provider.projections.includes(projection);
}

/** The usable providers that support a projection, in registration order. */
export function compatibleProviders(providers: readonly BackgroundMapProvider[], projection: string, origin: string): BackgroundMapProvider[] {
  return providers.filter((p) => supportsProjection(p, projection) && providerProblem(p, origin) === null);
}

/**
 * The background chosen by the user in each projection, kept per browser (brief function 3):
 * projection code → provider id, or null for "no background map".
 */
export type BackgroundChoices = Readonly<Record<string, string | null>>;

/**
 * The provider to show in a projection (brief function 3, "choosing after a switch"):
 * 1. the user's current choice (`current`), if it fits: null ("None") fits every projection;
 * 2. otherwise the user's last choice in this projection (`inProjection`);
 * 3. otherwise the first available one in the order of `preferred` (provider names);
 * 4. otherwise the first available one, so the map is never left without a background while one is.
 * `undefined` means no choice yet. A choice the map made itself is never a user's choice.
 */
export function chooseBackground(
  choice: { readonly current: string | null | undefined; readonly inProjection: string | null | undefined },
  preferred: readonly string[],
  compatible: readonly BackgroundMapProvider[],
): BackgroundMapProvider | null {
  for (const wanted of [choice.current, choice.inProjection]) {
    if (wanted === null) return null;
    const found = compatible.find((p) => p.id === wanted);
    if (found !== undefined) return found;
  }
  for (const name of preferred) {
    const found = compatible.find((p) => p.name === name);
    if (found !== undefined) return found;
  }
  return compatible[0] ?? null;
}

/** Where the choices are kept: the browser's local storage, or memory in tests. */
export interface ChoiceStore {
  load(): BackgroundChoices;
  save(choices: BackgroundChoices): void;
}

/** The storage key, in the plugin's own namespace. */
export const CHOICES_KEY = 'emc2.map-view-2d.backgrounds';

/**
 * Choices kept in a `Storage` (the browser's `localStorage`). Storage can be missing or refuse
 * (private mode, full, blocked): then the choices last for the page only.
 */
export function storageChoices(storage: () => Pick<Storage, 'getItem' | 'setItem'>): ChoiceStore {
  return {
    load: () => {
      try {
        return parseChoices(storage().getItem(CHOICES_KEY));
      } catch {
        return {};
      }
    },
    save: (choices) => {
      try {
        storage().setItem(CHOICES_KEY, JSON.stringify(choices));
      } catch {
        // Kept for this page only.
      }
    },
  };
}

const MAX_CHOICES = 50;
const MAX_TEXT = 200;

/** The kept choices from their stored text; anything malformed is dropped (it is the browser's data). */
export function parseChoices(text: string | null): BackgroundChoices {
  if (text === null) return {};
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string | null> = {};
  for (const [code, id] of Object.entries(value).slice(0, MAX_CHOICES)) {
    if (code.length > MAX_TEXT) continue;
    if (id === null || (typeof id === 'string' && id.length > 0 && id.length <= MAX_TEXT)) result[code] = id;
  }
  return result;
}
