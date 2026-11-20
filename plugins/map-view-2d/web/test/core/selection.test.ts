import { MAX_SELECTION } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { boxSelection, clickSelection, createSelection } from '../../src/core/selection.ts';
import { uuid } from '../fixtures.ts';

const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => uuid(from + i));
const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('click selection (brief function 14)', () => {
  it('criterion 24: a click on an object replaces the selection, a click on empty map clears it', () => {
    expect(clickSelection([uuid(1), uuid(2)], uuid(3), false)).toEqual({ ids: [uuid(3)], notice: null });
    expect(clickSelection([uuid(1), uuid(2)], null, false)).toEqual({ ids: [], notice: null });
  });

  it('criterion 25: with the add key it adds an unselected object and removes a selected one; on empty map it changes nothing', () => {
    expect(clickSelection([uuid(1)], uuid(2), true).ids).toEqual([uuid(1), uuid(2)]);
    expect(clickSelection([uuid(1), uuid(2)], uuid(1), true).ids).toEqual([uuid(2)]);
    expect(clickSelection([uuid(1)], null, true).ids).toEqual([uuid(1)]);
  });

  it('criterion 40: an add beyond 1 000 adds nothing and gives a notice; removing still works', () => {
    const full = ids(1, MAX_SELECTION);
    const added = clickSelection(full, uuid(5000), true);
    expect(added.ids).toBe(full);
    expect(added.notice?.message).toBe('A selection holds at most 1,000 objects; this object was not added.');
    expect(clickSelection(full, uuid(1), true).ids).toHaveLength(MAX_SELECTION - 1);
    expect(clickSelection(full, uuid(1), true).notice).toBeNull();
  });
});

describe('box selection (brief function 14)', () => {
  it('criterion 26: replaces the selection with the objects in the box, without a notice when all fit', () => {
    expect(boxSelection([uuid(1), uuid(2)], 0)).toEqual({ ids: [uuid(1), uuid(2)], notice: null });
    expect(boxSelection([], 0)).toEqual({ ids: [], notice: null });
  });

  it('criterion 27: of 1 500 it keeps exactly the first 1 000 (topmost first) and states the 500 left out', () => {
    const inBox = ids(1, 1500);
    const result = boxSelection(inBox, 0);
    expect(result.ids).toEqual(inBox.slice(0, 1000));
    expect(result.notice).toEqual({ severity: 'warning', message: 'Selected the first 1,000 objects; 500 more in the box were left out. Zoom in to select them.' });
  });

  it('criterion 28: counts the objects in clusters it could not select and asks to zoom in', () => {
    expect(boxSelection([uuid(1)], 42)).toEqual({ ids: [uuid(1)], notice: { severity: 'warning', message: '42 objects inside clusters could not be selected. Zoom in to select them.' } });
    expect(boxSelection([], 1).notice?.message).toBe('1 object inside clusters could not be selected. Zoom in to select them.');
    expect(boxSelection(ids(1, 1001), 7).notice?.message).toBe('Selected the first 1,000 objects; 1 more in the box was left out. 7 objects inside clusters could not be selected. Zoom in to select them.');
  });
});

describe('the shared selection (SDK 1.1.0)', () => {
  it('keeps the first 1 000 of a longer list and logs a warning', () => {
    const l = log();
    const selection = createSelection(l, () => undefined);
    selection.set(ids(1, 1200));
    expect(selection.value).toEqual(ids(1, 1000));
    expect(l.warn).toHaveBeenCalledWith('a selection of 1200 ids was cut to the first 1000');
  });

  it('tells its listeners only of real changes', () => {
    const selection = createSelection(log(), () => undefined);
    const heard = vi.fn();
    selection.onChange(heard);
    selection.set([uuid(1)]);
    selection.set([uuid(1)]);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
