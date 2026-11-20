// SDK and data model 1.6.0 part D (CR-0041; T-182, owner QN B, Q58 A): display classes and their switches.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classShown,
  DEFAULT_DISPLAY,
  DISPLAY_CLASS_IDS,
  DISPLAY_CLASSES,
  displayChoicesProblem,
  displaySettingsProblem,
  overlayProblem,
  resolveDisplay,
  type DisplayClass,
  type OverlayItem,
} from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

describe('SDK 1.6.0 part D: the display classes', () => {
  it('are the owner\'s two, labelled as in the display window, and the schema\'s list', () => {
    expect(DISPLAY_CLASS_IDS).toEqual(['dwell-area', 'sensor-coverage']);
    expect(DISPLAY_CLASSES.map((c) => c.label)).toEqual(['Dwell areas', 'Sensor coverage']);
    const schema = JSON.parse(readFileSync(new URL('../../../model/schemas/map-object.schema.json', import.meta.url), 'utf8')) as {
      $defs: { content: { properties: { displayClass: { enum: string[] } } } };
    };
    expect(schema.$defs.content.properties.displayClass.enum).toEqual([...DISPLAY_CLASS_IDS]);
  });

  it('are on by default, else the user\'s choice, else the admin\'s', () => {
    expect(DEFAULT_DISPLAY.classes).toEqual({ 'dwell-area': true, 'sensor-coverage': true });
    expect(resolveDisplay({}, {}, []).classes).toEqual({ 'dwell-area': true, 'sensor-coverage': true });
    const d = resolveDisplay({ classes: { 'dwell-area': false } }, { classes: { 'dwell-area': true, 'sensor-coverage': false } }, []);
    expect(d.classes).toEqual({ 'dwell-area': false, 'sensor-coverage': false });
    expect(displaySettingsProblem(d, [])).toBeNull();
  });

  it('classShown is true without a class, else the switch', () => {
    const d = resolveDisplay({ classes: { 'dwell-area': false } }, {}, []);
    expect(classShown(d, 'dwell-area')).toBe(false);
    expect(classShown(d, 'sensor-coverage')).toBe(true);
    expect(classShown(d, undefined)).toBe(true);
    const { classes: _gone, ...older } = d;
    expect(displaySettingsProblem(older, [])).toBe('classes is missing');
  });

  it('refuses unknown classes and switches that are not booleans', () => {
    expect(displayChoicesProblem({ classes: { weather: true } })).toBe('unknown display class: weather');
    expect(displayChoicesProblem({ classes: { 'dwell-area': 'off' } })).toBe('the switch of dwell-area is true or false');
    expect(displayChoicesProblem({ classes: [] })).toBe('classes maps a display class to true or false');
    expect(displayChoicesProblem({ classes: { 'sensor-coverage': false } })).toBeNull();
    const partial = { ...resolveDisplay({}, {}, []), classes: { 'dwell-area': true } };
    expect(displaySettingsProblem(partial, [])).toBe('no switch for the display class sensor-coverage');
  });

  it('marks overlay items, and an unknown class makes the overlay refused', () => {
    const ring = [[15.2, 58.4], [15.3, 58.4], [15.3, 58.5], [15.2, 58.4]] as const;
    const items: OverlayItem[] = [
      { kind: 'area', rings: [ring], displayClass: 'sensor-coverage' },
      { kind: 'label', position: [15.25, 58.45], text: '150 km', displayClass: 'sensor-coverage' },
      { kind: 'line', positions: [[15.2, 58.4], [15.3, 58.5]], displayClass: 'dwell-area' },
    ];
    expect(overlayProblem(items)).toBeNull();
    const wrong = [{ kind: 'point', position: [15.2, 58.4], displayClass: 'weather' as DisplayClass }] as OverlayItem[];
    expect(overlayProblem(wrong)).toBe('item 0: unknown display class weather');
  });

  it('the fake context switches a class as the user would', () => {
    const ctx = createFakeContext({ display: { classes: { 'dwell-area': false } } });
    expect(ctx.display.value.classes).toEqual({ 'dwell-area': false, 'sensor-coverage': true });
    ctx.setDisplay({ classes: { 'sensor-coverage': false } });
    expect(ctx.display.value.classes).toEqual({ 'dwell-area': false, 'sensor-coverage': false });
  });
});
