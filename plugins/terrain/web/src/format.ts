// How the panel and the overlay's label write distances, bearings and positions (the brief's function 2).
import type { CoordinateService, Position } from '@emc2/plugin-sdk';

/** Metres below 1 000 m, else kilometres with two decimals: `842 m`, `12.35 km`. */
export function formatDistance(metres: number): string {
  const whole = Math.round(metres);
  if (whole < 1000) return `${String(whole)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/** Degrees from true north with one decimal and three digits before it: `045.2°`; 360 is written `000.0°`. */
export function formatBearing(degrees: number): string {
  let value = Math.round(degrees * 10) / 10;
  if (value >= 360) value = 0;
  if (value < 0) value += 360;
  return `${value.toFixed(1).padStart(5, '0')}°`;
}

/** A position in the user's chosen format when the coordinate service is there, else decimal degrees with the hemispheres. */
export function formatPosition(position: Position, coordinates: CoordinateService | null): string {
  if (coordinates !== null) return coordinates.format(position);
  const [lon, lat] = position;
  return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? 'W' : 'E'}`;
}

/** What the label at the middle of the range line says. */
export function rangeLabel(distance: number, initialBearing: number): string {
  return `${formatDistance(distance)}  ${formatBearing(initialBearing)}`;
}

/** A height in metres above mean sea level, rounded to the metre: `412 m` (owner, Q54 A). A height below sea level has a minus sign. */
export function formatHeight(metres: number): string {
  const whole = Math.round(metres);
  return `${whole < 0 ? '−' : ''}${String(Math.abs(whole))} m`;
}

/** What the label at the highest point says: `412 m`. */
export function heightLabel(metres: number): string {
  return formatHeight(metres);
}
