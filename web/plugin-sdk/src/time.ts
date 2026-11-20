/**
 * SDK 1.4.0 part 4 (ADR-0044, ADR-0045; CR-0030 part 4, CR-0032): the user's time and capabilities.
 */
import type { Timestamp } from './model.ts';

/** An interval of the user's time, `from` not after `to`, both included. */
export interface UserTimeInterval {
  readonly from: Timestamp;
  readonly to: Timestamp;
}

/**
 * The time a browser session's user picked in the top bar's time control (ADR-0045, CR-0032). It
 * has two independent parts, each left out at its default:
 * - `time`, **the set time**: absent for now (the default, at every page load), or a time;
 * - `interval`, **the interval**: absent for none (the default), or a start and an end.
 *
 * Neither part limits the other: the set time may lie outside the interval. Each plugin reads the
 * part it needs. A part that is not set is **left out, never `null`** (the ACA's R3 on CR-0032).
 * UTC timestamps, as in the data model. Only temporal plugins react to it; they are told through
 * their module's `capabilities.temporal.timeChanged`, never by reading a member of the context
 * (the ACA's R4). An interval's end that follows the clock is not part of 1.4.0.
 *
 * @example
 * timeChanged(t) {
 *   weather.show(t.time ?? new Date().toISOString()); // the set time alone is now when absent
 *   tracks.show(t.interval);                          // undefined: no interval
 * }
 */
export interface UserTime {
  readonly time?: Timestamp;
  readonly interval?: UserTimeInterval;
}

/** Now with no interval, the default: `{}`. */
export const NOW: UserTime = Object.freeze({});

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Why `time` is not a well-formed user time, or null: an object with only `time` and `interval`,
 * each left out or set, never `null` (R3); UTC timestamps; and an interval's start not after its
 * end. The shell and the fake context refuse what it refuses.
 */
export function userTimeProblem(time: UserTime | null): string | null {
  if (!isObject(time)) return 'a user time is an object, not null';
  for (const key of Object.keys(time)) {
    if (key !== 'time' && key !== 'interval') return `unknown member of a user time: ${key}`;
  }
  const value = time as Record<string, unknown>;
  if ('time' in value) {
    if (typeof value.time !== 'string') return 'the set time is a UTC timestamp, or left out for now (never null)';
    if (!UTC.test(value.time)) return `not a UTC timestamp: ${value.time}`;
  }
  if ('interval' in value) {
    const i = value.interval;
    if (!isObject(i)) return 'the interval is an object with from and to, or left out for none (never null)';
    if (typeof i.from !== 'string' || typeof i.to !== 'string') return 'an interval has from and to, each a UTC timestamp';
    if (!UTC.test(i.from) || !UTC.test(i.to)) return `not a UTC timestamp: ${UTC.test(i.from) ? i.to : i.from}`;
    if (Date.parse(i.from) > Date.parse(i.to)) return `an interval's start is after its end: ${i.from} > ${i.to}`;
  }
  return null;
}

/** The capability ids this SDK knows (ADR-0044); a manifest's `capabilities` lists some of them. */
export const CAPABILITY_IDS = ['temporal'] as const;

/** A capability id. */
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/**
 * The capability `temporal` in a web part (ADR-0045): the shell calls `timeChanged` with the
 * session's whole time once after `activate`, and again at each change, one call per change of
 * either part (CR-0032; the ACA's R4).
 */
export interface TemporalCapability {
  timeChanged(time: UserTime): void;
}

/** A web module's capability objects, one member per capability it implements (ADR-0044 point 3). */
export interface WebCapabilities {
  readonly temporal?: TemporalCapability;
}

/** The capabilities `module` implements. */
export function capabilitiesOf(module: { readonly capabilities?: WebCapabilities }): CapabilityId[] {
  const c = module.capabilities;
  return c === undefined ? [] : CAPABILITY_IDS.filter((id) => c[id] !== undefined);
}

/**
 * The shell's check of a web module against its manifest (ADR-0044 point 4; owner, Q11,
 * 2026-11-06: **every declared capability is implemented by at least one part, and a part
 * implements only declared ones**), or null when it passes:
 * - an unknown id is a fault (point 5);
 * - a capability the module implements but the manifest does not declare is a fault;
 * - a declared capability the module does not implement is a fault only when the plugin has no
 *   server part (`hasServerPart` false); otherwise the server part may implement it.
 *
 * The shell reports a fault to the server. ECore records it in the Monitor, naming the capability,
 * when the server part does not make up for it, and the shell does not use the module's
 * capabilities; the plugin is running by then, so it is not stopped (the ACA's R1 on part 4).
 */
export function capabilityMismatch(
  module: { readonly capabilities?: WebCapabilities },
  declared: readonly string[],
  hasServerPart: boolean,
): string | null {
  const unknown = declared.filter((id) => !(CAPABILITY_IDS as readonly string[]).includes(id));
  if (unknown.length > 0) return `unknown capability ${unknown.join(', ')}`;
  const implemented = capabilitiesOf(module);
  const missing = declared.filter((id) => !implemented.includes(id as CapabilityId));
  if (missing.length > 0 && !hasServerPart) return `capability ${missing.join(', ')} declared but not implemented`;
  const extra = implemented.filter((id) => !declared.includes(id));
  if (extra.length > 0) return `capability ${extra.join(', ')} implemented but not declared`;
  return null;
}
