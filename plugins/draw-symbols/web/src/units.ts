// The units of the heading, speed and altitude fields in "Symbol properties" (brief, function 27). Display and typing only: the
// model keeps SI, the modifier `speed` in m/s and the altitude in metres. Each user picks a speed unit and an altitude unit
// here; they are kept in this browser (like the data type), and a user who has chosen none gets km/h and metres.

export type SpeedUnit = 'mps' | 'kmh' | 'kn' | 'mph';
export type AltitudeUnit = 'm' | 'ft';

export const DEFAULT_SPEED_UNIT: SpeedUnit = 'kmh';
export const DEFAULT_ALTITUDE_UNIT: AltitudeUnit = 'm';

export const SPEED_UNITS: readonly { readonly value: SpeedUnit; readonly label: string }[] = [
  { value: 'mps', label: 'm/s' },
  { value: 'kmh', label: 'km/h' },
  { value: 'kn', label: 'knots' },
  { value: 'mph', label: 'mph' },
];
export const ALTITUDE_UNITS: readonly { readonly value: AltitudeUnit; readonly label: string }[] = [
  { value: 'm', label: 'metres' },
  { value: 'ft', label: 'feet' },
];

/** The short name in a field's label. */
export const SPEED_SHORT: Readonly<Record<SpeedUnit, string>> = { mps: 'm/s', kmh: 'km/h', kn: 'kn', mph: 'mph' };
export const ALTITUDE_SHORT: Readonly<Record<AltitudeUnit, string>> = { m: 'm', ft: 'ft' };

const METRES_PER_SECOND: Readonly<Record<SpeedUnit, number>> = { mps: 1, kmh: 1000 / 3600, kn: 1852 / 3600, mph: 1609.344 / 3600 };
const METRES: Readonly<Record<AltitudeUnit, number>> = { m: 1, ft: 0.3048 };

export const isSpeedUnit = (value: unknown): value is SpeedUnit => SPEED_UNITS.some((u) => u.value === value);
export const isAltitudeUnit = (value: unknown): value is AltitudeUnit => ALTITUDE_UNITS.some((u) => u.value === value);

/** Rounds to `digits` decimals, so that 54 km/h is stored as 15 m/s and not 15.000000000000002. */
const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** The value typed in `unit`, as m/s to store. */
export const speedToMps = (value: number, unit: SpeedUnit): number => round(value * METRES_PER_SECOND[unit], 6);
/** The m/s stored, as the number shown in `unit`: at most two decimals, none when whole. */
export const speedIn = (mps: number, unit: SpeedUnit): string => String(round(mps / METRES_PER_SECOND[unit], 2));

/** The value typed in `unit`, as metres to store. */
export const lengthToMetres = (value: number, unit: AltitudeUnit): number => round(value * METRES[unit], 6);
/** The metres stored, as the number shown in `unit`: at most two decimals, none when whole. */
export const lengthIn = (metres: number, unit: AltitudeUnit): string => String(round(metres / METRES[unit], 2));

/**
 * A number typed in a field: null for an empty field (the value is cleared), 'invalid' for text that is not a finite number. A comma
 * is a decimal point.
 */
export function parseNumber(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : 'invalid';
}
