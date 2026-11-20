import type { Position } from '@emc2/plugin-sdk';

const EARTH_RADIUS_METRES = 6_371_008.8;

/** A longitude brought into -180 to 180 (a map that repeats sideways may report one beyond). */
export function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** The distance on the ground in metres between two longitude, latitude positions (haversine). */
export function distanceMetres(a: Position, b: Position): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Decimal degrees with hemispheres, latitude first as people read them: `62.5000°N 15.2500°E`. The proposed name when there is no coordinate service. */
export function formatDecimalDegrees(position: Position): string {
  const [lon, lat] = position;
  return `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`;
}
