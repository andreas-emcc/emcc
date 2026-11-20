import { describe, expect, it } from 'vitest';
import { dtg, fullTime, zoneLetter } from './dtg.ts';

const AT = new Date('2026-10-16T10:45:30Z');

describe('date-time groups', () => {
  it('shows UTC as Zulu: day, hours, minutes, Z, month, year', () => {
    expect(dtg(AT, 'utc')).toBe('161045Z OCT 26');
    expect(dtg(new Date('2027-01-01T00:05:00Z'), 'utc')).toBe('010005Z JAN 27');
    expect(fullTime(AT, 'utc')).toBe('2026-10-16 10:45 UTC');
  });

  it('shows local time with the zone letter of a whole-hour offset, J otherwise', () => {
    expect(dtg(AT, 'local', 120)).toBe('161245B OCT 26');
    expect(dtg(AT, 'local', -300)).toBe('160545R OCT 26');
    expect(dtg(new Date('2026-10-16T22:30:00Z'), 'local', 330)).toBe('170400J OCT 26'); // India: past midnight, half an hour
    expect(dtg(AT, 'local', 0)).toBe('161045Z OCT 26');
    expect(fullTime(AT, 'local', 120)).toBe('2026-10-16 12:45 UTC+02:00');
    expect(fullTime(AT, 'local', -570)).toBe('2026-10-16 01:15 UTC-09:30');
  });

  it('has the military letters: A to M east without J, N to Y west', () => {
    expect([1, 9, 10, 12].map((h) => zoneLetter(h * 60))).toEqual(['A', 'I', 'K', 'M']);
    expect([-1, -12].map((h) => zoneLetter(h * 60))).toEqual(['N', 'Y']);
    expect([0, 45, 13 * 60, 14 * 60].map((m) => zoneLetter(m))).toEqual(['Z', 'J', 'J', 'J']);
  });
});
