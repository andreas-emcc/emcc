// The data type the user chose for new shapes is kept in this browser (brief, function 1). Browser
// storage can be missing or throw (a private window, blocked site data), so every access is in a
// try/catch and the plugin works without it: the setting applies then.

/** The key in `localStorage`. */
export const DATA_TYPE_KEY = 'draw-shapes.dataType';

/** The kept data type id, or null if there is none or storage cannot be read. */
export function readKeptDataType(): string | null {
  try {
    const value = window.localStorage.getItem(DATA_TYPE_KEY);
    return value !== null && value !== '' ? value : null;
  } catch {
    return null;
  }
}

/** Keeps the choice; false if storage could not be written (the choice then lasts until the page is reloaded). */
export function keepDataType(id: string): boolean {
  try {
    window.localStorage.setItem(DATA_TYPE_KEY, id);
    return true;
  } catch {
    return false;
  }
}
