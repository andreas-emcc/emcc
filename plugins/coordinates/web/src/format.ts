// Formatting a WGS84 lon/lat position as text. Pure functions; the service adds the settings.
import { forward as mgrsForward } from 'mgrs';
import type { CoordinateFormat, Position } from '@emc2/plugin-sdk';
import { formatPolarMgrs } from './polarMgrs.ts';
import { insideUtm, toUps, toUtm } from './utm.ts';

/** Shown for a position that is not a valid WGS84 lon/lat. */
export const INVALID_POSITION = 'invalid position';

/** Allowed precision per format: DD decimals, DMS seconds decimals, UTM metre decimals, MGRS digits per axis. */
export const PRECISION_LIMITS: Readonly<Record<CoordinateFormat, readonly [min: number, max: number]>> = {
  dd: [0, 9],
  dms: [0, 4],
  utm: [0, 3],
  mgrs: [1, 5],
};

export function isValidPosition(position: Position): boolean {
  const [lon, lat] = position;
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** Clamps a precision into the format's range; anything not a number gives the fallback. */
export function clampPrecision(format: CoordinateFormat, precision: number | undefined, fallback: number): number {
  const [min, max] = PRECISION_LIMITS[format];
  if (precision === undefined || !Number.isFinite(precision)) return fallback;
  return Math.min(max, Math.max(min, Math.round(precision)));
}

export function formatPosition(position: Position, format: CoordinateFormat, precision: number): string {
  if (!isValidPosition(position)) return INVALID_POSITION;
  switch (format) {
    case 'dd':
      return formatDd(position, precision);
    case 'dms':
      return formatDms(position, precision);
    case 'utm':
      return formatUtm(position, precision);
    case 'mgrs':
      return formatMgrs(position, precision);
  }
}

/** `60.123456° N 15.654321° E`. A value that rounds to zero counts as north or east. */
export function formatDd([lon, lat]: Position, decimals: number): string {
  const part = (value: number, positive: string, negative: string) => {
    const text = Math.abs(value).toFixed(decimals);
    return `${text}° ${value < 0 && Number(text) !== 0 ? negative : positive}`;
  };
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
}

/** `60°07'24.4" N 015°39'15.6" E`. Rounds in whole units of the last decimal, so 59.96" carries into the minutes. */
export function formatDms([lon, lat]: Position, decimals: number): string {
  const part = (value: number, degreeDigits: number, positive: string, negative: string) => {
    const scale = 10 ** decimals;
    const units = Math.round(Math.abs(value) * 3600 * scale);
    const degrees = Math.floor(units / (3600 * scale));
    const minutes = Math.floor(units / (60 * scale)) % 60;
    const seconds = (units % (60 * scale)) / scale;
    const secondsText = seconds.toFixed(decimals).padStart(decimals > 0 ? decimals + 3 : 2, '0');
    const hemisphere = value < 0 && units !== 0 ? negative : positive;
    return `${String(degrees).padStart(degreeDigits, '0')}°${String(minutes).padStart(2, '0')}'${secondsText}" ${hemisphere}`;
  };
  return `${part(lat, 2, 'N', 'S')} ${part(lon, 3, 'E', 'W')}`;
}

/**
 * The `utm` format ("UTM/UPS"): `33V 536360 6665340` (zone, latitude band, easting and northing in
 * metres, rounded) inside UTM, and UPS beyond 84° N and 80° S: `Z 2000000 2000000` (letter, easting,
 * northing). A point exactly on 84° N or 80° S is UTM (brief, function 6).
 */
export function formatUtm(position: Position, decimals: number): string {
  if (!insideUtm(position[1])) {
    const ups = toUps(position);
    return `${ups.letter} ${ups.easting.toFixed(decimals)} ${ups.northing.toFixed(decimals)}`;
  }
  const utm = toUtm(position);
  return `${String(utm.zone)}${utm.band} ${utm.easting.toFixed(decimals)} ${utm.northing.toFixed(decimals)}`;
}

/**
 * `33VWG 36360 65340`: grid zone, 100 km square, then easting and northing truncated to the precision
 * (NGA convention). Beyond 84° N and 80° S the polar form on the UPS grid: `ZAH 06749 11929`.
 */
export function formatMgrs([lon, lat]: Position, digits: number): string {
  if (!insideUtm(lat)) return formatPolarMgrs([lon, lat], digits) ?? INVALID_POSITION;
  const text = mgrsForward([lon, lat], digits);
  const m = /^(\d{1,2}[A-Z][A-Z]{2})(\d*)$/.exec(text);
  if (!m?.[1] || m[2] === undefined) return INVALID_POSITION;
  const numbers = m[2];
  const half = numbers.length / 2;
  return `${m[1]} ${numbers.slice(0, half)} ${numbers.slice(half)}`;
}
