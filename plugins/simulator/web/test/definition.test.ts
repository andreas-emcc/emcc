// The route's extension as the editor changes it (brief functions 4 to 6 and 9; open question 10,
// Q13, A36, A40, A41): points are inserted and deleted with their entries, a new point copies the
// previous one's values, and every field the editor does not know is kept.
import { describe, expect, it } from 'vitest';
import type { LineString } from '@emc2/plugin-sdk';
import {
  copiedEntry, deletePoint, formatTime, insertPoint, listedObjects, newRouteExtension, NEW_ROUTE_SPEED, parseTime, pointEntries, pointValues, withEditChoice, without,
} from '../src/definition.ts';
import { nextRouteName } from '../src/editor.ts';

// latitude ≠ longitude everywhere
const LINE: LineString = { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4], [18.5, 59.6]] };
const EXT = {
  points: [
    { speedKind: 'ramp', speed: 10, altitudeKind: 'ramp', altitude: 120, events: [{ kind: 'hide' }], note: 'kept' },
    { speed: 20, time: { seconds: 60, from: 'start', unit: 'kn' } },
    { speed: 5 },
  ],
  groups: [{ kind: 'convoy', spacing: 50, objects: [{ id: 'A' }, { id: 'B' }] }],
  end: 'restart',
  extra: { kept: true },
};

describe('typed times (function 6, A38)', () => {
  it('reads h:mm:ss, m:ss and seconds, with a point or a comma', () => {
    expect(parseTime('1:02:05')).toBe(3725);
    expect(parseTime('2:30')).toBe(150);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1,5')).toBe(1.5);
    expect(parseTime(' ')).toBeNull();
  });

  it('refuses anything else', () => {
    for (const text of ['1:75', 'fast', '1:2:3:4', '-5', '1:-2']) expect(parseTime(text)).toBeNaN();
  });

  it('shows seconds as h:mm:ss, with tenths when it has them', () => {
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(0)).toBe('0:00:00');
    expect(formatTime(61.25)).toBe('0:01:01.3');
  });
});

describe('the points (functions 4 and 5)', () => {
  it('reads one entry per point, missing ones as empty, with their values', () => {
    const entries = pointEntries(EXT, 4);
    expect(entries).toHaveLength(4);
    expect(entries[3]).toEqual({});
    expect(pointValues(entries[1] ?? {})).toEqual({ speedKind: 'instant', speed: 20, time: { seconds: 60, from: 'start', unit: 'kn' }, altitudeKind: 'instant', altitude: null, events: [] });
  });

  it("inserts a point after another, copying its speed and altitude with their kinds, not its time or events (open question 10, Q13)", () => {
    const { line, ext } = insertPoint(LINE, EXT, 0, [18.1, 59.35]);
    expect(line.coordinates).toEqual([[18.0, 59.3], [18.1, 59.35], [18.2, 59.4], [18.5, 59.6]]);
    const entries = pointEntries(ext, 4);
    expect(entries[1]).toEqual({ speedKind: 'ramp', speed: 10, altitudeKind: 'ramp', altitude: 120 });
    expect(entries[0]).toEqual(EXT.points[0]);
    expect(entries[2]).toEqual(EXT.points[1]);
    expect(ext['groups']).toEqual(EXT.groups);
    expect(ext['extra']).toEqual({ kept: true });
  });

  it('adds a point at the end', () => {
    const { line, ext } = insertPoint(LINE, EXT, 2, [19, 60]);
    expect(line.coordinates.at(-1)).toEqual([19, 60]);
    expect(pointEntries(ext, 4)[3]).toEqual({ speedKind: 'instant', speed: 5, altitudeKind: 'instant' });
  });

  it('deletes a point with its entry and its events (A41)', () => {
    const { line, ext } = deletePoint(LINE, EXT, 1);
    expect(line.coordinates).toEqual([[18.0, 59.3], [18.5, 59.6]]);
    expect(pointEntries(ext, 2)).toEqual([EXT.points[0], EXT.points[2]]);
  });

  it('takes the typed time off a point that becomes the first (the route\'s start has none)', () => {
    const { line, ext } = deletePoint(LINE, EXT, 0);
    expect(line.coordinates).toEqual([[18.2, 59.4], [18.5, 59.6]]);
    expect(pointEntries(ext, 2)).toEqual([{ speed: 20 }, EXT.points[2]]);
  });

  it("gives a point copied from one with only a typed time the computed speed", () => {
    expect(copiedEntry({ speedKind: 'ramp', time: { seconds: 60 } }, 12.5)).toEqual({ speedKind: 'ramp', speed: 12.5, altitudeKind: 'instant' });
  });

  it('gives a new route a step to 30 km/h at every point, an empty altitude, and "stop" (A36, open question 10)', () => {
    expect(newRouteExtension(3)).toEqual({ points: Array.from({ length: 3 }, () => ({ speedKind: 'instant', speed: NEW_ROUTE_SPEED, altitudeKind: 'instant' })), end: 'stop' });
    expect(NEW_ROUTE_SPEED * 3.6).toBeCloseTo(30, 10);
    expect(copiedEntry({ speed: 3, time: { seconds: 5 } })).toEqual({ speedKind: 'instant', speed: 3, altitudeKind: 'instant' });
    expect(without({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
  });
});

describe('the move-or-disconnect choice (function 9, A40)', () => {
  it('raises the edit number above any seen', () => {
    expect(withEditChoice(EXT, 'move')['edit']).toEqual({ number: 1, objects: 'move' });
    expect(withEditChoice({ ...EXT, edit: { number: 7, objects: 'move' } }, 'disconnect')['edit']).toEqual({ number: 8, objects: 'disconnect' });
  });

  it('lists the route objects in list order, with their group kind', () => {
    expect(listedObjects(EXT)).toEqual([{ id: 'a', kind: 'convoy' }, { id: 'b', kind: 'convoy' }]);
  });
});

describe('a new route\'s name (function 4)', () => {
  it('is "Route N", one more than the highest number', () => {
    expect(nextRouteName([])).toBe('Route 1');
    expect(nextRouteName(['Route 2', 'Alpha', 'Route 10', 'Route x'])).toBe('Route 11');
  });
});
