/**
 * The configured map projections with proj4 (overview 4.7). This plugin is the only one that
 * registers projections with proj4 (S4 rec. 14); the OpenLayers side (`ol/proj/proj4`) is done by
 * the engine. Coordinates are WGS84 lon/lat on one side and projected x/y on the other.
 */
import proj4 from 'proj4';
import type { Position } from '@emc2/plugin-sdk';
import type { Extent, ProjectionDef } from './settings.ts';

const WGS84 = 'EPSG:4326';

/** Converts between lon/lat and one projection. */
export interface Projection {
  readonly def: ProjectionDef;
  /** Lon/lat to projected x/y. Null if the position cannot be projected. */
  forward(position: Position): readonly [number, number] | null;
  /** Projected x/y to lon/lat, longitude in [-180, 180]. Null if outside the projection's domain. */
  inverse(xy: readonly [number, number]): Position | null;
  /** True if the position is inside the projection's world extent (where the map is valid). */
  isValid(position: Position): boolean;
  /**
   * True if the map repeats sideways: a full turn of longitude spans exactly the extent's width
   * (cylindrical projections such as EPSG:3857), so a view may show the world beyond ±180°.
   */
  readonly wrapsX: boolean;
}

export interface Registration {
  readonly projections: readonly Projection[];
  readonly problems: readonly string[];
}

/**
 * Registers every definition with proj4 and checks that it converts the centre of its world
 * extent there and back. A definition that fails is left out and reported.
 */
export function registerProjections(defs: readonly ProjectionDef[]): Registration {
  const projections: Projection[] = [];
  const problems: string[] = [];
  for (const def of defs) {
    try {
      proj4.defs(def.code, def.proj4);
      const projection = projectionOf(def);
      const [minLon, minLat, maxLon, maxLat] = def.worldExtent;
      const probe: Position = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
      const xy = projection.forward(probe);
      const back = xy === null ? null : projection.inverse(xy);
      if (back === null || Math.abs(back[1] - probe[1]) > 1e-6) throw new Error('it does not convert there and back');
      projections.push(projection);
    } catch (error) {
      problems.push(`projection ${def.code} is not usable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { projections, problems };
}

function projectionOf(def: ProjectionDef): Projection {
  const converter = proj4(WGS84, def.code);
  const [minLon, minLat, maxLon, maxLat] = def.worldExtent;
  const midLat = (minLat + maxLat) / 2;
  const tolerance = (def.extent[2] - def.extent[0]) * 1e-9;
  const [west] = converter.forward([-180, midLat]);
  const [east] = converter.forward([180, midLat]);
  const wrapsX = minLon === -180 && maxLon === 180 && finite(west) && finite(east)
    && Math.abs(west - def.extent[0]) <= tolerance && Math.abs(east - def.extent[2]) <= tolerance;
  return {
    wrapsX,
    def,
    forward(position) {
      const [x, y] = converter.forward([position[0], position[1]]);
      return finite(x) && finite(y) ? [x, y] : null;
    },
    inverse(xy) {
      const [lon, lat] = converter.inverse([xy[0], xy[1]]);
      return finite(lon) && finite(lat) && Math.abs(lat) <= 90 ? [normalizeLongitude(lon), lat] : null;
    },
    isValid(position) {
      return insideExtent(position, def.worldExtent);
    },
  };
}

function finite(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n);
}

/** Longitude in [-180, 180]. */
export function normalizeLongitude(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

export function insideExtent(position: Position, extent: Extent): boolean {
  const [lon, lat] = position;
  return lon >= extent[0] && lon <= extent[2] && lat >= extent[1] && lat <= extent[3];
}
