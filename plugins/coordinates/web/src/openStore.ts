/**
 * Whether the coordinates window is open, kept per browser as the format is (brief function 8; the
 * setup does not hold it).
 */

/** Where the open state is kept: the browser's local storage, or memory in tests. */
export interface OpenStore {
  load(): boolean;
  save(open: boolean): void;
}

/** The storage key, in the plugin's own namespace. */
export const OPEN_KEY = 'emc2.coordinates.open';

/** In local storage; storage that is missing or refuses (private mode, blocked) keeps it for the page only. */
export function localOpenStore(): OpenStore {
  let current: boolean | null = null;
  return {
    load: () => {
      if (current !== null) return current;
      try {
        current = globalThis.localStorage.getItem(OPEN_KEY) === 'true';
      } catch {
        current = false;
      }
      return current;
    },
    save: (open) => {
      current = open;
      try {
        globalThis.localStorage.setItem(OPEN_KEY, String(open));
      } catch {
        // Kept for this page only.
      }
    },
  };
}
