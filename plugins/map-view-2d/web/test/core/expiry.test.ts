/** Expired objects (brief function 13): which objects are faded, and when the others will fade. */
import { describe, expect, it } from 'vitest';
import { ExpiryTracker, FADED_OPACITY, itemOpacity, nextFadeStep } from '../../src/core/expiry.ts';
import { cotDataType, cotObject, symbolObject, uuid, WALL_START } from '../fixtures.ts';

const L = uuid(1);

describe('expiry', () => {
  it('fades an object of a fading data type from its expiry on, and tells when the others will', () => {
    const tracker = new ExpiryTracker([cotDataType()]);
    expect(tracker.track(cotObject(10, L, 15, 60, -1), WALL_START)).toBe(true);
    expect(tracker.track(cotObject(11, L, 15, 60, 2000), WALL_START)).toBe(false);
    expect(tracker.waiting).toBe(true);
    expect(tracker.due(WALL_START + 1999)).toEqual([]);
    expect(tracker.due(WALL_START + 2000)).toEqual([uuid(11)]);
    expect(tracker.isFaded(uuid(11))).toBe(true);
    expect(tracker.waiting).toBe(false);
  });

  it('never fades without fadeWhenExpired, without an expiry, or for a data type that is not available (the default behaviour)', () => {
    const tracker = new ExpiryTracker([cotDataType({ fadeWhenExpired: false })]);
    expect(tracker.track(cotObject(10, L, 15, 60, -1), WALL_START)).toBe(false);
    expect(tracker.track(symbolObject(11, L, 15, 60), WALL_START + 1e12)).toBe(false); // core.general
    const unknown = { ...cotObject(12, L, 15, 60, -1), dataType: 'gone.type' };
    expect(new ExpiryTracker([cotDataType()]).track(unknown, WALL_START)).toBe(false);
    expect(tracker.waiting).toBe(false);
  });

  it('takes expiresAfterSeconds from time.observed when there is no time.expires', () => {
    const tracker = new ExpiryTracker([cotDataType({ fadeWhenExpired: true, expiresAfterSeconds: 60 })]);
    const object = { ...symbolObject(10, L, 15, 60), dataType: 'cot.cot', time: { observed: new Date(WALL_START).toISOString() } };
    expect(tracker.track(object, WALL_START + 59_000)).toBe(false);
    expect(tracker.due(WALL_START + 60_000)).toEqual([uuid(10)]);
  });

  it('forgets objects that are gone, and applies a changed behaviour on the next track', () => {
    const tracker = new ExpiryTracker([cotDataType()]);
    tracker.track(cotObject(10, L, 15, 60, 1000), WALL_START);
    tracker.forget(uuid(10));
    expect(tracker.waiting).toBe(false);
    tracker.track(cotObject(11, L, 15, 60, -1), WALL_START);
    tracker.setDataTypes([cotDataType({ fadeWhenExpired: false })]);
    expect(tracker.track(cotObject(11, L, 15, 60, -1), WALL_START)).toBe(false);
    expect(tracker.isFaded(uuid(11))).toBe(false);
  });
});

describe('the fade in steps (brief function 46, SDK 1.7.0)', () => {
  const fade = { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
  const stepping = () => ({ ...cotDataType(), fade });
  const observed = (n: number, ms = WALL_START) => ({ ...cotObject(n, L, 15, 60, 60_000), time: { observed: new Date(ms).toISOString(), expires: new Date(WALL_START + 60_000).toISOString() } });

  it('tracks the step of an object of a data type with a fade, and never the expiry fade, even past the expiry', () => {
    const tracker = new ExpiryTracker([stepping()]);
    expect(tracker.track(observed(10), WALL_START + 55_000)).toBe(false);
    expect(tracker.step(uuid(10))).toBe(0.5);
    expect(tracker.track(observed(10), WALL_START + 61_000)).toBe(false); // expired at 60 s
    expect(tracker.isFaded(uuid(10))).toBe(false);
    expect(tracker.step(uuid(10))).toBe(0.45);
    expect(tracker.step(uuid(99))).toBeUndefined();
    const expired = new ExpiryTracker([cotDataType()]);
    expect(expired.track(observed(11), WALL_START + 61_000)).toBe(true);
    expired.setDataTypes([stepping()]); // a fade is given to the type: the expiry fade goes
    expect(expired.track(observed(11), WALL_START + 61_000)).toBe(false);
    expect(expired.isFaded(uuid(11))).toBe(false);
  });

  it('gives the time of the next step, and the objects that are due at it, tracked again by the caller', () => {
    const tracker = new ExpiryTracker([stepping()]);
    tracker.track(observed(10), WALL_START + 1_000);
    expect(tracker.waiting).toBe(true);
    expect(tracker.due(WALL_START + 9_999)).toEqual([]); // the fade starts at 10 s
    expect(tracker.due(WALL_START + 10_000)).toEqual([uuid(10)]);
    tracker.track(observed(10), WALL_START + 10_000);
    expect(tracker.due(WALL_START + 14_499)).toEqual([]); // the first step is at 14.5 s
    expect(tracker.due(WALL_START + 14_500)).toEqual([uuid(10)]);
    expect(tracker.waiting).toBe(false); // until it is tracked again
    tracker.track(observed(10), WALL_START + 14_500);
    expect(tracker.step(uuid(10))).toBe(0.95);
    expect(tracker.due(WALL_START + 18_999)).toEqual([]);
    expect(tracker.due(WALL_START + 19_000)).toEqual([uuid(10)]); // the steps are 4.5 s apart
  });

  it('waits for nothing once the object is invisible, or has no time.observed', () => {
    const tracker = new ExpiryTracker([stepping()]);
    tracker.track(observed(10), WALL_START + 100_000);
    expect(tracker.step(uuid(10))).toBe(0);
    expect(tracker.waiting).toBe(false);
    tracker.track({ ...observed(11), time: {} }, WALL_START + 100_000);
    expect(tracker.step(uuid(11))).toBe(1);
    expect(tracker.waiting).toBe(false);
  });

  it('forgets a gone object, and follows a changed fade on the next track', () => {
    const tracker = new ExpiryTracker([stepping()]);
    tracker.track(observed(10), WALL_START + 20_000);
    tracker.forget(uuid(10));
    expect(tracker.step(uuid(10))).toBeUndefined();
    expect(tracker.waiting).toBe(false);
    tracker.track(observed(10), WALL_START + 20_000);
    tracker.setDataTypes([cotDataType()]); // no fade now: the expiry fade again
    expect(tracker.track(observed(10), WALL_START + 70_000)).toBe(true);
    expect(tracker.step(uuid(10))).toBeUndefined();
  });

  it('knows when the next step is: before the fade starts, between steps, never when invisible or unobserved', () => {
    const o = observed(10);
    expect(nextFadeStep(o, fade, WALL_START, 1)).toBe(WALL_START + 10_000);
    expect(nextFadeStep(o, fade, WALL_START + 10_000, 1)).toBe(WALL_START + 14_500);
    expect(nextFadeStep(o, fade, WALL_START + 14_499, 1)).toBe(WALL_START + 14_500);
    expect(nextFadeStep(o, fade, WALL_START + 99_999, 0.05)).toBe(WALL_START + 100_000);
    expect(nextFadeStep(o, fade, WALL_START + 100_000, 0)).toBeNull();
    expect(nextFadeStep({ ...o, time: {} }, fade, WALL_START, 1)).toBeNull();
  });

  it('the opacity an item is drawn at: its own, else the faded one, else full', () => {
    expect(itemOpacity({})).toBe(1);
    expect(itemOpacity({ faded: true })).toBe(FADED_OPACITY);
    expect(itemOpacity({ opacity: 0.7 })).toBe(0.7);
    expect(itemOpacity({ faded: true, opacity: 0.2 })).toBe(0.2);
  });
});
