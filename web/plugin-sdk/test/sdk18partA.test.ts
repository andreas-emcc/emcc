// SDK 1.8.0 part A (CR-0043; T-163, the owner's answers of 2026-11-13): symbol labels by place.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY, LABEL_PLACES, LABEL_PLACE_NAMES, TEXT_LABEL_IDS, displayChoicesProblem, displaySettingsProblem, labelsOfPlaces, placesFromLabels, resolveDisplay,
  type LabelPlaces,
} from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const EMPTY: LabelPlaces = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: null };

describe('SDK 1.8.0 part A: the places', () => {
  it('are the four corners and below, in the window\'s order, with their names (owner A)', () => {
    expect(LABEL_PLACES).toEqual(['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'below']);
    expect(LABEL_PLACES.map((p) => LABEL_PLACE_NAMES[p])).toEqual(['Top left', 'Top right', 'Bottom left', 'Bottom right', 'Below']);
  });
  it('take text labels only: the arrow is its own switch (owner A)', () => {
    expect(TEXT_LABEL_IDS).not.toContain('direction');
    expect(TEXT_LABEL_IDS).toContain('name');
    expect(TEXT_LABEL_IDS).toHaveLength(9);
  });
  it('default to name below and the unique designation top right, with the arrow on', () => {
    expect(DEFAULT_DISPLAY.labelPlaces).toEqual({ ...EMPTY, topRight: 'uniqueDesignation', below: 'name' });
    expect(DEFAULT_DISPLAY.directionArrow).toBe(true);
  });
});

describe('SDK 1.8.0 part A: a stored 1.7.0 list', () => {
  it('puts name below and the others top right, bottom right, top left, bottom left, dropping the rest', () => {
    expect(placesFromLabels(['name', 'uniqueDesignation', 'direction'])).toEqual({ labelPlaces: { ...EMPTY, topRight: 'uniqueDesignation', below: 'name' }, directionArrow: true });
    // the arrow is on whether or not the list has direction (owner WZ A, 2026-11-15)
    expect(placesFromLabels(['speed', 'dtg', 'type', 'staffComments', 'higherFormation', 'name'])).toEqual({
      labelPlaces: { topRight: 'speed', bottomRight: 'dtg', topLeft: 'type', bottomLeft: 'staffComments', below: 'name' }, directionArrow: true,
    });
    expect(placesFromLabels([])).toEqual({ labelPlaces: EMPTY, directionArrow: true });
  });
  it('and back: the placed labels in the places\' order, then direction while the arrow is on', () => {
    expect(labelsOfPlaces({ ...EMPTY, below: 'name', topLeft: 'dtg' }, true)).toEqual(['dtg', 'name', 'direction']);
    expect(labelsOfPlaces(EMPTY, false)).toEqual([]);
  });
});

describe('SDK 1.8.0 part A: the checks', () => {
  it('accept places and the arrow, and refuse a stored list beside them', () => {
    expect(displayChoicesProblem({ labelPlaces: { below: 'name', topLeft: null }, directionArrow: false })).toBeNull();
    expect(displayChoicesProblem({ labels: ['name'], labelPlaces: { below: 'name' } })).toBe('labels is not stored together with labelPlaces or directionArrow');
    expect(displayChoicesProblem({ labels: ['name'], directionArrow: true })).toBe('labels is not stored together with labelPlaces or directionArrow');
    expect(displayChoicesProblem({ labelPlaces: { middle: 'name' } })).toBe('unknown label place: middle');
    expect(displayChoicesProblem({ labelPlaces: { below: 'direction' } })).toBe('unknown text label: direction');
    expect(displayChoicesProblem({ labelPlaces: { below: 'name', topLeft: 'name' } })).toBe('label placed twice: name');
    expect(displayChoicesProblem({ labelPlaces: ['name'] })).toBe('labelPlaces maps a place to a label or null');
    expect(displayChoicesProblem({ directionArrow: 'yes' })).toBe('directionArrow is true or false');
  });
  it('take the filled display, whose list matches its places and arrow', () => {
    const d = resolveDisplay({ labelPlaces: { topLeft: 'dtg', below: 'name' }, directionArrow: true }, {}, []);
    expect(displaySettingsProblem(d, [])).toBeNull();
    expect(displaySettingsProblem(DEFAULT_DISPLAY, [])).toBeNull();
    expect(displaySettingsProblem({ ...d, labels: ['name'] }, [])).toBe('labels is the placed labels and direction while the arrow is on');
    expect(displaySettingsProblem({ ...d, labelPlaces: { below: 'name' } }, [])).toBe('no label choice for the place topLeft');
    const { directionArrow: _arrow, ...noArrow } = d;
    expect(displaySettingsProblem(noArrow, [])).toBe('directionArrow is missing');
  });
  it('refuse a display without the two, required since the 1.8.0 freeze', () => {
    const { labelPlaces: _p, directionArrow: _a, ...older } = DEFAULT_DISPLAY;
    expect(displaySettingsProblem(older, [])).toBe('labelPlaces is missing');
    const { labelPlaces: _q, ...noPlaces } = DEFAULT_DISPLAY;
    expect(displaySettingsProblem(noPlaces, [])).toBe('labelPlaces is missing');
  });
});

describe('SDK 1.8.0 part A: resolveDisplay', () => {
  it('takes the user\'s places, else the user\'s list, else the admin\'s, else the default', () => {
    expect(resolveDisplay({ labelPlaces: { topLeft: 'dtg' } }, { labels: ['speed'] }, []).labelPlaces).toEqual({ ...EMPTY, topLeft: 'dtg' });
    expect(resolveDisplay({ labels: ['speed', 'name'] }, { labelPlaces: { topLeft: 'dtg' } }, []).labelPlaces).toEqual({ ...EMPTY, topRight: 'speed', below: 'name' });
    expect(resolveDisplay({}, { labelPlaces: { bottomLeft: 'type' }, directionArrow: false }, [])).toMatchObject({ labelPlaces: { ...EMPTY, bottomLeft: 'type' }, directionArrow: false, labels: ['type'] });
    expect(resolveDisplay({}, {}, [])).toMatchObject({ labelPlaces: DEFAULT_DISPLAY.labelPlaces, directionArrow: true, labels: DEFAULT_DISPLAY.labels });
  });
  it('keeps a stored list\'s own order in the deprecated labels, with direction after it as the arrow is on', () => {
    expect(resolveDisplay({ labels: ['name', 'uniqueDesignation', 'direction'] }, {}, []).labels).toEqual(['name', 'uniqueDesignation', 'direction']);
    expect(resolveDisplay({ labels: ['direction', 'name'] }, {}, []).labels).toEqual(['direction', 'name']);
    const d = resolveDisplay({}, { labels: ['uniqueDesignation', 'speed'] }, []);
    expect(d).toMatchObject({ directionArrow: true, labels: ['uniqueDesignation', 'speed', 'direction'] });
    expect(displaySettingsProblem(d, [])).toBeNull();
  });
  it('takes the arrow from its switch, else on for a stored list (owner WZ A), else on', () => {
    expect(resolveDisplay({ directionArrow: false }, { labels: ['direction'] }, []).directionArrow).toBe(false);
    expect(resolveDisplay({ labels: ['name'] }, {}, []).directionArrow).toBe(true);
    expect(resolveDisplay({}, { labels: ['name'] }, []).directionArrow).toBe(true);
    expect(resolveDisplay({}, { directionArrow: false }, []).directionArrow).toBe(false);
    expect(resolveDisplay({ labelPlaces: { below: 'name' } }, {}, []).labels).toEqual(['name', 'direction']);
  });
  it('drops from the list what a stored list loses to the places', () => {
    const d = resolveDisplay({ labels: ['speed', 'dtg', 'type', 'staffComments', 'higherFormation'] }, {}, []);
    expect(d.labels).toEqual(['type', 'speed', 'staffComments', 'dtg', 'direction']);
    expect(displaySettingsProblem(d, [])).toBeNull();
  });
});

describe('SDK 1.8.0 part A: the test kit', () => {
  it('gives ctx.display its places and arrow, and setDisplay changes them as the user would', () => {
    const ctx = createFakeContext({ display: { labelPlaces: { topLeft: 'speed', below: 'name' }, directionArrow: false } });
    expect(ctx.display.value).toMatchObject({ labelPlaces: { ...EMPTY, topLeft: 'speed', below: 'name' }, directionArrow: false, labels: ['speed', 'name'] });
    ctx.setDisplay({ directionArrow: true });
    expect(ctx.display.value.directionArrow).toBe(true);
    expect(ctx.display.value.labels).toEqual(['speed', 'name', 'direction']);
    expect(() => createFakeContext({ display: { labels: ['name'], directionArrow: true } })).toThrow('labels is not stored together');
    const older = createFakeContext({ display: { labels: ['name', 'direction'] } });
    older.setDisplay({ labelPlaces: { topRight: 'dtg' } });
    expect(older.display.value).toMatchObject({ labelPlaces: { ...EMPTY, topRight: 'dtg' }, directionArrow: true, labels: ['dtg', 'direction'] });
  });
});
