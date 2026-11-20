// The data type and the category the user chose in the picker are kept in this browser (brief, function 1).
// Browser storage can be missing or throw (a private window, blocked site data), so every access is in a
// try/catch and the plugin works without it: the setting applies then (the data type), or the first category.

/** The keys in `localStorage`. */
export const DATA_TYPE_KEY = 'draw-symbols.dataType';
export const CATEGORY_KEY = 'draw-symbols.category';
export const SPEED_UNIT_KEY = 'draw-symbols.speedUnit';
export const ALTITUDE_UNIT_KEY = 'draw-symbols.altitudeUnit';

function read(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && value !== '' ? value : null;
  } catch {
    return null;
  }
}

function keep(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The kept data type id, or null if there is none or storage cannot be read. */
export const readKeptDataType = (): string | null => read(DATA_TYPE_KEY);

/** Keeps the choice; false if storage could not be written (the choice then lasts until the page is reloaded). */
export const keepDataType = (id: string): boolean => keep(DATA_TYPE_KEY, id);

/** The kept speed unit and altitude unit of Symbol properties (the caller checks them), or null. */
export const readKeptSpeedUnit = (): string | null => read(SPEED_UNIT_KEY);
export const keepSpeedUnit = (unit: string): boolean => keep(SPEED_UNIT_KEY, unit);
export const readKeptAltitudeUnit = (): string | null => read(ALTITUDE_UNIT_KEY);
export const keepAltitudeUnit = (unit: string): boolean => keep(ALTITUDE_UNIT_KEY, unit);

/** The kept category (a symbol set code), or null if there is none or storage cannot be read. */
export const readKeptCategory = (): string | null => read(CATEGORY_KEY);

/** Keeps the category; false if storage could not be written (it then lasts until the page is reloaded). */
export const keepCategory = (code: string): boolean => keep(CATEGORY_KEY, code);
