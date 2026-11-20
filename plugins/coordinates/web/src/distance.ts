import type { Position } from '@emc2/plugin-sdk';

const EARTH_RADIUS_METRES = 6_371_008.8;

/** Great-circle distance in metres on a sphere: plenty to tell whether two positions are the same within metres. */
export function distanceMetres([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}
