// The units of the value boxes and the routes panel (brief function 8; open question 18). Display
// only: the route always stores m/s and metres. Each user picks one speed unit and one altitude
// unit, remembered in the user's setup (A27).
import type { JsonValue } from '@emc2/plugin-sdk';

/** The speed units, named as the route's extension names a typed time's unit (`time.unit`). */
export type SpeedUnit = 'mps' | 'kmh' | 'kn' | 'mph';
export type AltitudeUnit = 'm' | 'ft';

export interface Units {
  readonly speed: SpeedUnit;
  readonly altitude: AltitudeUnit;
}

/** For a user who has picked none (A27). */
export const DEFAULT_UNITS: Units = { speed: 'kmh', altitude: 'm' };

const METRES_PER_SECOND: Readonly<Record<SpeedUnit, number>> = { mps: 1, kmh: 1000 / 3600, kn: 1852 / 3600, mph: 1609.344 / 3600 };
const METRES: Readonly<Record<AltitudeUnit, number>> = { m: 1, ft: 0.3048 };

export const SPEED_LABELS: Readonly<Record<SpeedUnit, string>> = { mps: 'm/s', kmh: 'km/h', kn: 'kn', mph: 'mph' };
export const ALTITUDE_LABELS: Readonly<Record<AltitudeUnit, string>> = { m: 'm', ft: 'ft' };

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

export function speedIn(mps: number, unit: SpeedUnit): number {
  return mps / METRES_PER_SECOND[unit];
}

export function speedToMps(value: number, unit: SpeedUnit): number {
  return value * METRES_PER_SECOND[unit];
}

export function lengthIn(metres: number, unit: AltitudeUnit): number {
  return metres / METRES[unit];
}

export function lengthToMetres(value: number, unit: AltitudeUnit): number {
  return value * METRES[unit];
}

const WHOLE = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A speed to one decimal, in the user's unit (A27); `–` for none. */
export function formatSpeed(mps: number | null, unit: SpeedUnit): string {
  return mps === null ? '–' : `${ONE_DECIMAL.format(speedIn(mps, unit))} ${SPEED_LABELS[unit]}`;
}

/** An altitude or a length, whole, in the user's altitude unit (A27); `–` for none. */
export function formatLength(metres: number | null, unit: AltitudeUnit): string {
  return metres === null ? '–' : `${WHOLE.format(lengthIn(metres, unit))} ${ALTITUDE_LABELS[unit]}`;
}

/** A duration as `h:mm:ss`; `–` for none. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isSpeedUnit(value: unknown): value is SpeedUnit {
  return value === 'mps' || value === 'kmh' || value === 'kn' || value === 'mph';
}

function isAltitudeUnit(value: unknown): value is AltitudeUnit {
  return value === 'm' || value === 'ft';
}

/** The setup share, as saved. */
export function unitsShare(units: Units): JsonValue {
  return { speed: units.speed, altitude: units.altitude };
}

/** The units in a saved share, or null for a share this version cannot read. */
export function readUnits(share: JsonValue): Units | null {
  if (typeof share !== 'object' || share === null || Array.isArray(share)) return null;
  const { speed, altitude } = share as { readonly [key: string]: JsonValue };
  return isSpeedUnit(speed) && isAltitudeUnit(altitude) ? { speed, altitude } : null;
}
