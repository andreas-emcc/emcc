// SDK 1.7.0 (CR-0042; T-192, owner TA A and FC A): a data type's stepped fade from its plugin's settings.
import { describe, expect, it } from 'vitest';
import { fadeOpacity, sameFade, steppedFadeOf, withSteppedFades, type DataType, type MapObject, type SteppedFade } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const OWNERS: SteppedFade = { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
const ON = { on: true, fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
const T0 = Date.parse('2026-11-12T12:00:00Z');

// lon differs from lat, so a swapped order would show
const detection = (observed?: string): MapObject => ({
  id: '0190a6f0-0000-7000-8000-000000000001', version: 1, type: 'core.symbol', dataType: 'gmti.detection', dataSource: 'link',
  layerId: '0190a6f0-0000-7000-8000-0000000000aa', geometry: { type: 'Point', coordinates: [17.3069, 62.3908] },
  symbol: { standard: 'APP-6D', code: '10061500001102000000' },
  label: { policyIdentifier: 'NATO', classification: 'UNCLASSIFIED' }, extensions: {},
  ...(observed === undefined ? {} : { time: { observed } }),
  meta: { createdAt: '2026-11-12T12:00:00Z', updatedAt: '2026-11-12T12:00:00Z', createdBy: 'gmti', updatedBy: 'gmti' },
} as unknown as MapObject);

const DETECTION_TYPE: DataType = {
  id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', manual: false, fadeSetting: '/detectionFade',
  defaults: { expiresAfterSeconds: 60, fadeWhenExpired: true, removeAfterExpirySeconds: 120 },
  behaviour: { expiresAfterSeconds: 60, fadeWhenExpired: true, removeAfterExpirySeconds: 120 },
};

describe('SDK 1.7.0: fadeOpacity', () => {
  const o = detection('2026-11-12T12:00:00Z');
  it('steps the owner\'s example: full until 10 s, a 5 % step every 4.5 s, invisible at 100 s (FC A)', () => {
    expect(fadeOpacity(o, OWNERS, T0)).toBe(1);
    expect(fadeOpacity(o, OWNERS, T0 + 10_000)).toBe(1);
    expect(fadeOpacity(o, OWNERS, T0 + 14_499)).toBe(1);
    expect(fadeOpacity(o, OWNERS, T0 + 14_500)).toBe(0.95);
    expect(fadeOpacity(o, OWNERS, T0 + 55_000)).toBe(0.5);
    expect(fadeOpacity(o, OWNERS, T0 + 99_999)).toBe(0.05);
    expect(fadeOpacity(o, OWNERS, T0 + 100_000)).toBe(0);
    expect(fadeOpacity(o, OWNERS, T0 + 1_000_000)).toBe(0);
  });
  it('takes every step: from 0, by 50 %, invisible at 20 s', () => {
    const half: SteppedFade = { fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 };
    expect(fadeOpacity(o, half, T0 + 9_999)).toBe(1);
    expect(fadeOpacity(o, half, T0 + 10_000)).toBe(0.5);
    expect(fadeOpacity(o, half, T0 + 20_000)).toBe(0);
  });
  it('leaves an object without a parsable time.observed alone, also one observed in the future', () => {
    expect(fadeOpacity(detection(), OWNERS, T0 + 500_000)).toBe(1);
    expect(fadeOpacity(detection('not a time'), OWNERS, T0)).toBe(1);
    expect(fadeOpacity(o, OWNERS, T0 - 60_000)).toBe(1);
  });
});

describe('SDK 1.7.0: steppedFadeOf', () => {
  it('reads a setting that is on and of the model\'s form', () => {
    expect(steppedFadeOf(ON)).toEqual(OWNERS);
    expect(Object.isFrozen(steppedFadeOf(ON))).toBe(true);
  });
  it('gives none for a setting that is off or not of the form (model rule 22)', () => {
    expect(steppedFadeOf({ ...ON, on: false })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, stepPercent: 3 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, stepPercent: 100 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, invisibleAtSeconds: 10 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, fromSeconds: -1 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, fromSeconds: 1.5 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, invisibleAtSeconds: 86_401 })).toBeUndefined();
    expect(steppedFadeOf({ ...ON, extra: 1 })).toBeUndefined();
    const { stepPercent: _s, ...missing } = ON;
    expect(steppedFadeOf(missing)).toBeUndefined();
    expect(steppedFadeOf(null)).toBeUndefined();
    expect(steppedFadeOf([ON])).toBeUndefined();
    expect(steppedFadeOf('on')).toBeUndefined();
  });
  it('compares fades by value', () => {
    expect(sameFade(OWNERS, { ...OWNERS })).toBe(true);
    expect(sameFade(OWNERS, { ...OWNERS, stepPercent: 10 })).toBe(false);
    expect(sameFade(undefined, undefined)).toBe(true);
    expect(sameFade(OWNERS, undefined)).toBe(false);
  });
});

describe('SDK 1.7.0: withSteppedFades', () => {
  const general: DataType = { id: 'core.general', name: 'General', declaredBy: null, defaults: {}, behaviour: {} };
  it('takes each type\'s fade from its plugin\'s settings, and leaves the others as they were', () => {
    const types = withSteppedFades([general, DETECTION_TYPE], (p) => (p === 'gmti' ? { detectionFade: ON } : undefined));
    expect(types[0]).toBe(general);
    expect(types[1]?.fade).toEqual(OWNERS);
    expect(types[1]?.fadeSetting).toBe('/detectionFade');
    expect(withSteppedFades(types, (p) => (p === 'gmti' ? { detectionFade: ON } : undefined))[1]).toBe(types[1]);
  });
  it('drops the fade when the setting goes off, is missing or is broken', () => {
    const faded = withSteppedFades([DETECTION_TYPE], () => ({ detectionFade: ON }));
    for (const settings of [{ detectionFade: { ...ON, on: false } }, {}, { detectionFade: { ...ON, stepPercent: 7 } }, undefined]) {
      const [type] = withSteppedFades(faded, () => settings);
      expect(type?.fade).toBeUndefined();
      expect(type !== undefined && 'fade' in type).toBe(false);
      expect(type?.fadeSetting).toBe('/detectionFade');
    }
  });
});

describe('SDK 1.7.0: the test kit resolves the fades', () => {
  it('gives ctx.dataTypes their fades and follows a change of the plugin\'s settings', () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d', dataTypes: [DETECTION_TYPE], pluginSettings: { gmti: { detectionFade: ON } } });
    expect(ctx.dataTypes.find((t) => t.id === 'gmti.detection')?.fade).toEqual(OWNERS);
    const seen: (SteppedFade | undefined)[] = [];
    ctx.onDataTypesChange((types) => seen.push(types.find((t) => t.id === 'gmti.detection')?.fade));
    ctx.setPluginSettings('gmti', { detectionFade: { on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 } });
    ctx.setPluginSettings('gmti', { detectionFade: { on: true, fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 } });
    ctx.setPluginSettings('gmti', { detectionFade: { ...ON, on: false } });
    expect(seen).toEqual([{ fromSeconds: 0, stepPercent: 50, invisibleAtSeconds: 20 }, undefined]);
    expect(ctx.dataTypes[0]?.id).toBe('core.general');
  });
  it('resolves a type the plugin under test declares from its own settings', () => {
    const ctx = createFakeContext({ pluginId: 'gmti', dataTypes: [DETECTION_TYPE], settings: { detectionFade: ON } });
    expect(ctx.dataTypes.find((t) => t.id === 'gmti.detection')?.fade).toEqual(OWNERS);
    ctx.changeSettings({ detectionFade: { ...ON, on: false } });
    expect(ctx.dataTypes.find((t) => t.id === 'gmti.detection')?.fade).toBeUndefined();
  });
});
