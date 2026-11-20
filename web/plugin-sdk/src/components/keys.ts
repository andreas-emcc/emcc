/**
 * Keyboard helpers of the shared components (internal, not exported; CR-0019). A list, tree or
 * menu is one Tab stop: one item has `tabIndex` 0, the others -1 ("roving tabindex", the WAI-ARIA
 * authoring practices), and the arrow keys move the focus between the items.
 */
import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';

const usable = (e: HTMLElement): boolean => !(e instanceof HTMLButtonElement && e.disabled);

/**
 * Whether a key press is one the components move with: not with Alt, Ctrl or Cmd (e.g. Alt+Left
 * is the browser's Back), and not typed into a field inside an item.
 */
export function isNavigationKey(e: KeyboardEvent): boolean {
  const t = e.target;
  return !(e.altKey || e.ctrlKey || e.metaKey) && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
}

/** The items of `root` that `selector` names and that can take the focus, in page order. */
export function itemsOf(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(usable);
}

/** The item that Up, Down, Home or End moves to from `current`; undefined for any other key. */
export function nextItem(items: readonly HTMLElement[], current: Element | null, key: string, wrap: boolean): HTMLElement | undefined {
  if (items.length === 0) return undefined;
  const at = items.findIndex((e) => e === current);
  switch (key) {
    case 'ArrowDown':
      return at < 0 ? items[0] : at + 1 < items.length ? items[at + 1] : wrap ? items[0] : items[at];
    case 'ArrowUp':
      return at < 0 ? items[items.length - 1] : at > 0 ? items[at - 1] : wrap ? items[items.length - 1] : items[at];
    case 'Home':
      return items[0];
    case 'End':
      return items[items.length - 1];
    default:
      return undefined;
  }
}

/**
 * Keeps one item of `root` in the Tab order: the one with the focus, else the first that matches
 * `preferred` (e.g. the selected row, as the WAI-ARIA patterns say), else the one that had the focus
 * last, else the first. It runs after every render of the host and whenever items are added or
 * removed below it. Returns the handler for the root's `onFocus`, which moves the Tab stop to an
 * item focused by a click.
 */
export function useRovingTabIndex(root: RefObject<HTMLElement | null>, selector: string, preferred?: string): (e: FocusEvent) => void {
  const last = useRef<HTMLElement | null>(null);
  const assign = () => {
    const el = root.current;
    if (el === null) return;
    const items = itemsOf(el, selector);
    const focused = items.find((e) => e === globalThis.document.activeElement);
    const chosen = preferred === undefined ? undefined : items.find((e) => e.matches(preferred));
    const kept = last.current !== null && items.includes(last.current) ? last.current : undefined;
    const stop = focused ?? chosen ?? kept ?? items[0];
    for (const e of items) if (e.tabIndex !== (e === stop ? 0 : -1)) e.tabIndex = e === stop ? 0 : -1;
  };
  const assignRef = useRef(assign);
  useLayoutEffect(() => {
    assignRef.current = assign;
    assign();
  });
  // Rows that a child component adds on its own render, without the host rendering.
  useLayoutEffect(() => {
    const el = root.current;
    if (el === null || typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => assignRef.current());
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'class', 'disabled'] });
    return () => observer.disconnect();
  }, [root]);
  return (e) => {
    const el = root.current;
    if (el === null || !(e.target instanceof HTMLElement) || !e.target.matches(selector)) return;
    last.current = e.target;
    for (const item of itemsOf(el, selector)) item.tabIndex = item === e.target ? 0 : -1;
  };
}
