/**
 * SDK 1.7.0 (CR-0042; T-192, owner TA A, FC A): a data type's stepped fade, taken from its
 * plugin's settings (`dataTypes[].fadeSetting`), and the opacity it gives an object.
 */
import type { DataType } from './context.ts';
import type { MapObject } from './model.ts';
import { settingAt } from './sets.ts';

/** The steps a stepped fade may take, in per cent: the divisors of 100 below it, so the steps end at 0. */
export const STEP_PERCENTS = [1, 2, 4, 5, 10, 20, 25, 50] as const;

/** The longest `fromSeconds` and `invisibleAtSeconds`: a day. */
export const MAX_FADE_SECONDS = 86_400;

/**
 * A stepped fade that is on (the model's `$defs/steppedFade` without `on`), counted from an
 * object's `time.observed`: full opacity before `fromSeconds`; then one step down by `stepPercent`
 * every (`invisibleAtSeconds` − `fromSeconds`) × `stepPercent` / 100 seconds; 0 from `invisibleAtSeconds`.
 */
export interface SteppedFade {
  /** Seconds after `time.observed`, 0 to {@link MAX_FADE_SECONDS}. */
  readonly fromSeconds: number;
  /** One of {@link STEP_PERCENTS}. */
  readonly stepPercent: number;
  /** Seconds after `time.observed`, above `fromSeconds`, at most {@link MAX_FADE_SECONDS}. */
  readonly invisibleAtSeconds: number;
}

const whole = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= MAX_FADE_SECONDS;

/**
 * The stepped fade a setting's value gives: `undefined` when it is off, or not of the model's
 * form (`$defs/steppedFade`, with `invisibleAtSeconds` above `fromSeconds`, model rule 22).
 *
 * @example
 * steppedFadeOf({ on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });   // { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 }
 * steppedFadeOf({ on: false, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 });  // undefined
 */
export function steppedFadeOf(value: unknown): SteppedFade | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['on', 'fromSeconds', 'stepPercent', 'invisibleAtSeconds'].includes(k))) return undefined;
  if (v.on !== true || !whole(v.fromSeconds, 0) || !whole(v.invisibleAtSeconds, 1)) return undefined;
  if (!(STEP_PERCENTS as readonly unknown[]).includes(v.stepPercent) || v.invisibleAtSeconds <= v.fromSeconds) return undefined;
  return Object.freeze({ fromSeconds: v.fromSeconds, stepPercent: v.stepPercent as number, invisibleAtSeconds: v.invisibleAtSeconds });
}

/**
 * Each data type with its `fade` taken from the declaring plugin's current settings
 * (`fadeSetting`), and without one where it has none. The shell gives the result as
 * `ctx.dataTypes`, again after each settings change (`onDataTypesChange`); the map view draws with
 * it. `settingsOf` gives a plugin's current settings by its id. Types whose fade is unchanged are
 * returned as they were.
 *
 * @example
 * const types = withSteppedFades(dataTypes, (plugin) => settingsByPlugin[plugin]);
 * types.find((t) => t.id === 'gmti.detection')?.fade;   // { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 }
 */
export function withSteppedFades(dataTypes: readonly DataType[], settingsOf: (pluginId: string) => unknown): readonly DataType[] {
  return dataTypes.map((t) => {
    const fade = t.fadeSetting === undefined || t.declaredBy === null ? undefined : steppedFadeOf(settingAt(settingsOf(t.declaredBy), t.fadeSetting));
    if (sameFade(fade, t.fade)) return t;
    if (fade === undefined) {
      const rest: { -readonly [K in keyof DataType]: DataType[K] } = { ...t };
      delete rest.fade;
      return rest;
    }
    return { ...t, fade };
  });
}

/** Whether two fades are equal; `undefined` equals `undefined`. */
export function sameFade(a: SteppedFade | undefined, b: SteppedFade | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.fromSeconds === b.fromSeconds && a.stepPercent === b.stepPercent && a.invisibleAtSeconds === b.invisibleAtSeconds;
}

/**
 * The opacity, 0 to 1, at which `fade` draws `object` at `now` (ms since the epoch). 1 for an
 * object without a parsable `time.observed`. Fading happens without a change event, so compare
 * with the clock, as for `expiresAt`.
 *
 * @example
 * // fade { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 }, observed at t:
 * fadeOpacity(o, fade, t + 14_000);    // 1
 * fadeOpacity(o, fade, t + 14_500);    // 0.95
 * fadeOpacity(o, fade, t + 55_000);    // 0.5
 * fadeOpacity(o, fade, t + 100_000);   // 0
 */
export function fadeOpacity(object: MapObject, fade: SteppedFade, now: number = Date.now()): number {
  const observed = object.time?.observed;
  if (observed === undefined) return 1;
  const from = Date.parse(observed);
  if (Number.isNaN(from)) return 1;
  const ageMs = now - from;
  if (ageMs < fade.fromSeconds * 1000) return 1;
  if (ageMs >= fade.invisibleAtSeconds * 1000) return 0;
  // A step lasts (invisibleAt - from) * 1000 * step / 100 ms, a whole number since both are whole.
  const stepMs = (fade.invisibleAtSeconds - fade.fromSeconds) * 10 * fade.stepPercent;
  const steps = Math.floor((ageMs - fade.fromSeconds * 1000) / stepMs);
  return Math.max(0, 100 - steps * fade.stepPercent) / 100;
}
