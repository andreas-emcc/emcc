/**
 * WMS backgrounds (brief function 3, M4; SDK 1.3.0 `WmsSource`; ADR-0035): what the map view
 * decides before OpenLayers draws anything. The request URL is built here, as the test kit's
 * `wmsGetMapUrl` builds it (the contract with the plugin's server part): the same parameters, each
 * once and nothing else, with WMS 1.3.0's latitude-first box for EPSG:4326, and never a box beyond
 * the projection's extent.
 */
import type { WmsSource } from '@emc2/plugin-sdk';

/** `[minX, minY, maxX, maxY]` in a projection's own coordinates. */
export type Box = readonly [number, number, number, number];

export const WMS_VERSIONS: readonly string[] = ['1.1.1', '1.3.0'];
export const WMS_FORMATS: readonly string[] = ['image/png', 'image/jpeg'];
export const DEFAULT_WMS_TILE_SIZE = 256;
/** The largest `WIDTH` and `HEIGHT` a request may have (the SDK's contract). */
export const MAX_WMS_SIDE = 4096;

/** Why a `wms` source cannot be used, or null. The URL and the projections are checked by the caller. */
export function wmsSourceProblem(source: WmsSource): string | null {
  // Checked at runtime: the provider is another plugin's data.
  const layers: unknown = source.layers;
  if (!Array.isArray(layers) || layers.length === 0 || layers.some((l) => typeof l !== 'string' || l.length === 0)) return 'a wms source needs at least one layer name';
  if (!WMS_VERSIONS.includes(source.version)) return 'the wms version must be 1.1.1 or 1.3.0';
  if (!WMS_FORMATS.includes(source.format)) return 'the wms format must be image/png or image/jpeg';
  const transparent: unknown = source.transparent;
  if (transparent !== undefined && typeof transparent !== 'boolean') return 'transparent must be true or false';
  if (transparent === true && source.format !== 'image/png') return 'transparent needs the format image/png';
  const mode: unknown = source.mode;
  if (mode !== undefined && mode !== 'tiles' && mode !== 'image') return "mode must be 'tiles' or 'image'";
  const tileSize: unknown = source.tileSize;
  if (tileSize !== undefined && (typeof tileSize !== 'number' || !Number.isInteger(tileSize) || tileSize < 64 || tileSize > 1024)) return 'tileSize must be a whole number from 64 to 1024';
  return null;
}

/** The GetMap URL of a box: `wmsGetMapUrl` of the SDK's test kit, for the map view's own requests. */
export function wmsRequestUrl(source: WmsSource, code: string, box: Box, width: number, height: number): string {
  const latitudeFirst = source.version === '1.3.0' && code === 'EPSG:4326';
  const [minX, minY, maxX, maxY] = box;
  const ordered = latitudeFirst ? [minY, minX, maxY, maxX] : [minX, minY, maxX, maxY];
  const query = new URLSearchParams([
    ['SERVICE', 'WMS'],
    ['REQUEST', 'GetMap'],
    ['VERSION', source.version],
    ['LAYERS', source.layers.join(',')],
    ['STYLES', ''],
    ['FORMAT', source.format],
    ['TRANSPARENT', source.transparent === true ? 'TRUE' : 'FALSE'],
    [source.version === '1.3.0' ? 'CRS' : 'SRS', code],
    ['BBOX', ordered.map(String).join(',')],
    ['WIDTH', String(width)],
    ['HEIGHT', String(height)],
  ]);
  return `${source.url}${source.url.includes('?') ? '&' : '?'}${query.toString()}`;
}

/** The box with each edge held inside the extent: float arithmetic can put a tile's edge a hair beyond it. */
export function clampBox(box: Box, extent: Box): Box {
  return [Math.max(box[0], extent[0]), Math.max(box[1], extent[1]), Math.min(box[2], extent[2]), Math.min(box[3], extent[3])];
}

/** The box cut to the extent; null if nothing of it is inside. */
export function clipBox(box: Box, extent: Box): Box | null {
  const clipped: Box = [Math.max(box[0], extent[0]), Math.max(box[1], extent[1]), Math.min(box[2], extent[2]), Math.min(box[3], extent[3])];
  return clipped[0] < clipped[2] && clipped[1] < clipped[3] ? clipped : null;
}

/**
 * The size in pixels of an image of a box at a resolution (map units per pixel): whole numbers, at
 * least 1 and at most {@link MAX_WMS_SIDE}. A larger view asks for a smaller image, which is drawn
 * scaled up.
 */
export function imageSize(box: Box, resolution: number): [number, number] {
  const side = (length: number) => Math.min(MAX_WMS_SIDE, Math.max(1, Math.round(length / resolution)));
  return [side(box[2] - box[0]), side(box[3] - box[1])];
}

/**
 * The tiles of a projection's extent for a WMS source: `columns` by `rows` tiles at the top zoom
 * level, each `ground` map units wide and high, each level four times as many. An extent whose
 * sides are not in a whole-number ratio (up to 16 to 1) has none: its edge tiles would reach beyond
 * the extent, and no request may. Square extents, as EPSG:3857 and the polar ones, have one tile,
 * EPSG:4326 two.
 */
export interface WmsGrid {
  readonly columns: number;
  readonly rows: number;
  readonly ground: number;
}

export function wmsGrid(extent: Box): WmsGrid | null {
  const width = extent[2] - extent[0];
  const height = extent[3] - extent[1];
  if (!(width > 0) || !(height > 0)) return null;
  const tolerance = 1e-9;
  for (let n = 1; n <= 16; n++) {
    const columns = width >= height ? n : 1;
    const rows = width >= height ? 1 : n;
    const ratio = width >= height ? width / height : height / width;
    if (Math.abs(ratio - n) <= tolerance * n) return { columns, rows, ground: width >= height ? height : width };
  }
  return null;
}
