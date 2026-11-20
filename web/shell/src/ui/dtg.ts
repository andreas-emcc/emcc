/**
 * Date-time groups for the clock (ADR-0031 point 1; owner, 2026-10-16): day, hours and minutes,
 * the time zone letter, the month and the year, e.g. `161045Z OCT 26`. UTC is `Z` (Zulu). Local time
 * uses the military zone letter of its offset when that is a whole number of hours (`A` to `M`
 * east, without `J`; `N` to `Y` west), and `J` (local time) for any other offset.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const EAST = 'ABCDEFGHIKLM'; // +1 … +12, J left out
const WEST = 'NOPQRSTUVWXY'; // -1 … -12

const two = (n: number) => String(n).padStart(2, '0');

/** The zone letter of an offset east of UTC, in minutes. */
export function zoneLetter(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'Z';
  if (offsetMinutes % 60 !== 0) return 'J';
  const hours = offsetMinutes / 60;
  if (hours >= 1 && hours <= 12) return EAST.charAt(hours - 1);
  if (hours <= -1 && hours >= -12) return WEST.charAt(-hours - 1);
  return 'J';
}

/** The local offset east of UTC at `at`, in minutes. */
export function localOffset(at: Date): number {
  return -at.getTimezoneOffset();
}

/** `at` as a date-time group in UTC, or in local time with the offset east of UTC in minutes. */
export function dtg(at: Date, mode: 'utc' | 'local', offsetMinutes = localOffset(at)): string {
  const shown = mode === 'utc' ? at : new Date(at.getTime() + offsetMinutes * 60_000);
  const letter = mode === 'utc' ? 'Z' : zoneLetter(offsetMinutes);
  return `${two(shown.getUTCDate())}${two(shown.getUTCHours())}${two(shown.getUTCMinutes())}${letter} `
    + `${MONTHS[shown.getUTCMonth()] ?? ''} ${two(shown.getUTCFullYear() % 100)}`;
}

/** The full time for the clock's hover text, e.g. `2026-10-16 12:45 UTC+02:00`. */
export function fullTime(at: Date, mode: 'utc' | 'local', offsetMinutes = localOffset(at)): string {
  const offset = mode === 'utc' ? 0 : offsetMinutes;
  const shown = new Date(at.getTime() + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const zone = offset === 0 && mode === 'utc' ? 'UTC' : `UTC${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
  return `${String(shown.getUTCFullYear())}-${two(shown.getUTCMonth() + 1)}-${two(shown.getUTCDate())} `
    + `${two(shown.getUTCHours())}:${two(shown.getUTCMinutes())} ${zone}`;
}
