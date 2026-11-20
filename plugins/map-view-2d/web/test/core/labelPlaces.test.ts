import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, type DisplaySettings, type LabelPlaces, type MilSymbol } from '@emc2/plugin-sdk';
import { hasOffListText, labelText, NO_PLACED_LABELS, placedLabelsOf, placedTexts, samePlaces, speedLabel } from '../../src/core/labelPlaces.ts';
import { INFANTRY } from '../fixtures.ts';

const NONE = NO_PLACED_LABELS.labelPlaces;
const symbol = (modifiers: Record<string, unknown>): MilSymbol => ({ ...INFANTRY, modifiers });

describe('labels by place (CR-0043 part A; T-163)', () => {
  it('takes the places and the arrow from the display settings when the shell gives them', () => {
    const places: LabelPlaces = { topLeft: 'type', topRight: null, bottomLeft: null, bottomRight: 'speed', below: 'name' };
    expect(placedLabelsOf({ ...DEFAULT_DISPLAY, labelPlaces: places, directionArrow: false })).toEqual({ labelPlaces: places, directionArrow: false });
  });

  it("takes the shell's places and arrow as they are (required since the SDK's 1.8.0 freeze)", () => {
    const places: LabelPlaces = { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: 'speed', below: 'name' };
    const shown: DisplaySettings = { ...DEFAULT_DISPLAY, labels: ['uniqueDesignation', 'speed', 'name'], labelPlaces: places, directionArrow: false };
    expect(placedLabelsOf(shown)).toEqual({ labelPlaces: places, directionArrow: false });
  });

  it('compares places', () => {
    expect(samePlaces(NONE, { ...NONE })).toBe(true);
    expect(samePlaces(NONE, { ...NONE, below: 'name' })).toBe(false);
  });

  it('writes a speed in km/h as symbology does, a label from the amplifier of its name, and the name from the object', () => {
    expect(speedLabel(10)).toBe('36 km/h');
    expect(speedLabel(0.4)).toBe('1 km/h');
    expect(labelText('speed', symbol({ speed: 10 }), undefined)).toBe('36 km/h');
    expect(labelText('uniqueDesignation', symbol({ uniqueDesignation: 'A1' }), undefined)).toBe('A1');
    expect(labelText('name', symbol({}), 'Alpha')).toBe('Alpha');
    expect(labelText('name', symbol({}), '')).toBeUndefined();
    expect(labelText('dtg', symbol({}), 'Alpha')).toBeUndefined(); // the object has none
    expect(labelText('type', symbol({ type: '' }), undefined)).toBeUndefined();
    expect(labelText('speed', symbol({ speed: Number.NaN }), undefined)).toBeUndefined();
    expect(labelText('speed', { ...INFANTRY }, undefined)).toBeUndefined(); // no modifiers at all
  });

  it("gives the texts of the placed labels in the places' order, leaving out what the object does not have", () => {
    const places: LabelPlaces = { topLeft: 'type', topRight: 'uniqueDesignation', bottomLeft: 'dtg', bottomRight: null, below: 'name' };
    expect(placedTexts(symbol({ type: 'T', uniqueDesignation: 'U' }), 'Alpha', places)).toEqual([
      { place: 'topLeft', text: 'T' }, { place: 'topRight', text: 'U' }, { place: 'below', text: 'Alpha' },
    ]);
    expect(placedTexts(symbol({}), undefined, places)).toEqual([]);
    expect(placedTexts(symbol({ type: 'T' }), 'Alpha', NONE)).toEqual([]);
  });

  it('knows an amplifier that symbology still draws with no labels: one that cannot be placed', () => {
    expect(hasOffListText(INFANTRY)).toBe(false);
    expect(hasOffListText(symbol({ direction: 45, speed: 3, uniqueDesignation: 'A', type: 'T', dtg: 'D' }))).toBe(false);
    expect(hasOffListText(symbol({ uniqueDesignation: 'A', quantity: '12' }))).toBe(true);
    expect(hasOffListText(symbol({ country: 'SE' }))).toBe(true);
    expect(hasOffListText(symbol({ dtg1: 'D', targetNumber: 'T', uniqueDesignation1: 'U', distances: [1], azimuths: [2] }))).toBe(false); // drawn for graphics only
  });
});
