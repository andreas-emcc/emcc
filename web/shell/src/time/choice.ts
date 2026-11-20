/**
 * The time control's state (ADR-0045; the owner's design, 2026-11-06): a slider whose ends the two
 * date pickers set, with three markers, the set time and an interval's start and stop. The user's
 * time has both parts at once (CR-0032, owner JA): the set time, and the interval while the
 * Interval toggle is on. Now resets both: the set time follows the clock, no interval. A
 * choice belongs to the page (ADR-0045 point 2): the first opening shows now ± 12 h, later ones keep
 * the last scale. Times are milliseconds since the epoch, snapped to whole minutes.
 *
 * Zoom (owner): when the interval's markers come within 10 % of the scale of each other, the scale
 * becomes 4 times their span around them; a marker held in the outer 3 % at an end makes the scale
 * grow 1.5 times every half second away from that end. The pickers always show the scale's ends.
 */
import { NOW, type UserTime } from '@emc2/plugin-sdk';
import type { ClockMode } from '../ui/store.ts';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** The smallest scale: 10 minutes. */
export const MIN_SCALE = 10 * MINUTE;
/** The largest scale: 10 years, so a held marker cannot grow it without end. */
export const MAX_SCALE = 3_652 * 24 * HOUR;
/** The share of the scale under which the interval's markers zoom in. */
export const ZOOM_IN_BELOW = 0.1;
/** The new scale is this many times the interval's span. */
export const ZOOM_IN_FACTOR = 4;
/** The share of the slider at each end where a held marker zooms out. */
export const ZOOM_OUT_EDGE = 0.03;
/** How much a held marker grows the scale, every {@link ZOOM_OUT_EVERY_MS}. */
export const ZOOM_OUT_FACTOR = 1.5;
export const ZOOM_OUT_EVERY_MS = 500;

export type Marker = 'set' | 'from' | 'to';

export interface TimeChoice {
  /** The set time is now: it follows the clock, and the user's time leaves it out. */
  readonly now: boolean;
  /** The Interval toggle: the user's time carries the interval from–to too. */
  readonly interval: boolean;
  readonly set: number;
  readonly from: number;
  readonly to: number;
  /** The scale's ends, as the date pickers show them. */
  readonly start: number;
  readonly end: number;
}

/** A time snapped to the minute. */
export function snap(ms: number): number {
  return Math.round(ms / MINUTE) * MINUTE;
}

/** The first opening: now ± 12 h, the set time at now, an interval of an hour on each side. */
export function initialChoice(nowMs: number): TimeChoice {
  const now = snap(nowMs);
  return { now: true, interval: false, set: now, from: now - HOUR, to: now + HOUR, start: now - 12 * HOUR, end: now + 12 * HOUR };
}

/** The user's time the choice gives (CR-0032): each part left out at its default, never null. */
export function userTimeOf(choice: TimeChoice | null): UserTime {
  if (choice === null) return NOW;
  return {
    ...(choice.now ? {} : { time: iso(choice.set) }),
    ...(choice.interval ? { interval: { from: iso(choice.from), to: iso(choice.to) } } : {}),
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Where `ms` is on the scale, 0 to 1. */
export function fractionOf(choice: TimeChoice, ms: number): number {
  return Math.min(1, Math.max(0, (ms - choice.start) / (choice.end - choice.start)));
}

/** The time at `fraction` of the scale, snapped. */
export function valueAt(choice: TimeChoice, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return snap(choice.start + f * (choice.end - choice.start));
}

/**
 * `marker` moved to `ms`: kept on the scale, and an interval's start not after its stop. Moving the
 * set time's marker leaves now; the interval's markers leave the set time as it is.
 */
export function moved(choice: TimeChoice, marker: Marker, ms: number): TimeChoice {
  const value = Math.min(choice.end, Math.max(choice.start, snap(ms)));
  switch (marker) {
    case 'set':
      return { ...choice, now: false, set: value };
    case 'from':
      return { ...choice, from: Math.min(value, choice.to) };
    case 'to':
      return { ...choice, to: Math.max(value, choice.from) };
  }
}

/** Which end `fraction` is close to, for the zoom out. */
export function nearEnd(fraction: number): 'start' | 'end' | null {
  if (fraction <= ZOOM_OUT_EDGE) return 'start';
  if (fraction >= 1 - ZOOM_OUT_EDGE) return 'end';
  return null;
}

/** The scale grown {@link ZOOM_OUT_FACTOR} times away from `side`, up to {@link MAX_SCALE}. */
export function zoomedOut(choice: TimeChoice, side: 'start' | 'end'): TimeChoice {
  const span = choice.end - choice.start;
  const grown = Math.min(MAX_SCALE, span * ZOOM_OUT_FACTOR) - span;
  if (grown <= 0) return choice;
  return side === 'start' ? { ...choice, start: snap(choice.start - grown) } : { ...choice, end: snap(choice.end + grown) };
}

/**
 * The scale zoomed in on the interval's markers when they are within {@link ZOOM_IN_BELOW} of the
 * scale (only with the interval on): {@link ZOOM_IN_FACTOR} times their span, at least {@link
 * MIN_SCALE}, centred on them. Otherwise the choice as it is.
 */
export function zoomedIn(choice: TimeChoice): TimeChoice {
  if (!choice.interval) return choice;
  const span = choice.end - choice.start;
  const markers = choice.to - choice.from;
  if (markers >= span * ZOOM_IN_BELOW) return choice;
  const scale = Math.max(MIN_SCALE, markers * ZOOM_IN_FACTOR);
  if (scale >= span) return choice;
  const middle = (choice.from + choice.to) / 2;
  return { ...choice, start: snap(middle - scale / 2), end: snap(middle + scale / 2) };
}

/**
 * The scale with new ends from the date pickers, refused (null) when the start is not at least
 * {@link MIN_SCALE} before the end, or the scale is over {@link MAX_SCALE}. The markers are kept on
 * the scale.
 */
export function rescaled(choice: TimeChoice, start: number, end: number): TimeChoice | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_SCALE || end - start > MAX_SCALE) return null;
  const s = snap(start);
  const e = snap(end);
  const keep = (ms: number) => Math.min(e, Math.max(s, ms));
  return { ...choice, start: s, end: e, set: choice.now ? choice.set : keep(choice.set), from: keep(choice.from), to: keep(choice.to) };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const two = (n: number) => String(n).padStart(2, '0');

/** `ms` as the clock's mode shows it: milliseconds shifted to the shown zone, read as UTC. */
function shown(ms: number, mode: ClockMode): Date {
  return mode === 'utc' ? new Date(ms) : new Date(ms - new Date(ms).getTimezoneOffset() * MINUTE);
}

/** Whether the scale covers more than one day in the clock's mode, so the markers show the date too. */
export function spansDays(choice: TimeChoice, mode: ClockMode): boolean {
  const a = shown(choice.start, mode);
  const b = shown(choice.end, mode);
  return a.getUTCFullYear() !== b.getUTCFullYear() || a.getUTCMonth() !== b.getUTCMonth() || a.getUTCDate() !== b.getUTCDate();
}

/** A marker's text: `12:00`, with the date when the scale covers several days: `06 NOV 12:00`. */
export function markerText(ms: number, mode: ClockMode, withDate: boolean): string {
  const d = shown(ms, mode);
  const time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return withDate ? `${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''} ${time}` : time;
}

/** A date picker's value (`datetime-local`): the time in the clock's mode, to the minute. */
export function pickerValue(ms: number, mode: ClockMode): string {
  return shown(ms, mode).toISOString().slice(0, 16);
}

/** A date picker's value as milliseconds, read in the clock's mode; NaN when it is not one. */
export function pickerTime(value: string, mode: ClockMode): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN;
  return mode === 'utc' ? Date.parse(`${value}:00Z`) : new Date(value).getTime();
}
