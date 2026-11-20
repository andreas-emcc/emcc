/**
 * Whether the Map Pane controls are open, kept per browser (owner, 2026-10-21: they start collapsed,
 * so they cover the least of the map, and the user's choice is remembered in this browser only; the
 * setup share does not hold it).
 */

/** Where the open state is kept: the browser's local storage, or memory in tests. */
export interface ControlsOpenStore {
  load(): boolean;
  save(open: boolean): void;
}

/** The storage key, in the plugin's own namespace. */
export const CONTROLS_OPEN_KEY = 'emc2.map-view-2d.controlsOpen';

/** Kept in a `Storage`; missing or refusing storage (private mode, blocked) keeps it for the page only. */
export function storageControlsOpen(storage: () => Pick<Storage, 'getItem' | 'setItem'>): ControlsOpenStore {
  let current: boolean | null = null;
  return {
    load: () => {
      if (current !== null) return current;
      try {
        current = storage().getItem(CONTROLS_OPEN_KEY) === 'true';
      } catch {
        current = false;
      }
      return current;
    },
    save: (open) => {
      current = open;
      try {
        storage().setItem(CONTROLS_OPEN_KEY, String(open));
      } catch {
        // Kept for this page only.
      }
    },
  };
}

/** For tests and pages without storage: starts collapsed unless told otherwise. */
export function memoryControlsOpen(open = false): ControlsOpenStore {
  let current = open;
  return {
    load: () => current,
    save: (next) => {
      current = next;
    },
  };
}
