// SDK 1.5.0 part 3 (CR-0039 points 5 and 6; T-164, T-151): the speed vector in steps, and sensor
// report data types with the symbology service's sensor report symbol.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY, displayChoicesProblem, displaySettingsProblem, nearestSpeedVectorStep, resolveDisplay, SPEED_VECTOR_STEPS_SECONDS,
  type DataType, type SymbolService,
} from '../src/index.ts';
import { createFakeContext, createFakeSymbolService, FAKE_SENSOR_REPORT_SYMBOL } from '../src/testing/index.ts';

describe('SDK 1.5.0 part 3: the speed vector in steps (T-164)', () => {
  it('has the owner\'s ten steps, 5 s to 30 min', () => {
    expect(SPEED_VECTOR_STEPS_SECONDS).toEqual([5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800]);
    expect(DEFAULT_DISPLAY.speedVectorSeconds).toBe(0);
  });

  it('moves a value to the nearest step, above 30 min to 30 min, and a tie to the shorter (Q5, A1)', () => {
    expect(nearestSpeedVectorStep(0)).toBe(0);
    expect(nearestSpeedVectorStep(-3)).toBe(0);
    expect(nearestSpeedVectorStep(Number.NaN)).toBe(0);
    expect(nearestSpeedVectorStep(1)).toBe(5);
    expect(nearestSpeedVectorStep(60)).toBe(60);
    expect(nearestSpeedVectorStep(3 * 60)).toBe(120);
    expect(nearestSpeedVectorStep(4 * 60)).toBe(300);
    expect(nearestSpeedVectorStep(7 * 60)).toBe(300);
    expect(nearestSpeedVectorStep(8 * 60)).toBe(600);
    expect(nearestSpeedVectorStep(15 * 60)).toBe(600);
    expect(nearestSpeedVectorStep(25 * 60)).toBe(1200);
    expect(nearestSpeedVectorStep(60 * 60)).toBe(1800);
    for (const step of SPEED_VECTOR_STEPS_SECONDS) expect(nearestSpeedVectorStep(step)).toBe(step);
  });

  it('accepts a step or 0 as speedVectorSeconds, and still stored whole minutes', () => {
    expect(displayChoicesProblem({ speedVectorSeconds: 5 })).toBeNull();
    expect(displayChoicesProblem({ speedVectorSeconds: 0 })).toBeNull();
    expect(displayChoicesProblem({ speedVectorSeconds: 45 })).toContain('speedVectorSeconds');
    expect(displayChoicesProblem({ speedVectorSeconds: '60' })).toContain('speedVectorSeconds');
    expect(displayChoicesProblem({ speedVectorMinutes: 15 })).toBeNull();
    expect(displayChoicesProblem({ speedVectorMinutes: 61 })).toContain('0 to 60');
  });

  it('resolves the user\'s seconds, else their stored minutes as a step, else the admin\'s, and gives the minutes as a sixtieth', () => {
    expect(resolveDisplay({ speedVectorSeconds: 15 }, { speedVectorMinutes: 5 }, [])).toMatchObject({ speedVectorSeconds: 15, speedVectorMinutes: 0.25 });
    expect(resolveDisplay({ speedVectorMinutes: 15 }, {}, [])).toMatchObject({ speedVectorSeconds: 600, speedVectorMinutes: 10 });
    expect(resolveDisplay({}, { speedVectorMinutes: 4 }, [])).toMatchObject({ speedVectorSeconds: 300, speedVectorMinutes: 5 });
    expect(resolveDisplay({ speedVectorSeconds: 0, speedVectorMinutes: 30 }, {}, []).speedVectorSeconds, 'seconds win').toBe(0);
    expect(resolveDisplay({}, {}, [])).toMatchObject({ speedVectorSeconds: 0, speedVectorMinutes: 0 });
  });

  it('checks a resolved display with a fraction of a minute, and that the minutes match the seconds', () => {
    const d = resolveDisplay({ speedVectorSeconds: 5 }, {}, []);
    expect(d.speedVectorMinutes).toBeCloseTo(5 / 60, 12);
    expect(displaySettingsProblem(d, [])).toBeNull();
    expect(displaySettingsProblem({ ...d, speedVectorMinutes: 1 }, [])).toContain('speedVectorSeconds / 60');
    expect(displaySettingsProblem({ ...d, speedVectorSeconds: 45 }, [])).toContain('speedVectorSeconds');
    const old = { symbolSize: 30, speedVectorMinutes: 5, labels: [], relations: {} };
    expect(displaySettingsProblem(old, []), 'required since the 1.5.0 freeze').toBe('speedVectorSeconds is missing');
  });

  it('the fake context resolves steps too, and a newer choice in one unit replaces the other', () => {
    const ctx = createFakeContext();
    ctx.setDisplay({ speedVectorSeconds: 30 });
    expect(ctx.display.value).toMatchObject({ speedVectorSeconds: 30, speedVectorMinutes: 0.5 });
    ctx.setDisplay({ speedVectorMinutes: 10 });
    expect(ctx.display.value).toMatchObject({ speedVectorSeconds: 600, speedVectorMinutes: 10 });
    ctx.setDisplay({ symbolSize: 40 });
    expect(ctx.display.value, 'another part keeps the vector').toMatchObject({ symbolSize: 40, speedVectorSeconds: 600 });
    expect(() => ctx.setDisplay({ speedVectorSeconds: 45 as 30 })).toThrow('speedVectorSeconds');
  });
});

describe('SDK 1.5.0 part 3: sensor report data types (T-151)', () => {
  it('a data type may say that its objects are sensor reports; absent means not', () => {
    const detection: DataType = {
      id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', fieldSets: ['gmti.report'], manual: false, sensorReport: true,
      defaults: { expiresAfterSeconds: 60, fadeWhenExpired: true, removeAfterExpirySeconds: 300 },
      behaviour: { expiresAfterSeconds: 60, fadeWhenExpired: true, removeAfterExpirySeconds: 300 },
    };
    const general = createFakeContext().dataTypes[0] as DataType;
    expect(detection.sensorReport).toBe(true);
    expect(general.sensorReport ?? false).toBe(false);
  });

  it('the fake symbol service gives one sensor report symbol, the same every time', () => {
    const symbols = createFakeSymbolService();
    expect(symbols.sensorReportSymbol()).toBe(FAKE_SENSOR_REPORT_SYMBOL);
    expect(symbols.sensorReportSymbol()).toBe(FAKE_SENSOR_REPORT_SYMBOL);
    expect(FAKE_SENSOR_REPORT_SYMBOL).toMatchObject({ width: 12, height: 12, anchor: [6, 6] });
  });

  it('is required since the 1.5.0 freeze, as vesselGroups is', () => {
    const { sensorReportSymbol: _a, ...withoutSymbol } = createFakeSymbolService();
    const { vesselGroups: _b, ...withoutGroups } = createFakeSymbolService();
    // @ts-expect-error a symbol service must give the sensor report symbol (Q49 A)
    const a: SymbolService = withoutSymbol;
    // @ts-expect-error a symbol service must give the ship-type groups (Q49 A)
    const b: SymbolService = withoutGroups;
    expect([a, b]).toHaveLength(2);
  });
});
