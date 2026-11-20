// The plain functions of the list: paging arithmetic, the cells of a row and the setting.
import { describe, expect, it } from 'vitest';
import type { MapObject } from '@emc2/plugin-sdk';
import { cellsOf, countText, groupDigits, kindOf, lastPageIndex, modifiedText, nameOf, pageSizeOf, rangeText } from '../src/format.ts';
import { layer, objectNamed } from './helpers.tsx';

describe('paging arithmetic', () => {
  it('finds the last page', () => {
    expect(lastPageIndex(0, 100)).toBe(0);
    expect(lastPageIndex(1, 100)).toBe(0);
    expect(lastPageIndex(100, 100)).toBe(0);
    expect(lastPageIndex(101, 100)).toBe(1);
    expect(lastPageIndex(250, 100)).toBe(2);
  });

  it('groups thousands with a no-break space', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(999)).toBe('999');
    expect(groupDigits(1000)).toBe('1 000');
    expect(groupDigits(12345)).toBe('12 345');
    expect(groupDigits(1234567)).toBe('1 234 567');
  });

  it('writes the range and the count', () => {
    expect(rangeText(0, 100, 100, 250)).toBe('1–100 of 250');
    expect(rangeText(2, 100, 50, 250)).toBe('201–250 of 250');
    expect(countText(1)).toBe('1 object');
    expect(countText(12345)).toBe('12 345 objects');
  });

  it('reads the page size setting, and says when it is not one', () => {
    expect(pageSizeOf({})).toEqual({ size: 100, bad: false });
    expect(pageSizeOf({ pageSize: 25 })).toEqual({ size: 25, bad: false });
    expect(pageSizeOf({ pageSize: 500 })).toEqual({ size: 500, bad: false });
    for (const bad of [0, 501, 2.5, -1, '100', null, true]) expect(pageSizeOf({ pageSize: bad })).toEqual({ size: 100, bad: true });
  });
});

describe('the cells of a row', () => {
  const l = layer('L', 1);

  it('names an object, or "(no name)" for none or a blank one', () => {
    expect(nameOf(objectNamed(l.id, 'Alpha', 1))).toBe('Alpha');
    expect(nameOf(objectNamed(l.id, undefined, 1))).toBe('(no name)');
    expect(nameOf(objectNamed(l.id, '   ', 1))).toBe('(no name)');
  });

  it('gives the kind: Symbol, the shape kind of draw-shapes, otherwise the geometry type', () => {
    expect(kindOf(objectNamed(l.id, 'a', 1))).toBe('Symbol');
    const shape = (extensions: MapObject['extensions']): MapObject => objectNamed(l.id, 's', 2, { type: 'core.shape', geometry: { type: 'Polygon', coordinates: [[[18, 59], [19, 59], [19, 60], [18, 59]]] }, ...(extensions === undefined ? {} : { extensions }) });
    expect(kindOf(shape({ 'draw-shapes': { kind: 'rectangle' } }))).toBe('Rectangle');
    expect(kindOf(shape(undefined))).toBe('Polygon');
    expect(kindOf(shape({ 'draw-shapes': { kind: 7 } }))).toBe('Polygon');
    expect(kindOf(shape({ 'someone-else': { kind: 'circle' } }))).toBe('Polygon');
  });

  it('shows a time in UTC to the second, and anything else as it is', () => {
    expect(modifiedText('2026-10-16T09:08:07.654Z')).toBe('2026-10-16 09:08:07Z');
    expect(modifiedText('2026-10-16T11:08:07+02:00')).toBe('2026-10-16 09:08:07Z');
    expect(modifiedText('yesterday')).toBe('yesterday');
  });

  it('shows a data type that is not in the list by its id', () => {
    const o = objectNamed(l.id, 'a', 1, { dataType: 'gone.type' });
    expect(cellsOf(o, () => undefined).dataType).toBe('gone.type');
    expect(cellsOf(o, () => 'Known').dataType).toBe('Known');
  });
});
