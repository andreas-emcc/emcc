/**
 * Small shared helpers for listeners.
 *
 * @example
 * const off = map.onViewportChange(v => console.log(v.center));
 * off();
 */

/** Stops a listener or a registration. Calling it again has no effect. */
export type Unsubscribe = () => void;
