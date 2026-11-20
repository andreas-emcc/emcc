// The pure parts: the catalogue helpers and the short list, the SIDC, the amplifiers and the content of change
// requests. Positions are checked where the latitude differs from the longitude (ADR-0007).
import { describe, expect, it } from 'vitest';
import type { GraphicCatalogEntry } from '@emc2/plugin-sdk';
import { createFakeSymbolService, FAKE_GRAPHICS } from '@emc2/plugin-sdk/testing';
import { checkAmplifiers, draftsOf, foreignAmplifiers, mergeModifiers, parseNumber } from '../src/amplifiers.ts';
import { controlPointsOf, geometryFor, newGraphicContent, reshapedGeometry, symbolWith, validPosition, withName } from '../src/content.ts';
import { buildTree, displayNames, entryOfSymbol, maxPointsOf, pointCountFits, pointCountText, pointGuide, searchEntries, SHORT_LIST, shortListOf } from '../src/graphics.ts';
import { composeSidc, identityOptions, partsOfSidc, withParts } from '../src/sidc.ts';
import { DEFAULT_SETTINGS, readSettings } from '../src/settings.ts';

const [BOUNDARY, PHASE, AXIS, FAN] = FAKE_GRAPHICS as readonly [GraphicCatalogEntry, GraphicCatalogEntry, GraphicCatalogEntry, GraphicCatalogEntry];
const symbols = createFakeSymbolService();

describe('the short list', () => {
  it('has 30 to 40 graphics in four groups, each once', () => {
    const keys = SHORT_LIST.flatMap((g) => g.keys);
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(keys.length).toBeLessThanOrEqual(40);
    expect(new Set(keys).size).toBe(keys.length);
    expect(SHORT_LIST.map((g) => g.label)).toEqual(['Boundaries and lines', 'Areas', 'Axes and tasks', 'Fires and obstacles']);
    expect(keys.every((k) => /^25\d{6}$/.test(k))).toBe(true); // control measures only
  });

  it('shows the graphics the catalogue has, in the list’s order, and no empty group', () => {
    const shown = shortListOf(FAKE_GRAPHICS);
    expect(shown.map((g) => [g.label, g.entries.map((e) => e.name)])).toEqual([
      ['Boundaries and lines', ['Boundary', 'Phase Line']],
      ['Axes and tasks', ['Main Attack']],
      ['Fires and obstacles', ['Weapon/Sensor Range fan, Sector']],
    ]);
    expect(shortListOf([])).toEqual([]);
  });
});

describe('the catalogue helpers', () => {
  it('finds the graphic of a symbol by its SIDC, and null for APP-6B or a code the catalogue lacks', () => {
    expect(entryOfSymbol(symbols, FAKE_GRAPHICS, { standard: 'APP-6D', sidc: '10032500161101000000' })).toBe(BOUNDARY);
    expect(entryOfSymbol(symbols, FAKE_GRAPHICS, { standard: 'APP-6B', sidc: 'SFGPUCI----D---' })).toBeNull();
    expect(entryOfSymbol(symbols, FAKE_GRAPHICS, { standard: 'APP-6D', sidc: '10031000001211000000' })).toBeNull();
  });

  it('counts points: exactly n, n to m, n or more; a points graphic without a limit takes its minimum', () => {
    expect(pointCountText(PHASE)).toBe('2 or more points');
    expect(pointCountText(AXIS)).toBe('3 to 50 points');
    expect(pointCountText(FAN)).toBe('exactly 1 point');
    expect(pointCountText({ ...AXIS, minPoints: 4, maxPoints: 4 })).toBe('exactly 4 points');
    expect(pointCountFits(AXIS, 2)).toBe(false);
    expect(pointCountFits(AXIS, 3)).toBe(true);
    expect(pointCountFits(AXIS, 50)).toBe(true);
    expect(pointCountFits(AXIS, 51)).toBe(false);
    expect(pointCountFits(PHASE, 400)).toBe(true);
    expect(maxPointsOf({ ...FAN, maxPoints: null })).toBe(1);
    expect(maxPointsOf(PHASE)).toBeNull();
  });

  it('tells what each point is, as the catalogue says (the second-to-last text for the points between)', () => {
    expect(pointGuide(AXIS)).toEqual(['1: the tip of the arrow', '2 to n−1: the axis, from the tip back to the tail', 'n: the width of the arrowhead']);
    expect(pointGuide(PHASE)).toEqual(['1 to n: a point of the line, in order']);
    expect(pointGuide(FAN)).toEqual(['1: the weapon or sensor']);
    // Every point has its own text.
    expect(pointGuide({ ...AXIS, minPoints: 3, maxPoints: 3 })).toEqual(['1: the tip of the arrow', '2: the axis, from the tip back to the tail', '3: the width of the arrowhead']);
    expect(pointGuide({ ...AXIS, points: [] })).toEqual([]);
  });

  it('names graphics of the same name by their place, and finds graphics by any word of the name or the path', () => {
    const twin: GraphicCatalogEntry = { ...PHASE, entity: '340100', name: 'Block', path: ['Control Measure', 'Mission Tasks'] };
    const twin2: GraphicCatalogEntry = { ...PHASE, entity: '270501', name: 'Block', path: ['Control Measure', 'Protection Areas', 'Obstacle Effects'] };
    const names = displayNames([...FAKE_GRAPHICS, twin, twin2]);
    expect(names.get('25340100')).toBe('Block (Mission Tasks)');
    expect(names.get('25270501')).toBe('Block (Obstacle Effects)');
    expect(names.get('25140300')).toBe('Phase Line');
    expect(searchEntries(FAKE_GRAPHICS, 'phase', displayNames(FAKE_GRAPHICS)).map((e) => e.name)).toEqual(['Phase Line']);
    expect(searchEntries(FAKE_GRAPHICS, 'MANEUVER line', displayNames(FAKE_GRAPHICS)).map((e) => e.name)).toEqual(['Phase Line']);
    expect(searchEntries(FAKE_GRAPHICS, '  ', displayNames(FAKE_GRAPHICS))).toBe(FAKE_GRAPHICS);
  });

  it('builds the tree by path without the root all share, with the graphics as leaves', () => {
    const tree = buildTree(FAKE_GRAPHICS, displayNames(FAKE_GRAPHICS));
    expect(tree.nodes.map((n) => n.label)).toEqual(['Command and Control Lines', 'Maneuver Lines', 'Maneuver Areas', 'Fires Areas']);
    const areas = tree.nodes.find((n) => n.label === 'Maneuver Areas');
    expect(areas?.children?.[0]?.label).toBe('Axis of Advance');
    expect(areas?.children?.[0]?.children?.map((n) => n.label)).toEqual(['Main Attack']);
    expect(tree.leaves.size).toBe(4);
  });
});

describe('the SIDC', () => {
  it('composes the graphic’s symbol set and entity with the choices; the echelon only counts for a graphic that shows one', () => {
    const choice = { standard: 'APP-6D', standardIdentity: '6', status: '1', echelon: '16' } as const;
    expect(composeSidc(symbols, BOUNDARY, choice)).toBe('10062510161101000000');
    expect(composeSidc(symbols, PHASE, choice)).toBe('10062510001403000000'); // no echelon digits for a phase line
  });

  it('describes a SIDC and changes one part of it', () => {
    expect(partsOfSidc(symbols, 'APP-6D', '10032500161101000000')).toMatchObject({ standardIdentity: '3', symbolSet: '25', status: '0', echelonMobility: '16', entity: '110100' });
    expect(withParts(symbols, 'APP-6D', '10032500161101000000', { status: '1' })).toBe('10032510161101000000');
    expect(withParts(symbols, 'APP-6D', '10032500161101000000', { standardIdentity: '6', echelonMobility: '15' })).toBe('10062500151101000000');
  });

  it('offers friend, hostile, neutral and unknown, and the current identity when it is another one', () => {
    expect(identityOptions(symbols).map((i) => i.name)).toEqual(['Friend', 'Hostile', 'Neutral', 'Unknown']);
    const service = { ...symbols, catalog: () => ({ ...symbols.catalog(), standardIdentities: [...symbols.catalog().standardIdentities, { code: '2', name: 'Assumed Friend' }] }) };
    expect(identityOptions(service).map((i) => i.code)).toEqual(['3', '6', '4', '1']);
    expect(identityOptions(service, '2').map((i) => i.code)).toEqual(['3', '6', '4', '1', '2']);
  });
});

describe('the amplifiers', () => {
  it('accepts a number with a point or a comma, nothing else', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber(' 9000,5 ')).toBe(9000.5);
    expect(parseNumber('-1')).toBe(-1);
    for (const bad of ['', 'abc', '1e3', '1 2', '1.2.3', 'NaN', 'Infinity']) expect(parseNumber(bad), bad).toBeNull();
  });

  it('checks the ranges of the model: distances 0 to 20 000 000 metres, azimuths 0 to 360 degrees, 1 to 64 values', () => {
    const ok = checkAmplifiers(FAN, { distances: ['0', '20000000'], azimuths: ['0', '360'] });
    expect(ok).toMatchObject({ ok: true, modifiers: { distances: [0, 20000000], azimuths: [0, 360] } });
    expect(checkAmplifiers(FAN, { distances: ['-1'], azimuths: ['10'] }).problems['distances']).toMatch(/from 0 to 20 000 000 metres/);
    expect(checkAmplifiers(FAN, { distances: ['20000001'], azimuths: ['10'] }).ok).toBe(false);
    expect(checkAmplifiers(FAN, { distances: ['5'], azimuths: ['400'] }).problems['azimuths']).toMatch(/from 0 to 360 degrees/);
    expect(checkAmplifiers(FAN, { distances: ['5'], azimuths: ['x'] }).problems['azimuths']).toBe('Enter numbers only, one per line');
    expect(checkAmplifiers(FAN, { distances: Array.from({ length: 65 }, () => '1'), azimuths: ['1'] }).problems['distances']).toBe('At most 64 values');
    expect(checkAmplifiers(FAN, { distances: Array.from({ length: 64 }, () => '1'), azimuths: ['1'] }).ok).toBe(true);
  });

  it('requires the required amplifiers, ignores empty rows and amplifiers the graphic does not allow', () => {
    expect(checkAmplifiers(FAN, {})).toMatchObject({ ok: false, problems: { distances: 'Required', azimuths: 'Required' } });
    expect(checkAmplifiers(FAN, { distances: ['', ' '], azimuths: ['10', ''] }).problems).toEqual({ distances: 'Required' });
    expect(checkAmplifiers(PHASE, { uniqueDesignation: '  A1 ', country: 'SE' })).toEqual({ ok: true, problems: {}, modifiers: { uniqueDesignation: 'A1' } });
  });

  it('limits a text amplifier to 128 characters', () => {
    expect(checkAmplifiers(PHASE, { uniqueDesignation: 'x'.repeat(128) }).ok).toBe(true);
    expect(checkAmplifiers(PHASE, { uniqueDesignation: 'x'.repeat(129) }).problems['uniqueDesignation']).toBe('At most 128 characters');
  });

  it('turns an object’s amplifiers into input and back, and keeps those the graphic does not allow', () => {
    const modifiers = { uniqueDesignation: '1st', hostile: 'ENY', distances: [5000, 9000.5] };
    expect(draftsOf(BOUNDARY, modifiers)).toEqual({ uniqueDesignation: '1st' });
    expect(foreignAmplifiers(BOUNDARY, modifiers)).toEqual([{ name: 'hostile', text: 'ENY' }, { name: 'distances', text: '5000, 9000.5' }]);
    expect(mergeModifiers(BOUNDARY, modifiers, { uniqueDesignation1: '2nd' })).toEqual({ hostile: 'ENY', distances: [5000, 9000.5], uniqueDesignation1: '2nd' });
    expect(mergeModifiers(BOUNDARY, { uniqueDesignation: '1st' }, {})).toBeUndefined();
    expect(draftsOf(FAN, { distances: [5000], azimuths: [30, 120] })).toEqual({ distances: ['5000'], azimuths: ['30', '120'] });
  });
});

describe('the content of change requests', () => {
  const label = { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED' };

  it('builds a new graphic: core.multipoint, manual, the symbol, the name, no extension', () => {
    const content = newGraphicContent({
      symbol: { standard: 'APP-6D', sidc: '10032500161101000000' },
      geometry: { type: 'LineString', coordinates: [[16.5, 58.6], [18.07, 59.33]] },
      name: '  Boundary  ',
      layerId: 'layer-1',
      dataType: 'core.general',
      label,
    });
    expect(content).toEqual({
      type: 'core.multipoint',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId: 'layer-1',
      geometry: { type: 'LineString', coordinates: [[16.5, 58.6], [18.07, 59.33]] },
      symbol: { standard: 'APP-6D', sidc: '10032500161101000000' },
      properties: { name: 'Boundary' },
      label,
    });
    expect(newGraphicContent({ symbol: content.symbol ?? { standard: 'APP-6D', sidc: '' }, geometry: content.geometry, name: ' ', layerId: 'l', dataType: 'core.general', label })).not.toHaveProperty('properties');
  });

  it('stores the control points as the catalogue’s geometry says; a polygon is closed', () => {
    const points: [number, number][] = [[18.0, 59.3], [18.3, 59.35], [18.2, 59.5]];
    expect(geometryFor({ geometry: 'LineString' }, points)).toEqual({ type: 'LineString', coordinates: points });
    expect(geometryFor({ geometry: 'MultiPoint' }, [[18.0686, 59.3293]])).toEqual({ type: 'MultiPoint', coordinates: [[18.0686, 59.3293]] });
    expect(geometryFor({ geometry: 'Polygon' }, points)).toEqual({ type: 'Polygon', coordinates: [[...points, [18.0, 59.3]]] });
    expect(geometryFor({ geometry: 'LineString' }, [])).toBeNull();
    expect(geometryFor({ geometry: 'LineString' }, [[18, 95]])).toBeNull(); // latitude outside ±90
  });

  it('reads the control points back: a polygon without its closing position', () => {
    const ring: [number, number][] = [[18.0, 59.3], [18.3, 59.35], [18.2, 59.5], [18.0, 59.3]];
    expect(controlPointsOf({ type: 'Polygon', coordinates: [ring] })).toEqual(ring.slice(0, 3));
    expect(controlPointsOf({ type: 'LineString', coordinates: ring })).toEqual(ring);
    expect(controlPointsOf({ type: 'Circle', center: [1, 2], radius: 3 })).toBeNull();
  });

  it('brings a longitude back into ±180, keeps an altitude, refuses a latitude outside ±90', () => {
    expect(validPosition([190, 10])).toEqual([-170, 10]);
    expect(validPosition([-181, 10, 25])).toEqual([179, 10, 25]);
    expect(validPosition([10, 90.5])).toBeNull();
    expect(validPosition([Number.NaN, 0])).toBeNull();
  });

  it('accepts a reshape of the same geometry type only, and keeps a polygon closed', () => {
    const before = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.35], [18.2, 59.5], [18.0, 59.3]]] } as const;
    const after = { type: 'Polygon', coordinates: [[[18.1, 59.3], [18.3, 59.35], [18.2, 59.5], [18.1, 59.3]]] } as const;
    expect(reshapedGeometry(before, after)).toEqual(after);
    expect(reshapedGeometry(before, { type: 'LineString', coordinates: [[18, 59], [19, 60]] })).toBeNull();
    expect(reshapedGeometry({ type: 'MultiPoint', coordinates: [[1, 2]] }, { type: 'MultiPoint', coordinates: [[200, 2]] })).toEqual({ type: 'MultiPoint', coordinates: [[-160, 2]] });
  });

  it('renames without touching the other properties, and a symbol without amplifiers has no modifiers key', () => {
    const core = { type: 'core.multipoint', dataType: 'core.general', dataSource: 'manual', layerId: 'l', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { name: 'A', description: 'D' }, label } as const;
    expect(withName(core, 'B').properties).toEqual({ name: 'B', description: 'D' });
    expect(withName({ ...core, properties: { name: 'A' } }, ' ')).not.toHaveProperty('properties');
    expect(symbolWith({ standard: 'APP-6D', sidc: 'x', modifiers: { uniqueDesignation: 'A' } }, undefined)).toEqual({ standard: 'APP-6D', sidc: 'x' });
    expect(symbolWith({ standard: 'APP-6D', sidc: 'x' }, { uniqueDesignation: 'A' })).toEqual({ standard: 'APP-6D', sidc: 'x', modifiers: { uniqueDesignation: 'A' } });
  });
});

describe('the settings', () => {
  it('reads the standard and the identity, ignores a leftover dataType setting, and reports a bad value', () => {
    expect(readSettings({ standard: 'APP-6E', standardIdentity: 'Hostile' })).toMatchObject({ settings: { standard: 'APP-6E', standardIdentity: '6' }, problems: [] });
    const bad = readSettings({ standard: 'APP-6B', standardIdentity: 'Pending' });
    expect(bad.settings).toMatchObject({ standard: 'APP-6D', standardIdentity: '3' });
    expect(bad.problems).toHaveLength(2);
    expect(readSettings({ standard: 'APP-6D', standardIdentity: 'Friend', dataType: 'cot.cot' })).toEqual({ settings: DEFAULT_SETTINGS, problems: [] });
  });
});
