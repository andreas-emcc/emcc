// Converts the original Natural Earth GeoJSON files (../data) into the one file the plugin ships
// (data/natural-earth.json in the built web part). Plain Node, no dependencies (brief, function 4).
//
// Shaping only, never an edit of content (CR-0009):
// - keep the geometry and the layer it belongs to; drop all attributes, ids, bbox and the CRS member;
// - round every coordinate to 4 decimals (about 11 m, finer than the data's own accuracy);
// - no simplification, no reordering, no clipping.
//
// Deterministic: the same originals give the same bytes (fixed layer order, file order kept, no
// timestamps, compact JSON). The originals are in lon/lat (CRS84) already and are cut at ±180°,
// which is what the SDK's vector source requires, so coordinates are not touched otherwise.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The layers, in drawing order (first at the bottom), each with its original Natural Earth file. */
export const SOURCE_LAYERS = [
  { id: 'land', file: 'ne_50m_land.geojson' },
  { id: 'ice-shelves', file: 'ne_50m_antarctic_ice_shelves_polys.geojson' },
  { id: 'lakes', file: 'ne_50m_lakes.geojson' },
  { id: 'coastline', file: 'ne_50m_coastline.geojson' },
  { id: 'borders', file: 'ne_50m_admin_0_boundary_lines_land.geojson' },
] as const;

/** Name of the shipped file, relative to the built web part (`ctx.webBase`). */
export const SHIPPED_FILE = 'data/natural-earth.json';

/** Decimals kept in the shipped coordinates. */
export const DECIMALS = 4;

type Position = [number, number];
type Geometry =
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] };

export interface ShippedData {
  features: { layer: string; geometry: Geometry }[];
}

const SCALE = 10 ** DECIMALS;

/** Rounds to {@link DECIMALS} decimals; never returns -0. */
export function round(value: number): number {
  return Math.round(value * SCALE) / SCALE + 0;
}

function position(raw: unknown, where: string): Position {
  if (!Array.isArray(raw) || raw.length < 2 || typeof raw[0] !== 'number' || typeof raw[1] !== 'number') {
    throw new Error(`${where}: not a position`);
  }
  // Longitude first, then latitude (GeoJSON, ADR-0007). A third member (height) would be dropped.
  return [round(raw[0]), round(raw[1])];
}

function list(raw: unknown, where: string): unknown[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: not an array`);
  return raw as unknown[];
}

function geometry(raw: unknown, where: string): Geometry {
  const g = raw as { type?: unknown; coordinates?: unknown } | null;
  if (typeof g !== 'object' || g === null) throw new Error(`${where}: no geometry`);
  const c = g.coordinates;
  const line = (l: unknown, w: string) => list(l, w).map((p, i) => position(p, `${w}[${String(i)}]`));
  switch (g.type) {
    case 'Polygon':
      return { type: 'Polygon', coordinates: list(c, where).map((r, i) => line(r, `${where}.ring${String(i)}`)) };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: list(c, where).map((poly, i) =>
          list(poly, `${where}.polygon${String(i)}`).map((r, j) => line(r, `${where}.polygon${String(i)}.ring${String(j)}`)),
        ),
      };
    case 'LineString':
      return { type: 'LineString', coordinates: line(c, where) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: list(c, where).map((r, i) => line(r, `${where}.line${String(i)}`)) };
    default:
      throw new Error(`${where}: unsupported geometry type ${String(g.type)}`);
  }
}

/** Reads the original file of one layer and returns its features in the file's order. */
function layerFeatures(dataDir: string, layer: string, file: string): ShippedData['features'] {
  const doc = JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as { type?: unknown; features?: unknown };
  if (doc.type !== 'FeatureCollection') throw new Error(`${file}: not a FeatureCollection`);
  return list(doc.features, file).map((feature, i) => ({
    layer,
    geometry: geometry((feature as { geometry?: unknown }).geometry, `${file} feature ${String(i)}`),
  }));
}

/** The shipped data, as an object. */
export function convertToData(dataDir: string): ShippedData {
  return { features: SOURCE_LAYERS.flatMap(({ id, file }) => layerFeatures(dataDir, id, file)) };
}

/** The shipped file's text: compact JSON, so the bytes depend only on the originals. */
export function convert(dataDir: string): string {
  return JSON.stringify(convertToData(dataDir));
}
