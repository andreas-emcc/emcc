import { describe, expect, it, vi } from 'vitest';
import {
  HOUR, initialChoice, markerText, MAX_SCALE, MIN_SCALE, MINUTE, moved, nearEnd, pickerTime, pickerValue, rescaled, spansDays,
  userTimeOf, valueAt, zoomedIn, zoomedOut, type TimeChoice,
} from './choice.ts';
import { TemporalPlugins, withSessionHeader, SESSION_HEADER } from './temporal.ts';

const NOON = Date.parse('2026-11-06T12:00:20Z');

describe('the time control\'s choice (ADR-0045; the owner\'s design, 2026-11-06)', () => {
  it('starts at now, now ± 12 h, and gives now, the set time or the interval as the toggle picks', () => {
    const c = initialChoice(NOON);
    expect(c).toEqual({ now: true, interval: false, set: Date.parse('2026-11-06T12:00:00Z'), from: Date.parse('2026-11-06T11:00:00Z'),
      to: Date.parse('2026-11-06T13:00:00Z'), start: Date.parse('2026-11-06T00:00:00Z'), end: Date.parse('2026-11-07T00:00:00Z') });
    expect(userTimeOf(null)).toEqual({});
    expect(userTimeOf(c)).toEqual({});
    const set = moved(c, 'set', Date.parse('2026-11-06T08:29:40Z'));
    expect(userTimeOf(set), 'moving a marker leaves now, to the minute').toEqual({ time: '2026-11-06T08:30:00.000Z' });
    expect(userTimeOf({ ...set, interval: true }), 'both parts (CR-0032)').toEqual({ time: '2026-11-06T08:30:00.000Z', interval: { from: '2026-11-06T11:00:00.000Z', to: '2026-11-06T13:00:00.000Z' } });
    expect(userTimeOf({ ...c, interval: true }), 'now with an interval').toEqual({ interval: { from: '2026-11-06T11:00:00.000Z', to: '2026-11-06T13:00:00.000Z' } });
    expect(moved({ ...c, interval: true }, 'from', c.from - HOUR).now, 'the interval’s markers keep the set time at now').toBe(true);
  });

  it('keeps the markers on the scale and an interval\'s start not after its stop', () => {
    const c = initialChoice(NOON);
    expect(moved(c, 'set', c.end + HOUR).set).toBe(c.end);
    expect(moved(c, 'from', c.to + HOUR).from, 'the start stops at the stop').toBe(c.to);
    expect(moved(c, 'to', c.from - HOUR).to).toBe(c.from);
    expect(valueAt(c, 0.5)).toBe(Date.parse('2026-11-06T12:00:00Z'));
    expect(valueAt(c, 2)).toBe(c.end);
  });

  it('zooms in when the interval\'s markers come within 10 % of the scale, to 4 times their span around them', () => {
    const c: TimeChoice = { ...initialChoice(NOON), interval: true, from: NOON - 30 * MINUTE, to: NOON + 30 * MINUTE };
    expect(zoomedIn(c), '1 h of 24 h').toMatchObject({ start: Date.parse('2026-11-06T10:00:00Z'), end: Date.parse('2026-11-06T14:00:00Z') });
    expect(zoomedIn({ ...c, interval: false }), 'only with the interval on').toEqual({ ...c, interval: false });
    const wide = { ...c, from: NOON - 2 * HOUR, to: NOON + 2 * HOUR };
    expect(zoomedIn(wide), '4 h of 24 h: no zoom').toEqual(wide);
    const tight = zoomedIn({ ...c, from: NOON, to: NOON });
    expect(tight.end - tight.start, 'never below 10 minutes').toBe(MIN_SCALE);
  });

  it('zooms out 1.5 times away from an end while a marker is held in its outer 3 %', () => {
    const c = initialChoice(NOON);
    expect(nearEnd(0.02)).toBe('start');
    expect(nearEnd(0.98)).toBe('end');
    expect(nearEnd(0.5)).toBeNull();
    expect(zoomedOut(c, 'end')).toMatchObject({ start: c.start, end: c.end + 12 * HOUR });
    expect(zoomedOut(c, 'start')).toMatchObject({ start: c.start - 12 * HOUR, end: c.end });
    const huge = { ...c, start: 0, end: MAX_SCALE };
    expect(zoomedOut(huge, 'end'), 'at most 10 years').toEqual(huge);
  });

  it('takes the pickers\' ends when the scale is 10 minutes or more, keeping the markers on it', () => {
    const c = { ...initialChoice(NOON), now: false };
    expect(rescaled(c, c.start, c.start + 5 * MINUTE)).toBeNull();
    expect(rescaled(c, c.end, c.start)).toBeNull();
    expect(rescaled(c, Number.NaN, c.end)).toBeNull();
    expect(rescaled(c, NOON + 2 * HOUR, c.end)).toMatchObject({ start: Date.parse('2026-11-06T14:00:00Z'), set: Date.parse('2026-11-06T14:00:00Z') });
  });

  it('shows times as the clock does, with the date when the scale covers several days', () => {
    const c = initialChoice(NOON);
    expect(spansDays(c, 'utc'), '00:00 to the next 00:00').toBe(true);
    expect(spansDays({ ...c, end: c.end - MINUTE }, 'utc')).toBe(false);
    expect(markerText(NOON, 'utc', false)).toBe('12:00');
    expect(markerText(NOON, 'utc', true)).toBe('06 NOV 12:00');
    expect(pickerValue(NOON, 'utc')).toBe('2026-11-06T12:00');
    expect(pickerTime('2026-11-06T12:00', 'utc')).toBe(Date.parse('2026-11-06T12:00:00Z'));
    expect(pickerTime('soon', 'utc')).toBeNaN();
    expect(pickerTime(pickerValue(NOON - 20_000, 'local'), 'local'), 'local time round trips').toBe(Date.parse('2026-11-06T12:00:00Z'));
  });
});

describe('the temporal web parts (ADR-0045 point 4)', () => {
  it('get the time once when added and once per change; one that throws is reported and keeps getting them', () => {
    const errors: string[] = [];
    const plugins = new TemporalPlugins((id) => { errors.push(id); });
    const seen: unknown[] = [];
    plugins.add('history', { timeChanged: (t) => { seen.push(t); } });
    plugins.add('broken', { timeChanged: () => { throw new Error('no'); } });
    const at = { time: '2026-11-06T08:00:00.000Z' } as const;

    plugins.changed(at);
    plugins.changed({ ...at });
    plugins.remove('history');
    plugins.changed({});

    expect(seen).toEqual([{}, at]);
    expect(errors).toEqual(['broken', 'broken', 'broken']);
    expect(plugins.time).toEqual({});
  });
});

describe('the session header (owner, 2026-11-06)', () => {
  const ORIGIN = 'https://emcc.example';

  it('names the page\'s session in requests to the plugins\' endpoints only', async () => {
    const original = vi.fn<typeof fetch>(() => Promise.resolve(new Response('')));
    let session: string | null = 's-1';
    const f = withSessionHeader(original, () => session, ORIGIN);
    const sent = (i: number) => new Headers(original.mock.calls[i]?.[1]?.headers).get(SESSION_HEADER);

    await f('/api/plugins/history/time');
    await f(`${ORIGIN}/api/plugins/history/time`, { headers: { [SESSION_HEADER]: 'mine' } });
    await f('/api/config');
    await f('https://elsewhere.example/api/plugins/history/time');
    await f(new Request(`${ORIGIN}/api/plugins/history/time`, { headers: { Accept: 'text/plain' } }));
    session = null;
    await f('/api/plugins/history/time');

    expect(sent(0)).toBe('s-1');
    expect(sent(1), 'a header the request names is kept').toBe('mine');
    expect(original.mock.calls[2]?.[1], 'not a plugin endpoint').toBeUndefined();
    expect(original.mock.calls[3]?.[1], 'another origin').toBeUndefined();
    expect(sent(4)).toBe('s-1');
    expect(new Headers(original.mock.calls[4]?.[1]?.headers).get('Accept'), 'a Request\'s own headers kept').toBe('text/plain');
    expect(original.mock.calls[5]?.[1], 'no session open').toBeUndefined();
  });
});
