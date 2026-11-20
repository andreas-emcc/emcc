/**
 * The shared Delete's key (ADR-0032; CR-0015 item 11): Delete, and on a Mac also Backspace, which is
 * what its "delete" key sends (owner, 2026-10-16). It deletes the map's selection, after the
 * question, and acts only in the View tab, with the focus outside text fields, without Ctrl, Alt
 * or Cmd, and while no dialog or menu is open.
 */
import type { MapView } from '@emc2/plugin-sdk';
import type { Deleter } from './deletion.ts';
import type { ActionMenu } from './menu.ts';

/** Input types that do not take text: there the key still deletes. */
const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether the key goes to a field the user types in. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NOT_TEXT.has(target.type);
}

/** A Mac (its "delete" key sends Backspace). */
export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export interface DeleteKeyOptions {
  readonly deleter: Deleter;
  readonly menu: ActionMenu;
  readonly mapView: () => Promise<MapView | null>;
  /** The View tab is shown. */
  readonly inView: () => boolean;
  readonly mac?: boolean;
}

/**
 * Listens for the key; returns the function that stops listening. A key already taken
 * (`preventDefault`) is not the Delete's.
 * - Delete on the document, from the shell's start, so before the plugins' own listeners there: a
 *   plugin that still has a Delete key of its own and leaves a taken key alone steps back.
 * - Backspace on a Mac on the window, after the document's listeners: while drawing, map-view-2d
 *   takes Backspace to remove the last point, and then it does not delete too (review F3).
 */
export function listenForDeleteKey(options: DeleteKeyOptions): () => void {
  const mac = options.mac ?? isMac();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
    if (isTextField(event.target) || !options.inView() || options.menu.isOpen) return;
    if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') !== null) return;
    if (!options.deleter.allowed || options.deleter.getState().asking !== null) return;
    event.preventDefault();
    void options.mapView().then((mapView) => {
      const ids = mapView?.selection.value ?? [];
      if (ids.length > 0) options.deleter.ask(ids);
    });
  };
  const onDelete = (event: KeyboardEvent) => { if (event.key === 'Delete') onKeyDown(event); };
  const onBackspace = (event: KeyboardEvent) => { if (mac && event.key === 'Backspace') onKeyDown(event); };
  document.addEventListener('keydown', onDelete);
  window.addEventListener('keydown', onBackspace);
  return () => {
    document.removeEventListener('keydown', onDelete);
    window.removeEventListener('keydown', onBackspace);
  };
}
