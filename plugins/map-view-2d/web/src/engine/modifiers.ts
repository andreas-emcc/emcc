/**
 * The modifier keys of a pointer event (brief function 14; plain DOM, so jsdom can test it). The
 * add key is Ctrl, or Cmd on a Mac, where Ctrl+click opens the context menu (ADR-0032 point 1).
 */

export interface KeyState {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** True on a Mac, from the browser's platform (or user agent where the platform is empty). */
export function isMac(nav: { readonly platform?: string; readonly userAgent?: string }): boolean {
  const platform = nav.platform ?? '';
  return /mac/i.test(platform === '' ? (nav.userAgent ?? '') : platform);
}

/** True if any modifier key is held. */
export function anyModifier(event: KeyState): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

/** True if the add key is held, and no other. */
export function addKeyOnly(event: KeyState, mac: boolean): boolean {
  return (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.shiftKey && !event.altKey;
}

/** The keys of a click for the controller: `add`, `other`, or undefined for none. */
export function clickKeys(event: KeyState, mac: boolean): 'add' | 'other' | undefined {
  if (!anyModifier(event)) return undefined;
  return addKeyOnly(event, mac) ? 'add' : 'other';
}
