// The plugin's settings (plugin.json), validated where they are read (design pattern, section 7).
import type { CoordinateFormat, JsonValue } from '@emc2/plugin-sdk';

export const FORMATS: readonly CoordinateFormat[] = ['dms', 'dd', 'utm', 'mgrs'];

export interface Settings {
  readonly defaultFormat: CoordinateFormat;
  readonly mgrsPrecision: number;
  readonly dmsSecondsDecimals: number;
}

export const DEFAULTS: Settings = { defaultFormat: 'dms', mgrsPrecision: 5, dmsSecondsDecimals: 1 };

export function isFormat(value: unknown): value is CoordinateFormat {
  return typeof value === 'string' && (FORMATS as readonly string[]).includes(value);
}

/** The settings, with the default for every bad value, and a message per bad value. */
export function readSettings(raw: { readonly [name: string]: JsonValue }): { readonly settings: Settings; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const integer = (name: 'mgrsPrecision' | 'dmsSecondsDecimals', min: number, max: number): number => {
    const value = raw[name];
    if (value === undefined) return DEFAULTS[name];
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value;
    problems.push(`setting ${name} must be an integer from ${String(min)} to ${String(max)}; using ${String(DEFAULTS[name])}`);
    return DEFAULTS[name];
  };
  const format = raw['defaultFormat'];
  let defaultFormat = DEFAULTS.defaultFormat;
  if (isFormat(format)) defaultFormat = format;
  else if (format !== undefined) problems.push(`setting defaultFormat must be one of ${FORMATS.join(', ')}; using ${DEFAULTS.defaultFormat}`);
  return {
    settings: { defaultFormat, mgrsPrecision: integer('mgrsPrecision', 1, 5), dmsSecondsDecimals: integer('dmsSecondsDecimals', 0, 3) },
    problems,
  };
}
