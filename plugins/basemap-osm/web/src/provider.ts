import type { BackgroundMapProvider } from '@emc2/plugin-sdk';

/** The highest zoom level OpenStreetMap serves, and the default of the `maxZoom` setting. */
export const OSM_MAX_ZOOM = 19;

/**
 * The OpenStreetMap background as data. The tiles come from this plugin's own endpoint on the emc2
 * server (the tile proxy), never from an external host: the Content-Security-Policy allows only
 * `'self'` (ADR-0014).
 *
 * `current.maxZoom` is read each time the map view reads `source`, so a change of the `maxZoom` setting reaches the
 * map view the next time it builds its tile layer (a provider cannot be provided twice, and the SDK has no "provider
 * changed" signal).
 */
export function createProvider(serverBase: string, current: { readonly maxZoom: number }): BackgroundMapProvider {
  return {
    id: 'osm',
    name: 'OpenStreetMap',
    projections: ['EPSG:3857'],
    get source() {
      return { type: 'xyz' as const, url: `${serverBase}tiles/{z}/{x}/{y}.png`, minZoom: 0, maxZoom: current.maxZoom, tileSize: 256 };
    },
    // Required by the OSM licence; the map view always shows it.
    attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  };
}

/** The `maxZoom` setting if it is an integer from 0 to 19, otherwise `null`. */
export function readMaxZoom(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= OSM_MAX_ZOOM ? value : null;
}
