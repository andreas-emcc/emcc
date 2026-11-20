// UTM zones, latitude bands and the projection itself. proj4 is the shell's shared copy: we pass it
// projection strings directly and never register definitions, because only map-view-2d owns
// proj4's global state (design pattern, FAQ).
import proj4 from 'proj4';
import type { Position } from '@emc2/plugin-sdk';

/** UTM (and MGRS with UTM zones) covers 80° S to 84° N, both included (brief, function 6); beyond that, UPS. */
export const UTM_NORTH_LIMIT = 84;
export const UTM_SOUTH_LIMIT = -80;

/** The latitude band letters from 80° S, 8° each; X covers 72° N to 84° N. */
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export interface Utm {
  readonly zone: number;
  readonly band: string;
  readonly easting: number;
  readonly northing: number;
}

export function insideUtm(lat: number): boolean {
  return lat >= UTM_SOUTH_LIMIT && lat <= UTM_NORTH_LIMIT;
}

/** The band letter of a latitude inside UTM. */
export function bandOf(lat: number): string {
  const index = Math.min(Math.floor((lat - UTM_SOUTH_LIMIT) / 8), BANDS.length - 1);
  return BANDS.charAt(Math.max(index, 0));
}

/** The latitude range of a band letter, or null if it is not one (A, B, Y, Z are UPS; I and O are not used). */
export function bandRange(band: string): readonly [south: number, north: number] | null {
  const index = BANDS.indexOf(band);
  if (index < 0 || band.length !== 1) return null;
  const south = UTM_SOUTH_LIMIT + 8 * index;
  return [south, band === 'X' ? UTM_NORTH_LIMIT : south + 8];
}

/** The standard UTM zone, with the exceptions for Norway (32V) and Svalbard (31X, 33X, 35X, 37X). */
export function zoneOf(lon: number, lat: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat <= UTM_NORTH_LIMIT && lon >= 0 && lon < 42) {
    if (lon < 9) return 31;
    if (lon < 21) return 33;
    if (lon < 33) return 35;
    return 37;
  }
  return lon >= 180 ? 60 : Math.floor((lon + 180) / 6) + 1;
}

function zoneDefinition(zone: number, south: boolean): string {
  return `+proj=utm +zone=${String(zone)}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
}

/** The UTM coordinates of a position inside UTM (check with {@link insideUtm} first). */
export function toUtm([lon, lat]: Position): Utm {
  const zone = zoneOf(lon, lat);
  const [easting, northing] = proj4(WGS84, zoneDefinition(zone, lat < 0)).forward([lon, lat]);
  return { zone, band: bandOf(lat), easting, northing };
}

/** The position of UTM coordinates; the hemisphere follows from the band letter. */
export function fromUtm(zone: number, band: string, easting: number, northing: number): Position {
  const [lon, lat] = proj4(WGS84, zoneDefinition(zone, band < 'N')).inverse([easting, northing]);
  return [lon, lat];
}

/** UPS letters: A and B in the south, Y and Z in the north; the second of each is east of 0°/180°. */
export type UpsLetter = 'A' | 'B' | 'Y' | 'Z';

export interface Ups {
  readonly letter: UpsLetter;
  readonly easting: number;
  readonly northing: number;
}

/** The pole's easting and northing in UPS. */
export const UPS_ORIGIN = 2_000_000;

/** UPS north or south: polar stereographic with scale 0.994 at the pole (NGA). */
function upsDefinition(north: boolean): string {
  return `+proj=stere +lat_0=${north ? '90' : '-90'} +lon_0=0 +k=0.994 +x_0=${String(UPS_ORIGIN)} +y_0=${String(UPS_ORIGIN)} +datum=WGS84 +units=m +no_defs`;
}

export function isUpsLetter(letter: string): letter is UpsLetter {
  return letter === 'A' || letter === 'B' || letter === 'Y' || letter === 'Z';
}

/** True for the northern letters Y and Z. */
export function upsNorth(letter: UpsLetter): boolean {
  return letter === 'Y' || letter === 'Z';
}

/**
 * The UPS coordinates of a position outside UTM. The letter follows the easting, as GeographicLib's
 * does: an easting of 2 000 000 m (0° and ±180°, and the pole) is east. The micrometre of slack
 * keeps ±180°, where the projection gives 2 000 000 m minus rounding noise, in the east.
 */
export function toUps([lon, lat]: Position): Ups {
  const north = lat > 0;
  const [easting, northing] = proj4(WGS84, upsDefinition(north)).forward([lon, lat]);
  const east = easting >= UPS_ORIGIN - 1e-6;
  const letter: UpsLetter = north ? (east ? 'Z' : 'Y') : east ? 'B' : 'A';
  return { letter, easting, northing };
}

/** The position of UPS coordinates; the letter gives the pole. */
export function fromUps(letter: UpsLetter, easting: number, northing: number): Position {
  const [lon, lat] = proj4(WGS84, upsDefinition(upsNorth(letter))).inverse([easting, northing]);
  return [lon, lat];
}
