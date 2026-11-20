// The CoordinateService other plugins use (web SDK key emc2.coordinates).
import type { CoordinateFormat, CoordinateService, SharedState } from '@emc2/plugin-sdk';
import { clampPrecision, formatPosition } from './format.ts';
import { parsePosition } from './parse.ts';
import { isFormat, type Settings } from './settings.ts';
import { sharedState } from './state.ts';

/** Where the user's chosen format is kept: local storage in the browser (brief, function 4). */
export interface FormatStore {
  load(): string | null;
  save(format: CoordinateFormat): void;
}

export const STORAGE_KEY = 'emc2.coordinates.format';

/** Local storage; quietly does nothing where the browser refuses it (private mode, blocked storage). */
export function localFormatStore(): FormatStore {
  return {
    load() {
      try {
        return globalThis.localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    save(format) {
      try {
        globalThis.localStorage.setItem(STORAGE_KEY, format);
      } catch {
        // The choice then lasts for this page only.
      }
    },
  };
}

/**
 * The service, following the current settings (SDK v1, CR-0012): new precisions apply at once, and a
 * new default format applies until the user picks a format. A pick, by the user or through
 * `chosenFormat.set`, is kept in the store and wins over the default from then on.
 */
export function createCoordinateService(settings: SharedState<Settings>, store: FormatStore): CoordinateService {
  const stored = store.load();
  let chosenByUser = isFormat(stored);
  const state = sharedState<CoordinateFormat>(isFormat(stored) ? stored : settings.value.defaultFormat, isFormat);
  const chosenFormat: SharedState<CoordinateFormat> = {
    get value() {
      return state.value;
    },
    set(format) {
      state.set(format);
      chosenByUser = true;
      store.save(format);
    },
    onChange: (listener) => state.onChange(listener),
  };
  settings.onChange((next) => {
    if (!chosenByUser) state.set(next.defaultFormat);
  });
  const defaultPrecision = (format: CoordinateFormat): number => {
    switch (format) {
      case 'dd':
        return 6;
      case 'dms':
        return settings.value.dmsSecondsDecimals;
      case 'utm':
        return 0;
      case 'mgrs':
        return settings.value.mgrsPrecision;
    }
  };
  return {
    format(position, format = chosenFormat.value, options) {
      return formatPosition(position, format, clampPrecision(format, options?.precision, defaultPrecision(format)));
    },
    parse: parsePosition,
    chosenFormat,
  };
}
