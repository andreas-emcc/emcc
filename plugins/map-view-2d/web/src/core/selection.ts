/**
 * Selection on the map (brief function 14, ADR-0032 point 1): what a click and a box do to the
 * shared selection, and the notices about what they left out. No OpenLayers; the controller feeds
 * it the ids under the pointer or in the box, topmost first.
 */
import { MAX_SELECTION, type Notification, type PluginLog, type SharedState, type Uuid } from '@emc2/plugin-sdk';
import { createSharedState, sameIds } from './emitter.ts';

/** What a click or a box gives: the new selection, and a notice when something was left out. */
export interface SelectionResult {
  readonly ids: readonly Uuid[];
  readonly notice: Notification | null;
}

const count = (n: number) => n.toLocaleString('en');

/**
 * A click: on an object it replaces the selection, on empty map it clears it. With the add key
 * (Ctrl, Cmd on a Mac) it adds the object or removes it if it is selected; on empty map it changes
 * nothing. An object that would be the 1 001st is not added (criterion 40).
 */
export function clickSelection(current: readonly Uuid[], hit: Uuid | null, add: boolean): SelectionResult {
  if (!add) return { ids: hit === null ? [] : [hit], notice: null };
  if (hit === null) return { ids: current, notice: null };
  if (current.includes(hit)) return { ids: current.filter((id) => id !== hit), notice: null };
  if (current.length >= MAX_SELECTION) {
    return { ids: current, notice: { severity: 'warning', message: `A selection holds at most ${count(MAX_SELECTION)} objects; this object was not added.` } };
  }
  return { ids: [...current, hit], notice: null };
}

/**
 * A box replaces the selection with the objects in it, topmost layer first, at most 1 000 (owner,
 * 2026-10-14). The notice states how many were left out, and how many objects inside clusters
 * could not be selected; both ask the user to zoom in.
 */
export function boxSelection(inBox: readonly Uuid[], clustered: number): SelectionResult {
  const ids = inBox.slice(0, MAX_SELECTION);
  const parts: string[] = [];
  const leftOut = inBox.length - ids.length;
  if (leftOut > 0) parts.push(`Selected the first ${count(ids.length)} objects; ${count(leftOut)} more in the box ${leftOut === 1 ? 'was' : 'were'} left out.`);
  if (clustered > 0) parts.push(`${count(clustered)} ${clustered === 1 ? 'object' : 'objects'} inside clusters could not be selected.`);
  if (parts.length === 0) return { ids, notice: null };
  return { ids, notice: { severity: 'warning', message: `${parts.join(' ')} Zoom in to select them.` } };
}

/**
 * The shared selection (SDK 1.1.0): a `set` with more than 1 000 ids keeps the first 1 000 and
 * logs a warning; listeners hear only real changes.
 */
export function createSelection(log: PluginLog, onError: (error: unknown) => void): SharedState<readonly Uuid[]> {
  const state = createSharedState<readonly Uuid[]>([], onError, sameIds);
  return {
    get value() {
      return state.value;
    },
    set(next) {
      if (next.length > MAX_SELECTION) {
        log.warn(`a selection of ${String(next.length)} ids was cut to the first ${String(MAX_SELECTION)}`);
        state.set(next.slice(0, MAX_SELECTION));
        return;
      }
      state.set(next);
    },
    onChange: (listener) => state.onChange(listener),
  };
}
