/**
 * The Escape key for the controller (plain DOM, no OpenLayers, so jsdom can test it). Escape ends
 * "pick a point" and "drag an object" (brief function 8), but not while the user types: in a text
 * field, a list box or editable content, Escape belongs to that element (review remark N6).
 */

/** Elements that use Escape themselves. Buttons, checkboxes and the like do not: Escape there ends the interaction. */
const OWNS_ESCAPE = [
  'input:not([type="button"], [type="checkbox"], [type="color"], [type="file"], [type="image"], [type="radio"], [type="range"], [type="reset"], [type="submit"])',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

/** True if the key event's target uses Escape itself. */
export function ownsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(OWNS_ESCAPE) !== null;
}

/** Listens for Escape on `doc` until the returned function is called. Escape the target uses itself is not reported. */
export function listenForEscape(doc: Document, listener: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || ownsEscape(event.target)) return;
    listener();
  };
  doc.addEventListener('keydown', onKeyDown);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Listens for the drawing keys (brief function 17, T-054): Enter finishes, Backspace removes the
 * last point. As with Escape, not while the user types in a text field, and only where `accepts`
 * says (owner, 2026-10-16: the page itself, the map, or the button that started the drawing). A
 * key it takes does not also act on the focused element: Enter on the button that started drawing
 * would start it again.
 */
export function listenForDrawingKeys(
  doc: Document,
  keys: { readonly enter: () => void; readonly backspace?: () => void },
  accepts: (target: EventTarget | null) => boolean = () => true,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (ownsEscape(event.target) || !accepts(event.target)) return;
    const handler = event.key === 'Enter' ? keys.enter : event.key === 'Backspace' ? keys.backspace : undefined;
    if (handler === undefined) return;
    event.preventDefault();
    handler();
  };
  doc.addEventListener('keydown', onKeyDown);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
  };
}
