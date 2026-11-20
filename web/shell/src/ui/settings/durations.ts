/** T-203 part D (owner, M units A): a time in whole seconds, typed as a number and a unit. */

export type TimeUnit = 'seconds' | 'minutes' | 'hours';

export const UNIT_SECONDS: Readonly<Record<TimeUnit, number>> = Object.freeze({ seconds: 1, minutes: 60, hours: 3600 });

export const TIME_UNITS: readonly TimeUnit[] = ['seconds', 'minutes', 'hours'];

/** The largest unit that divides the seconds evenly; seconds for none or 0. */
export function unitOf(seconds: number | undefined): TimeUnit {
  if (seconds === undefined || seconds === 0) return 'seconds';
  if (seconds % 3600 === 0) return 'hours';
  if (seconds % 60 === 0) return 'minutes';
  return 'seconds';
}

/** The unit to show the seconds in: the chosen one when it divides them evenly, else {@link unitOf}. */
export function shownUnit(seconds: number | undefined, chosen: TimeUnit): TimeUnit {
  return seconds === undefined || seconds % UNIT_SECONDS[chosen] === 0 ? chosen : unitOf(seconds);
}

/**
 * What typed text means: `never` for nothing, the seconds for a whole number of the unit, `invalid`
 * for anything else (the field keeps it and says so).
 */
export function readTime(text: string, unit: TimeUnit): 'never' | 'invalid' | number {
  const t = text.trim();
  if (t === '') return 'never';
  if (!/^\d+$/.test(t)) return 'invalid';
  const seconds = Number(t) * UNIT_SECONDS[unit];
  return Number.isSafeInteger(seconds) ? seconds : 'invalid';
}
